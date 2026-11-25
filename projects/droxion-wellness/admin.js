const {randomBytes, createHash, timingSafeEqual, randomUUID} = require('node:crypto')
const {rateLimit} = require('express-rate-limit')
const {esc, simple, money} = require('./views')
const {transaction, audit, financeFields, calculate} = require('./store')

const hash = value => createHash('sha256').update(value).digest('hex')
const tokensMatch = (a,b) => timingSafeEqual(Buffer.from(hash(String(a))),Buffer.from(hash(String(b))))
const limit = (limit, windowMs=600000) => rateLimit({limit,windowMs,standardHeaders:'draft-8',legacyHeaders:false})
const hidden = csrf => `<input type="hidden" name="csrf" value="${esc(csrf)}">`
const input = (name, label, val='', type='text', attrs='')=>`<label>${esc(label)}<input name="${name}" value="${esc(val)}" type="${type}" ${attrs}></label>`
const csvCell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, match=>"'"+match).replaceAll('"','""') + '"'
const pct = (n,d) => d ? (Number(n)/Number(d)*100).toFixed(1)+'%' : '0%'
const table = (heads, rows) => `<div class="tablewrap"><table><thead><tr>${heads.map(x=>`<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
const row = items => '<tr>'+items.map(x=>`<td>${esc(x)}</td>`).join('')+'</tr>'
const submit = label => `<button class="button">${label}</button>`
const clean = (value,max=500) => typeof value==='string' ? value.trim().slice(0,max) : ''
const validSlug = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length<=70
const positive = (value, max=10000000) => value!==undefined && value!=='' && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=max
const social = value => {
  try {const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : ''} catch { return '' }
}
function loginPage(message='') {
  return simple('Owner sign in',`<p>${esc(message)}</p><form class="signup" action="/admin/login" method="post"><label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>${submit('Sign in')}</form>`)
}
function productForm(p, csrf) {
  return `<form method="post" action="/admin/product" class="productform">${hidden(csrf)}<div class="fields">
${input('slug','Product URL slug',p.slug,'text',p.slug?'readonly required':'required pattern="[a-z0-9]+(-[a-z0-9]+)*"')}${input('name','Product name',p.name,'text','required')}
${input('size','Bottle size',p.size,'text','required')}${input('price','Proposed price ($)',p.price==null?'':p.price/100,'number','required min="0" max="100000" step=".01"')}
${input('inventory','Inventory units',p.inventory??0,'number','required min="0" step="1"')}<label>Availability<select name="availability">${['Coming Soon','In Development','Unavailable'].map(value=>`<option ${p.availability===value?'selected':''}>${value}</option>`).join('')}</select></label>
${input('seoTitle','SEO title',p.seoTitle)}${input('seoDescription','SEO description',p.seoDescription)}
<label>Default packaging image<select name="image">${['water8','water16','silicone8'].map(i=>`<option ${p.image===i?'selected':''}>${i}</option>`).join('')}</select></label></div>
<label>Product description<textarea name="description" required>${esc(p.description)}</textarea></label>
<label><input type="checkbox" name="enabled" value="yes" ${p.enabled!==false?'checked':''}> Visible in storefront</label>
${p.slug?`<label>Replace concept image (WebP, up to 1 MB)<input type="file" accept="image/webp" data-upload></label><input type="hidden" name="customImage"><p class="feedback" role="status"></p>`:''}
${submit('Save product')}</form>`
}
function settingsForm(s, products, csrf) {
  return `<form method="post" action="/admin/settings">${hidden(csrf)}<div class="fields">${input('announcement','Announcement',s.announcement)}${input('headline','Homepage headline',s.headline,'text','required')}
<label>Featured product<select name="featured">${products.filter(p=>p.enabled).map(p=>`<option value="${p.slug}" ${s.featured===p.slug?'selected':''}>${esc(p.name+' · '+p.size)}</option>`).join('')}</select></label>
${input('contact','Public contact email',s.contact,'email')}${input('instagram','Instagram URL',s.instagram,'url')}${input('facebook','Facebook URL',s.facebook,'url')}
<label>Store operating mode<select name="mode"><option value="coming-soon">Coming Soon</option><option disabled>Commerce · verification required</option></select></label></div>
<label>Brand description<textarea name="story" required>${esc(s.story)}</textarea></label>${submit('Save settings')}</form>`
}
async function dashboard(db,catalog,csrf,filter) {
  const [visits,products,subscribers,sources,devices,daily,monthly,records,campaigns] = await Promise.all([
    db.query(`SELECT count(DISTINCT visitor) AS total, count(DISTINCT visitor) FILTER (WHERE at >= date_trunc('day',now(),'America/Chicago')) AS today,
      count(DISTINCT visitor) FILTER (WHERE at >= date_trunc('week',now(),'America/Chicago')) AS week,
      count(DISTINCT visitor) FILTER (WHERE at >= date_trunc('month',now(),'America/Chicago')) AS month,
      count(*) FILTER(WHERE kind='home') home, count(*) FILTER(WHERE kind='view') views,
      (SELECT count(*) FROM subscribers WHERE unsubscribed_at IS NULL) active FROM events`),
    db.query(`WITH metrics AS (SELECT slug, count(*) FILTER(WHERE kind='view') views,
      count(DISTINCT visitor) FILTER(WHERE kind='view') visitors, count(*) FILTER(WHERE kind='notify') clicks,
      count(*) FILTER(WHERE kind='interest') interest FROM events GROUP BY slug),
      signups AS (SELECT slug,count(*) signups FROM subscriber_interests JOIN subscribers USING(email) WHERE unsubscribed_at IS NULL GROUP BY slug)
      SELECT products.slug,coalesce(views,0) views,coalesce(visitors,0) visitors,coalesce(clicks,0) clicks,coalesce(interest,0) interest,coalesce(signups,0) signups
      FROM products LEFT JOIN metrics USING(slug) LEFT JOIN signups USING(slug)`),
    db.query(`SELECT email,consent_at,unsubscribed_at,coalesce(string_agg(slug, ', '),'') interests, consent_version FROM subscribers LEFT JOIN subscriber_interests USING(email)
      WHERE ($1='' OR EXISTS (SELECT 1 FROM subscriber_interests i WHERE i.email=subscribers.email AND i.slug=$1)) GROUP BY email ORDER BY consent_at DESC LIMIT 100`,[filter]),
    db.query(`SELECT coalesce(nullif(campaign->>'source',''),nullif(referrer,''),'Direct') source,count(DISTINCT visitor) visitors FROM events GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    db.query('SELECT device,count(DISTINCT visitor) visitors FROM events GROUP BY device ORDER BY 2 DESC'),
    db.query(`SELECT to_char(at AT TIME ZONE 'America/Chicago','YYYY-MM-DD') period,count(DISTINCT visitor) visitors FROM events WHERE at>=now()-interval '30 days' GROUP BY 1 ORDER BY 1 DESC`),
    db.query(`SELECT to_char(at AT TIME ZONE 'America/Chicago','YYYY-MM') period,count(DISTINCT visitor) visitors FROM events GROUP BY 1 ORDER BY 1 DESC`),
    db.query('SELECT slug,kind,data,at FROM finances ORDER BY id DESC LIMIT 50'),
    db.query(`SELECT referrer, campaign, count(DISTINCT visitor) AS visitors FROM events
      WHERE referrer<>'' OR campaign->>'source'<>'' OR campaign->>'medium'<>'' OR campaign->>'campaign'<>'' OR campaign->>'content'<>'' OR campaign->>'term'<>''
      GROUP BY referrer,campaign ORDER BY visitors DESC LIMIT 30`)
  ])
  const v = visits.rows[0]
  const popular = [...products.rows].sort((a,b)=>Number(b.signups)-Number(a.signups)||Number(b.views)-Number(a.views))[0]
  const top = popular && (Number(popular.signups)||Number(popular.views)) ? catalog.products.find(p=>p.slug===popular.slug) : null
  const totalProductVisitors = products.rows.reduce((n,p)=>n+Number(p.visitors),0)
  const totalProductSignups = products.rows.reduce((n,p)=>n+Number(p.signups),0)
  const metrics = {'Unique visitors (retained)':v.total,'Today':v.today,'This week':v.week,'This month':v.month,'Homepage views':v.home,'Product views':v.views,'Active registrations':v.active,'Product interest conversion':pct(totalProductSignups,totalProductVisitors),'Most popular':top?top.name+' · '+top.size:'—'}
  function chart(rows) {
    const max=Math.max(1,...rows.map(r=>Number(r.visitors)))
    return rows.length?table(['Period','Unique visitors'],rows.map(r=>`<tr><td>${esc(r.period)}</td><td><meter min="0" max="${max}" value="${Number(r.visitors)}" aria-label="Visitors on ${esc(r.period)}"></meter> ${Number(r.visitors)}</td></tr>`)):'<p>0 visitors</p>'
  }
  return `<section class="wrap section admin"><h1>Wellness dashboard</h1><form method="post" action="/admin/logout">${hidden(csrf)}${submit('Sign out')}</form>
<h2>Demand validation</h2><div class="metrics">${Object.entries(metrics).map(([k,val])=>`<div>${esc(k)}<br><strong>${esc(val)}</strong></div>`).join('')}</div>
<p class="micro">First-party traffic. Dates use Central time. Product conversion compares active product subscriptions with unique measured product views. Visitors may opt out of measurement.</p>
${table(['Product','Price','Views','Unique','Interest clicks','Notify clicks','Signups','Conversion','Availability'],products.rows.map(r=>{const p=catalog.products.find(p=>p.slug===r.slug);return row([p.name+' · '+p.size,money(p.price),r.views,r.visitors,r.interest,r.clicks,r.signups,pct(r.signups,r.visitors),p.enabled?p.availability:'Hidden'])}))}
<h2>Traffic sources</h2>${table(['Source','Unique visitors'],sources.rows.length?sources.rows.map(r=>row([r.source,r.visitors])):[row(['—',0])])}
<h2>Referrers and campaign tags</h2>${table(['Referrer','Source','Medium','Campaign','Content','Term','Unique visitors'],campaigns.rows.length?campaigns.rows.map(r=>row([r.referrer,...['source','medium','campaign','content','term'].map(key=>r.campaign[key]),r.visitors])):[row(['—','—','—','—','—','—',0])])}
<h2>Devices</h2>${table(['Device','Unique visitors'],devices.rows.length?devices.rows.map(r=>row([r.device,r.visitors])):[row(['—',0])])}
<h2>Daily growth</h2>${chart(daily.rows)}<h2>Monthly growth</h2>${chart(monthly.rows)}
<h2>Products</h2>${catalog.products.map(p=>`<details><summary>${esc(p.name+' · '+p.size)}</summary>${productForm(p,csrf)}</details>`).join('')}<details><summary>Add product</summary>${productForm({},csrf)}</details>
<h2>Website settings</h2>${settingsForm(catalog.settings,catalog.products,csrf)}
<h2>Launch list</h2><form action="/admin" method="get"><label>Filter by product<select name="product"><option value="">All products</option>${catalog.products.map(p=>`<option value="${p.slug}" ${filter===p.slug?'selected':''}>${esc(p.name+' · '+p.size)}</option>`).join('')}</select></label>${submit('Apply filter')}</form><p><a href="/admin/subscribers.csv?product=${encodeURIComponent(filter)}">Export subscribers as CSV</a></p>
${table(['Email','Interests','Consent','Status','Action'],subscribers.rows.map(r=>`<tr><td>${esc(r.email)}</td><td>${esc(r.interests)}</td><td>${esc(new Date(r.consent_at).toISOString())}</td><td>${r.unsubscribed_at?'Unsubscribed':'Active'}</td><td><form method="post" action="/admin/remove">${hidden(csrf)}<input type="hidden" name="email" value="${esc(r.email)}"><button name="action" value="unsubscribe">Unsubscribe</button><button name="action" value="delete">Remove</button></form></td></tr>`))}
<h2>Financial records</h2><form method="post" action="/admin/finance">${hidden(csrf)}<div class="fields"><label>Record type<select name="kind"><option>projection</option><option>actual</option></select></label><label>Product<select name="slug">${catalog.products.map(p=>`<option value="${p.slug}">${esc(p.name+' · '+p.size)}</option>`).join('')}</select></label>
${Object.entries(financeFields).map(([key,label])=>input(key,label,0,'number',`min="0" step="${['volume','inventory'].includes(key)?1:'.01'}" required`)).join('')}</div>${submit('Save financial record')}</form>
${['projection','actual'].map(kind=>`<h3>${kind==='actual'?'Actuals':'Projections'}</h3>`+table(['Product','Cost/unit','Contribution/unit','Margin','Break-even','Monthly contribution','Inventory investment'],records.rows.filter(r=>r.kind===kind).map(r=>{const v=calculate(r.data);return row([r.slug,...[v.cost,v.contribution,v.margin,v.breakeven,v.monthly,v.inventory].map((x,i)=>x==null?'—':i===2?x.toFixed(1)+'%':money(x*100))])}))).join('')}</section>`
}
function registerAdmin(app, db, getCatalog, send, config) {
  app.use('/admin',(req,res,next)=>{
    res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'})
    if (!db || !config.adminHash) return send(res,503,'Owner access',simple('Owner access','<p>Owner access is awaiting configuration.</p>'),{admin:true})
    next()
  })
  const cookie = {httpOnly:true,secure:config.secure,sameSite:'strict',path:'/admin'}
  app.get('/admin/login',(req,res)=>send(res,200,'Owner sign in',loginPage(),{admin:true}))
  app.post('/admin/login',limit(7),async(req,res)=>{
    const password = clean(req.body?.password,256)
    if (!password || !tokensMatch(hash(password),config.adminHash)) return send(res,401,'Owner sign in',loginPage('Sign-in failed.'),{admin:true})
    const token = randomBytes(32).toString('hex')
    await db.query('INSERT INTO admin_sessions VALUES ($1,$2,now()+interval \'8 hours\')',[hash(token),randomBytes(32).toString('hex')])
    res.cookie('dw_owner',token,{...cookie,maxAge:8*3600000}).redirect(303,'/admin')
  })
  app.use('/admin',async(req,res,next)=>{
    const token = req.cookies.dw_owner
    if (!token) return res.redirect(303,'/admin/login')
    const session = (await db.query('SELECT csrf FROM admin_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(token)])).rows[0]
    if (!session) return res.clearCookie('dw_owner',cookie).redirect(303,'/admin/login')
    if (req.method==='POST' && !tokensMatch(req.body?.csrf??req.get('x-csrf-token'),session.csrf)) return res.sendStatus(403)
    req.owner = {...session,token}
    next()
  })
  app.get('/admin',async(req,res)=>send(res,200,'Owner dashboard',await dashboard(db,await getCatalog(true),req.owner.csrf,clean(req.query.product,70)),{admin:true}))
  app.post('/admin/logout',async(req,res)=>{
    await db.query('DELETE FROM admin_sessions WHERE token_hash=$1',[hash(req.owner.token)])
    res.clearCookie('dw_owner',cookie).redirect(303,'/admin/login')
  })
  app.post('/admin/image',require('express').raw({type:'image/webp',limit:'1mb'}),async(req,res)=>{
    const b=req.body
    if (!Buffer.isBuffer(b) || b.length<30 || b.toString('ascii',0,4)!=='RIFF' || b.toString('ascii',8,12)!=='WEBP' || b.readUInt32LE(4)+8!==b.length) return res.sendStatus(400)
    const id=randomUUID()
    await transaction(db,async conn=>{
      await conn.query('INSERT INTO media VALUES ($1,$2)',[id,b])
      await audit(conn,'upload-image',id)
    })
    res.json({id})
  })
  app.post('/admin/product',async(req,res)=>{
    const b=req.body
    const slug=clean(b.slug,71)
    if (!validSlug(slug) || !positive(b.price,100000) || !positive(b.inventory) || !Number.isInteger(Number(b.inventory))) return res.sendStatus(400)
    const p={slug,name:clean(b.name,120),size:clean(b.size,80),price:Math.round(Number(b.price)*100),inventory:Number(b.inventory),
      description:clean(b.description,2400),enabled:b.enabled==='yes',availability:clean(b.availability,60),image:clean(b.image,12),seoTitle:clean(b.seoTitle,90),seoDescription:clean(b.seoDescription,180)}
    if (!p.name||!p.size||!p.description||!['Coming Soon','In Development','Unavailable'].includes(p.availability)||!['water8','water16','silicone8'].includes(p.image)) return res.sendStatus(400)
    await transaction(db,async conn=>{
      const prior=(await conn.query('SELECT data FROM products WHERE slug=$1 FOR UPDATE',[slug])).rows[0]?.data
      if (/^[0-9a-f-]{36}$/.test(b.customImage??'') && (await conn.query('SELECT id FROM media WHERE id::text=$1',[b.customImage])).rowCount) p.customImage=b.customImage
      else if (prior?.customImage) p.customImage=prior.customImage
      await conn.query('INSERT INTO products VALUES ($1,$2,$3) ON CONFLICT(slug) DO UPDATE SET enabled=excluded.enabled,data=excluded.data',[slug,p.enabled,p])
      await audit(conn,'save-product',slug)
    })
    res.redirect(303,'/admin')
  })
  app.post('/admin/settings',async(req,res)=>{
    const b=req.body
    if (b.mode!=='coming-soon' || !clean(b.headline,90) || !clean(b.story,1200)) return res.sendStatus(400)
    const contact=clean(b.contact,254)
    if (contact && !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(contact)) return res.sendStatus(400)
    const s={announcement:clean(b.announcement,150),headline:clean(b.headline,90),story:clean(b.story,1200),contact,mode:b.mode,
      instagram:social(b.instagram),facebook:social(b.facebook),featured:validSlug(clean(b.featured,71))?b.featured:''}
    await transaction(db,async conn=>{
      await conn.query('UPDATE settings SET data=$1 WHERE id',[s])
      await audit(conn,'save-settings','storefront')
    })
    res.redirect(303,'/admin')
  })
  app.get('/admin/subscribers.csv',async(req,res)=>{
    const filter=clean(req.query.product,70)
    const data=await db.query(`SELECT email,consent_at,consent_version,unsubscribed_at,coalesce(string_agg(slug, ', '),'') interests FROM subscribers LEFT JOIN subscriber_interests USING(email)
      WHERE ($1='' OR EXISTS(SELECT 1 FROM subscriber_interests i WHERE i.email=subscribers.email AND i.slug=$1)) GROUP BY email ORDER BY consent_at DESC`,[filter])
    const headings=['email','consent_at','consent_version','unsubscribed_at','interests','unsubscribe_url']
    for (const record of data.rows) {
      const token = config.unsubscribeToken?.(record.email)
      if (token) record.unsubscribe_url = (config.origin || 'https://droxion.com') + '/unsubscribe?' + new URLSearchParams({email:record.email,token})
    }
    res.attachment('launch-subscribers.csv').type('text/csv').send([headings.join(','),...data.rows.map(r=>headings.map(k=>csvCell(r[k] instanceof Date?r[k].toISOString():r[k])).join(','))].join('\r\n'))
  })
  app.post('/admin/remove',async(req,res)=>{
    const {email,action}=req.body
    if (typeof email!=='string'||!['delete','unsubscribe'].includes(action)) return res.sendStatus(400)
    await transaction(db,async conn=>{
      if(action==='delete') await conn.query('DELETE FROM subscribers WHERE email=$1',[email])
      else await conn.query('UPDATE subscribers SET unsubscribed_at=now() WHERE email=$1 AND unsubscribed_at IS NULL',[email])
      await audit(conn,action+'-subscriber','launch-list')
    })
    res.redirect(303,'/admin')
  })
  app.post('/admin/finance',async(req,res)=>{
    const b=req.body
    if (!['projection','actual'].includes(b.kind)||!validSlug(clean(b.slug,71))) return res.sendStatus(400)
    const keys=Object.keys(financeFields)
    if(keys.some(k=>!positive(b[k],['marketplace','processing'].includes(k)?100:10000000))) return res.sendStatus(400)
    const data=Object.fromEntries(keys.map(k=>[k,Number(b[k])]))
    if(data.marketplace+data.processing>=100 || !Number.isInteger(data.volume)||!Number.isInteger(data.inventory)) return res.sendStatus(400)
    if (!(await db.query('SELECT slug FROM products WHERE slug=$1',[b.slug])).rowCount) return res.sendStatus(400)
    await transaction(db,async conn=>{
      await conn.query('INSERT INTO finances(kind,slug,data) VALUES ($1,$2,$3)',[b.kind,b.slug,data])
      await audit(conn,'save-finances',b.slug)
    })
    res.redirect(303,'/admin')
  })
}
module.exports={registerAdmin,hash,limit,clean}
