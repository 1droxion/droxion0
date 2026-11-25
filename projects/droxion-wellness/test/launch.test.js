const {test,before,after}=require('node:test')
const assert=require('node:assert/strict')
const {PGlite}=require('@electric-sql/pglite')
const {once}=require('node:events')
const {createApp}=require('../server')
const {migrate,calculate}=require('../store')
const {hash}=require('../admin')
const {createHmac}=require('node:crypto')
const fs=require('node:fs/promises')
const makeDatabase=()=>new PGlite(process.env.TEST_DB_DIR)
let db,server,base
const password='test-only-owner-password-4321'
const unsubscribeKey='local-browser-test-secret'
const email='test+launch@example.com'
const slug='water-based-16oz'
const request=(p,options={})=>fetch(base+p,{redirect:'manual',...options})
const post=(p,body,headers={})=>request(p,{method:'POST',body:new URLSearchParams(body),headers})
before(async()=>{
  db=makeDatabase()
  const migrationClient={query:(sql,params)=>!params && sql.includes(';') ? db.exec(sql) : db.query(sql,params)}
  await migrate(migrationClient)
  await migrate(migrationClient)
  server=createApp({query:db.query.bind(db),connect:async()=>({query:db.query.bind(db),release(){}})},
    {adminHash:hash(password),unsubscribeKey,countHeadless:true}).listen(0,'127.0.0.1')
  await once(server,'listening')
  base='http://127.0.0.1:'+server.address().port
})
after(async()=>{server?.close();await db?.close()})
test('serves catalog, all product routes, policy pages, assets and honest API health',async()=>{
  const home=await request('/')
  assert.equal(home.status,200)
  assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/)
  assert.match(await home.text(),/Naturally[.]/)
  for(const route of ['/shop','/about','/faq','/contact','/privacy','/terms','/shipping','/returns','/search?q=silicone','/robots.txt','/sitemap.xml']) assert.equal((await request(route)).status,200,route)
  for(const slug of ['water-based-8oz','water-based-16oz','silicone-based-8oz']) {
    const response=await request('/products/'+slug)
    assert.equal(response.status,200)
    assert.match(await response.text(),/Packaging concept/)
  }
  assert.equal((await request('/images/water16-900.webp')).headers.get('content-type'),'image/webp')
  assert.equal((await request('/checkout')).status,404)
  assert.deepEqual(await (await request('/healthz')).json(),{status:'ok',database:'connected',mode:'coming-soon',signups:true})
})
test('records consent, deduplicates subscriptions, filters interests and honors unsubscribe',async()=>{
  assert.equal((await post('/subscribe',{email,consent:'no'})).status,400)
  for(const address of [email,email.toUpperCase()]) assert.equal((await post('/subscribe',{email:address,consent:'yes',products:slug})).status,200)
  assert.equal((await db.query('SELECT * FROM subscribers')).rowCount,1)
  assert.equal((await db.query('SELECT * FROM subscriber_interests')).rows[0].slug,slug)
  const token=createHmac('sha256',unsubscribeKey).update(email).digest('hex')
  assert.equal((await request('/unsubscribe?'+new URLSearchParams({email,token}))).status,200)
  assert.equal((await post('/unsubscribe',{email,token})).status,200)
  assert.equal((await post('/subscribe',{email,consent:'yes',products:slug})).status,200)
  assert.ok((await db.query('SELECT unsubscribed_at FROM subscribers')).rows[0].unsubscribed_at)
  await post('/subscribe',{email:'honeypot@example.com',consent:'yes',website:'spam'})
  assert.equal((await db.query('SELECT * FROM subscribers')).rowCount,1)
})
test('records visits and selections, discards cross-site requests and honors privacy opt-out',async()=>{
  const cookie=(await request('/')).headers.get('set-cookie').split(';')[0]
  const event=(kind,headers={})=>request('/event',{method:'POST',headers:{'Content-Type':'application/json',cookie,...headers},body:JSON.stringify({kind,slug,referrer:'https://example.com/private',campaign:{source:'newsletter'}})})
  for(const kind of ['home','view','interest','notify']) assert.equal((await event(kind)).status,204)
  assert.equal((await event('view',{'sec-gpc':'1'})).status,204)
  assert.equal((await event('view',{origin:'https://other.example'})).status,403)
  const data=(await db.query('SELECT count(*) records,count(DISTINCT visitor) visitors,max(referrer) referrer FROM events')).rows[0]
  assert.deepEqual(Object.values(data).map(String),['4','1','example.com'])
})
test('authenticates owner, rejects forged forms, saves products and settings and exports CSV',async()=>{
  assert.equal((await request('/admin')).headers.get('location'),'/admin/login')
  assert.equal((await request('/admin/subscribers.csv')).status,303)
  assert.equal((await post('/admin/login',{password:'wrong'})).status,401)
  const login=await post('/admin/login',{password})
  assert.equal(login.status,303)
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/)
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const dash=await request('/admin',{headers:{cookie}})
  assert.match(dash.headers.get('cache-control'),/no-store/)
  const html=await dash.text()
  assert.match(html,/Wellness dashboard/)
  const csrf=html.match(/name="csrf" value="([^"]+)"/)[1]
  assert.equal((await post('/admin/product',{slug},{cookie})).status,403)
  const img=await fs.readFile(require.resolve('../public/images/water16-480.webp'))
  const upload=await request('/admin/image',{method:'POST',headers:{cookie,'content-type':'image/webp','x-csrf-token':csrf},body:img})
  assert.equal(upload.status,200)
  const {id}=await upload.json()
  assert.equal((await request('/media/'+id)).status,404)
  const update=await post('/admin/product',{csrf,slug,customImage:id,name:'Flagship water-based',size:'16 fl oz',price:'22',inventory:'0',description:'Updated concept',enabled:'yes',availability:'Coming Soon',image:'water16'},{cookie})
  assert.equal(update.status,303)
  assert.equal((await request('/media/'+id)).status,200)
  assert.equal((await post('/admin/settings',{csrf,headline:'Closer. Naturally.',story:'DROXION',mode:'commerce'},{cookie})).status,400)
  assert.equal((await post('/admin/settings',{csrf,headline:'Closer. Naturally.',story:'DROXION',mode:'coming-soon'},{cookie})).status,303)
  const csv=await request('/admin/subscribers.csv?product='+slug,{headers:{cookie}})
  assert.match(csv.headers.get('content-type'),/text\/csv/)
  assert.match(await csv.text(),/test\+launch@example.com/)
  assert.equal((await post('/admin/logout',{csrf},{cookie})).status,303)
  assert.equal((await request('/admin',{headers:{cookie}})).status,303)
})
test('calculates projected contribution and break-even with percentage fees',()=>{
  const f=calculate({sale:20,manufacturing:3,inbound:1,packaging:1,shipping:2,marketplace:10,processing:5,paymentFixed:1,ads:1,returns:1,volume:50,inventory:100})
  assert.deepEqual(f,{cost:13,contribution:7,margin:35,breakeven:11.77,monthly:350,inventory:500})
})
