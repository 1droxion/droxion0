const {chromium,firefox,webkit,devices}=require('playwright-core')
const assert=require('node:assert/strict')
const {PGlite}=require('@electric-sql/pglite')
const {once}=require('node:events')
const {mkdir}=require('node:fs/promises')
const {createApp}=require('./server')
const {migrate}=require('./store')
const {hash}=require('./admin')
async function main() {
  const password='local-browser-owner-password'
  const db=new PGlite()
  const migration={query:(sql,params)=>!params&&sql.includes(';')?db.exec(sql):db.query(sql,params)}
  await migrate(migration)
  const server=createApp({query:db.query.bind(db),connect:async()=>({query:db.query.bind(db),release(){}})},
    {adminHash:hash(password),countHeadless:true,unsubscribeKey:'local-only-key'}).listen(0,'127.0.0.1')
  await once(server,'listening')
  const base='http://127.0.0.1:'+server.address().port
  const screenshotDir=process.env.SCREENSHOT_DIR
  if (screenshotDir) await mkdir(screenshotDir,{recursive:true})
  const variants=[
    ['desktop',chromium,{viewport:{width:1440,height:1000}}],
    ['wide',chromium,{viewport:{width:1920,height:1080}}],
    ['iphone',chromium,devices['iPhone 13']],
    ['android',chromium,devices['Pixel 7']],
    ['tablet',chromium,devices['iPad (gen 7)']]
  ]
  if(process.env.PLAYWRIGHT_CROSS_BROWSER==='1') {
    variants.push(['firefox',firefox,{viewport:{width:1366,height:900}}],['webkit',webkit,{viewport:{width:1440,height:1000}}])
  }
  try {
    for(const [name,engine,options] of variants) {
      const executablePath=engine===chromium?process.env.CHROMIUM_PATH||'/usr/bin/chromium':undefined
      const browser=await engine.launch({executablePath})
      try {
        const page=await browser.newPage(options)
        const errors=[]
        page.on('pageerror',error=>errors.push(error.message))
        page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
        page.on('requestfailed',request=>{
          if (request.failure()?.errorText!=='net::ERR_ABORTED') errors.push(request.url())
        })
        await page.goto(base)
        await page.getByRole('heading',{name:'Make tonight feel closer.'}).waitFor()
        assert.equal(await page.locator('.heroimage img').evaluate(img=>img.complete&&img.naturalWidth>0),true)
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
        if(screenshotDir&&['desktop','iphone'].includes(name)) await page.screenshot({path:screenshotDir+'/'+name+'.png',fullPage:true})
        if(await page.getByText('Menu',{exact:true}).isVisible()) {
          await page.getByText('Menu',{exact:true}).click()
          await page.locator('.mobile').getByRole('link',{name:'Shop'}).click()
        } else {
          await page.locator('header').getByRole('link',{name:'Shop'}).click()
        }
        await page.waitForURL('**/shop')
        assert.equal(await page.getByRole('heading',{name:'The collection'}).count(),1)
        for(const slug of ['water-based-8oz','water-based-16oz','silicone-based-8oz']) {
          await page.goto(base+'/products/'+slug)
          await page.getByRole('button',{name:'Enlarge packaging concept'}).click()
          await page.getByRole('dialog').waitFor()
          await page.getByRole('button',{name:'Close',exact:true}).click()
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
        }
        await page.getByLabel('Email address').fill(name+'@example.com')
        await page.getByLabel('Email me about the DROXION launch.').check()
        await page.getByRole('button',{name:'Notify me',exact:true}).click()
        await page.getByRole('status').filter({hasText:'Thanks.'}).waitFor()
        assert.deepEqual(errors,[])
        console.log(name+' passed')
      } finally { await browser.close() }
    }
  } finally { server.close();await db.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
