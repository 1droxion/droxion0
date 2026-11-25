const express = require('express')
const helmet = require('helmet')
const path = require('node:path')
const {randomUUID, createHmac, createHash, timingSafeEqual} = require('node:crypto')
const seed = require('./catalog.json')
const {connect,transaction} = require('./store')
const {esc,defaults,asset,layout,card,faq,commonFAQ,home,productPage,simple} = require('./views')
const {registerAdmin,limit,clean} = require('./admin')

const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const publicPages = {
  '/about':['About', s=>`<p>${esc(s.story)}</p><p>We’re developing our first collection of water-based and silicone-based personal lubricants.</p>`],
  '/faq':['Frequently asked questions',()=>faq(commonFAQ)],
  '/contact':['Contact',s=>s.contact?`<p>Email <a href="mailto:${esc(s.contact)}">${esc(s.contact)}</a>.</p>`:'<p>For product news, <a href="/#launch">join the launch list</a>. Our contact email will be published here when it is available.</p>'],
  '/privacy':['Privacy policy',s=>`<p>We collect the email address, consent date and selected product interests when you sign up. We use this information to manage launch updates and understand demand.</p>
  <p>We measure visits and product interest using a first-party identifier that expires after 30 days. We record broad device type, referring domain and campaign tags. We do not send this information to advertising platforms. Visit data is retained for up to 180 days during normal operation. Global Privacy Control and Do Not Track signals turn off measurement.</p>
  <p>Use the unsubscribe link in a launch email to stop receiving updates.${s.contact?` For access or deletion requests, email <a href="mailto:${esc(s.contact)}">${esc(s.contact)}</a>.`:''}</p>`],
  '/terms':['Terms of service',()=>'<p>DROXION Wellness is developing its first collection. Product images, packaging, prices and details shown are preliminary. The website is currently for information and launch notifications.</p>'],
  '/shipping':['Shipping policy',()=>'<p>Shipping details will be published before orders open.</p>'],
  '/returns':['Return policy',()=>'<p>Return details will be published before orders open.</p>']
}
function referringHost(value, current) {
  try {
    const url = new URL(value)
    if (!['http:','https:'].includes(url.protocol) || url.host===current) return ''
    return url.hostname.slice(0,180)
  } catch { return '' }
}
function createApp(db, config={}) {
  const app=express()
  app.disable('x-powered-by')
  if (config.proxy) app.set('trust proxy',config.proxy)
  app.use(helmet({
    contentSecurityPolicy:{directives:{defaultSrc:["'self'"],imgSrc:["'self'"],formAction:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.secure?[]:null}},
    referrerPolicy:{policy:'strict-origin-when-cross-origin'},
    strictTransportSecurity:config.secure?{maxAge:31536000}:false
  }))
  app.use((req,res,next)=>{
    res.set('Permissions-Policy','camera=(), microphone=(), geolocation=()')
    if(config.staging) res.set('X-Robots-Tag','noindex, nofollow')
    const origin=req.get('origin')
    if (req.method==='POST' && (req.get('sec-fetch-site')==='cross-site' || (origin && origin !== `${req.protocol}://${req.get('host')}` && origin !== config.origin))) return res.sendStatus(403)
    req.cookies=Object.fromEntries((req.get('cookie')||'').split(';').map(piece=>piece.trim().split('=').slice(0,2)).filter(parts=>parts.length===2))
    next()
  })
  app.use(express.static(path.join(__dirname,'public'),{index:false,maxAge:'1h',setHeaders(res,file){if(file.endsWith('.webp')) res.set('Cache-Control','public, max-age=86400')}}))
  app.use(express.urlencoded({extended:false,limit:'16kb',parameterLimit:30}),express.json({limit:'8kb'}))
  let cache
  async function getCatalog(fresh=false) {
    if (!db) return {products:seed,settings:defaults}
    if (!fresh && cache?.expires>Date.now()) return cache.data
    const [products,settings]=await Promise.all([db.query('SELECT data FROM products ORDER BY slug'),db.query('SELECT data FROM settings WHERE id')])
    const ordered=products.rows.map(x=>x.data)
    const rank=slug=>{const index=seed.findIndex(p=>p.slug===slug);return index<0?seed.length:index}
    ordered.sort((a,b)=>rank(a.slug)-rank(b.slug))
    const data={products:ordered,settings:{...defaults,...settings.rows[0].data}}
    cache={data,expires:Date.now()+3000}
    return data
  }
  function send(res,status,title,body,extras={}) {
    res.status(status).send(layout({title,body,staging:config.staging,...extras}))
  }
  app.use((req,res,next)=>{
    if (db && config.analytics!==false && req.method==='GET' && (['/','/shop','/search'].includes(req.path) || req.path.startsWith('/products/'))) {
      if (!uuid.test(req.cookies.dw_visit||'') && req.get('sec-gpc')!=='1' && req.get('dnt')!=='1')
        res.cookie('dw_visit',randomUUID(),{httpOnly:true,secure:config.secure,sameSite:'lax',maxAge:30*86400000})
    }
    next()
  })
  const signupOpen=Boolean(db)&&config.signups!==false
  const tokenKey=config.unsubscribeKey
  const unsubscribeToken=email=>createHmac('sha256',tokenKey).update(email).digest('hex')
  app.get('/healthz',async(req,res)=>{
    if(db) await db.query('SELECT 1')
    res.json({status:'ok',database:db?'connected':'unconfigured',mode:'coming-soon',signups:signupOpen})
  })
  for(const [route,[title,body]] of Object.entries(publicPages)) {
    app.get(route,async(req,res)=>{
      const {settings}=await getCatalog()
      send(res,200,title,simple(title,body(settings)),{path:route,settings})
    })
  }
  app.get('/',async(req,res)=>{
    const {products,settings}=await getCatalog()
    send(res,200,'Closer. Naturally.',home(products.filter(p=>p.enabled),settings,signupOpen),{settings})
  })
  for(const route of ['/shop','/search']) {
    app.get(route,async(req,res)=>{
      const {products,settings}=await getCatalog()
      const q=clean(req.query.q,100)
      const found=products.filter(p=>p.enabled && [p.name,p.size,p.description].join(' ').toLowerCase().includes(q.toLowerCase()))
      const title=route==='/shop'?'The collection':'Search'
      const form=route==='/search'?`<form action="/search" method="get" class="signup"><label>Search products<input name="q" type="search" value="${esc(q)}"></label><button class="button">Search</button></form>`:'<p>Our first collection is in development.</p>'
      send(res,200,title,`<section class="wrap section"><h1>${title}</h1>${form}<div class="grid spec">${found.map(card).join('')||'<p>No products found.</p>'}</div></section>`,{path:route,settings,staging:config.staging||route==='/search'})
    })
  }
  app.get('/products/:slug',async(req,res)=>{
    const {products,settings}=await getCatalog()
    const active=products.filter(p=>p.enabled)
    const p=active.find(p=>p.slug===req.params.slug)
    if(!p) return send(res,404,'Product unavailable',simple('Product unavailable','<p><a href="/shop">Explore the collection</a></p>'),{staging:true})
    send(res,200,p.seoTitle||p.name+' · '+p.size,productPage(p,active,signupOpen),{path:'/products/'+p.slug,product:p.slug,settings,description:p.seoDescription||p.description,image:asset(p)})
  })
  app.get('/media/:id',async(req,res)=>{
    if(!db||!uuid.test(req.params.id)) return res.sendStatus(404)
    const result=await db.query('SELECT contents FROM media WHERE id=$1 AND EXISTS (SELECT 1 FROM products WHERE data->>\'customImage\'=$2 AND enabled)',[req.params.id,req.params.id])
    if(!result.rowCount) return res.sendStatus(404)
    res.set('Cache-Control','public, max-age=3600').type('image/webp').send(result.rows[0].contents)
  })
  app.get('/robots.txt',(req,res)=>res.type('text').send(config.staging?'User-agent: *\nDisallow: /\n':'User-agent: *\nDisallow: /admin\nDisallow: /unsubscribe\nSitemap: https://droxion.com/sitemap.xml\n'))
  app.get('/sitemap.xml',async(req,res)=>{
    const {products}=await getCatalog()
    const pages=['/','/shop',...Object.keys(publicPages),...products.filter(p=>p.enabled).map(p=>'/products/'+p.slug)]
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+pages.map(p=>`<url><loc>https://droxion.com${p}</loc></url>`).join('')+'</urlset>')
  })
  app.post('/event',limit(150,60000),async(req,res)=>{
    const b=req.body||{}
    if (!db||config.analytics===false||req.get('sec-gpc')==='1'||req.get('dnt')==='1') return res.sendStatus(204)
    if (!['home','view','interest','notify'].includes(b.kind)) return res.sendStatus(400)
    const slug=clean(b.slug,70)
    if (b.kind!=='home' && !(await getCatalog()).products.some(p=>p.slug===slug&&p.enabled)) return res.sendStatus(400)
    const visitor=uuid.test(req.cookies.dw_visit||'')?req.cookies.dw_visit:randomUUID()
    const ua=req.get('user-agent')||''
    if (/bot|crawler|spider|headless/i.test(ua)&&!config.countHeadless) return res.sendStatus(204)
    const device=/ipad|tablet|android(?!.*mobile)/i.test(ua)?'Tablet':/mobile|iphone/i.test(ua)?'Mobile':'Desktop'
    const campaign=Object.fromEntries(['source','medium','campaign','content','term'].map(k=>[k,clean(b.campaign?.[k],80).replace(/[^a-z0-9 _.-]/gi,'')]))
    await db.query('INSERT INTO events(visitor,kind,slug,device,referrer,campaign) VALUES ($1,$2,$3,$4,$5,$6)',
      [visitor,b.kind,b.kind==='home'?null:slug,device,referringHost(b.referrer,req.get('host')),campaign])
    if(visitor!==req.cookies.dw_visit) res.cookie('dw_visit',visitor,{httpOnly:true,secure:config.secure,sameSite:'lax',maxAge:30*86400000})
    res.sendStatus(204)
  })
  app.post('/subscribe',limit(12),async(req,res)=>{
    const respond=(status,message)=>req.get('accept')==='application/json'?res.status(status).json({message}):send(res,status,'Launch list',simple('Launch list',`<p>${esc(message)}</p><p><a href="/">Return to the homepage</a></p>`),{staging:true})
    if(!signupOpen) return respond(503,'Launch signups are temporarily unavailable.')
    const {email:raw,consent,website,products}=req.body||{}
    const email=clean(raw,255).toLowerCase()
    if(!emailPattern.test(email)||email.length>254||consent!=='yes') return respond(400,'Enter a valid email address and confirm you want launch updates.')
    const success='Thanks. If your address is eligible, we’ll email you about the launch.'
    if(website) return respond(200,success)
    const desired=Array.isArray(products)?products:[products]
    if(desired.length>25) return respond(400,'Choose up to 25 products.')
    await transaction(db,async conn=>{
      await conn.query('INSERT INTO subscribers(email,consent_version) VALUES ($1,$2) ON CONFLICT DO NOTHING',[email,'launch-2026-11'])
      const subscriber=await conn.query('SELECT unsubscribed_at FROM subscribers WHERE email=$1 FOR UPDATE',[email])
      if(!subscriber.rows[0] || subscriber.rows[0].unsubscribed_at) return
      await conn.query(`INSERT INTO subscriber_interests(email,slug) SELECT $1,slug FROM products WHERE enabled AND slug = ANY($2::text[]) ON CONFLICT DO NOTHING`,[email,desired.filter(x=>typeof x==='string')])
    })
    respond(200,success)
  })
  const checkUnsubscribe=(req,res,next)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'})
    const {email,token}=req.method==='GET'?req.query:req.body||{}
    if(!db||!tokenKey||typeof email!=='string'||email.length>254||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||
      !timingSafeEqual(Buffer.from(token),Buffer.from(unsubscribeToken(email)))) return res.sendStatus(404)
    req.unsubscribe={email,token}
    next()
  }
  app.get('/unsubscribe',checkUnsubscribe,(req,res)=>{
    const {email,token}=req.unsubscribe
    send(res,200,'Unsubscribe',simple('Leave the launch list',`<form method="post" action="/unsubscribe"><input type="hidden" name="email" value="${esc(email)}"><input type="hidden" name="token" value="${esc(token)}"><button class="button">Unsubscribe</button></form>`),{admin:true})
  })
  app.post('/unsubscribe',limit(15),checkUnsubscribe,async(req,res)=>{
    await db.query('UPDATE subscribers SET unsubscribed_at=now() WHERE email=$1 AND unsubscribed_at IS NULL',[req.unsubscribe.email])
    send(res,200,'Unsubscribed',simple('You’re unsubscribed','<p>You will no longer receive DROXION launch updates.</p>'),{admin:true})
  })
  registerAdmin(app,db,getCatalog,send,{...config,unsubscribeToken:tokenKey?unsubscribeToken:null})
  app.use((req,res)=>send(res,404,'Page not found',simple('Page not found','<p><a href="/">Return to DROXION Wellness</a></p>'),{staging:true}))
  app.use((err,req,res,next)=>{
    if(res.headersSent) return next(err)
    const status=[400,413,415].includes(err.status)?err.status:500
    if(status===500) console.error('Request failed',req.method,err.code||err.name)
    if(req.get('accept')==='application/json') return res.status(status).json({message:'Could not complete that request. Please try again.'})
    send(res,status,'Request unavailable',simple('Request unavailable','<p>Please try again or <a href="/">return home</a>.</p>'),{staging:true,admin:req.path.startsWith('/admin')})
  })
  return app
}
if(require.main===module) {
  connect().then(db=>{
    const password=process.env.ADMIN_PASSWORD
    const adminHash=/^[0-9a-f]{64}$/.test(process.env.ADMIN_PASSWORD_SHA256||'')?process.env.ADMIN_PASSWORD_SHA256:
      password?.length>=24?createHash('sha256').update(password).digest('hex'):undefined
    const app=createApp(db,{secure:process.env.NODE_ENV==='production',proxy:Number(process.env.TRUST_PROXY)||false,
      origin:process.env.PUBLIC_ORIGIN,adminHash,unsubscribeKey:process.env.UNSUBSCRIBE_KEY,
      staging:process.env.STAGING!=='false',signups:process.env.SIGNUPS_ENABLED!=='false',analytics:process.env.ANALYTICS_ENABLED!=='false'})
    if (db) setInterval(()=>{
      db.query("DELETE FROM events WHERE at < now() - interval '180 days'").catch(error=>console.error('Analytics retention cleanup failed',error.code))
      db.query('DELETE FROM admin_sessions WHERE expires_at <= now()').catch(error=>console.error('Session cleanup failed',error.code))
    },86400000).unref()
    app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('DROXION Wellness listening'))
  }).catch(error=>{console.error('Startup failed',error.code||error.name);process.exitCode=1;process.exit()})
}
module.exports={createApp}
