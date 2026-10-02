import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const origin = 'https://aion2web.cc328496536.workers.dev'
const vars = { ...Object.fromEntries((existsSync('.dev.vars') ? readFileSync('.dev.vars','utf8') : '').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (!match) return []
  return [[match[1],match[2].trim().replace(/^(["'])(.*)\1$/,'$2')]]
})), ...process.env }
assert.ok(vars.ADMIN_PASSWORD || vars.UPLOAD_API_TOKEN, 'Set ADMIN_USERNAME and ADMIN_PASSWORD in the environment for this optional live test. Existing signed-in browser UI can also verify the deployment.')
const report={origin,startedAt:new Date().toISOString(),checks:[],scope:'Authenticated config read and AI simulations only; no player messages, no production settings changes'}
const login=await fetch(origin+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:vars.ADMIN_USERNAME||'admin',password:vars.ADMIN_PASSWORD||vars.UPLOAD_API_TOKEN})})
assert.equal(login.status,200,'Authentication must succeed using existing deployment credentials')
const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie)
assert.equal((await fetch(origin+'/api/ai/reception')).status,401);report.checks.push({name:'anonymous API denied',passed:true})
const configResponse=await fetch(origin+'/api/ai/reception',{headers:{cookie}})
assert.equal(configResponse.status,200);const config=await configResponse.json();assert.ok(config.ok&&Array.isArray(config.profiles));report.checks.push({name:'authenticated D1 config and queue read',passed:true})
async function preview(content, expected, simulation) {
 const response=await fetch(origin+'/api/ai/reception',{method:'POST',headers:{cookie,'Content-Type':'application/json',origin},body:JSON.stringify({action:'preview',simulation,input:{serverId:'preview',characterId:'preview',characterName:'Simulation',instruction:'',history:[{id:crypto.randomUUID(),direction:'incoming',content,time:new Date().toISOString()}]}}),signal:AbortSignal.timeout(65000)})
 const result=await response.json();assert.equal(response.status,200,result.error||'model preview failed');assert.ok(result.ok)
 assert.ok(expected.includes(result.decision.action),`Unexpected action ${result.decision.action} for ${content}`)
 report.checks.push({name:content,passed:true,action:result.decision.action,intent:result.decision.intent,reply:result.decision.reply,issues:result.issues})
 return result
}
await preview('My damage is terrible lol',['ask','reply'])
await preview('Please stop messaging me. Do not contact me again.',['close'])
await preview('Could you connect me with a human support agent?',['handoff'])
await preview('Send me your Discord invite.',['wait'],{status:'human',memory:'A human has taken over',discordDeclined:false,paidDeclined:false,discordSent:false,sentGuides:[]})
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const browser=await chromium.launch({headless:true,channel:'msedge'})
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 const split=cookie.indexOf('=')
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}])
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(origin+'/reception',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'AI 接待台',exact:true,level:2}).waitFor()
 await page.getByRole('button',{name:'内容与规则',exact:true}).click()
 await page.getByRole('heading',{name:'内容库与接待规则'}).waitFor()
 await page.screenshot({path:'artifacts/reception-live-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/reception-live-mobile.png',fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[]);report.checks.push({name:'production desktop/mobile route, authenticated navigation and no page errors',passed:true})
} finally {await browser.close()}
report.completedAt=new Date().toISOString();report.passed=true
writeFileSync('artifacts/reception-live-report.json',JSON.stringify(report,null,2)+'\n')
console.log(`PASS: ${report.checks.length} production checks; real AI previews only, no player sends or content changes`)
