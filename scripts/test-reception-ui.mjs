import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const bundle=await build({stdin:{contents:`import {createRoot} from 'react-dom/client'; import {ReceptionPanel} from './src/components/reception-panel';createRoot(document.getElementById('root')).render(<ReceptionPanel/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})
let settings={businessFacts:'',style:'Natural gaming chat',discordUrl:'',discordPurpose:'',guides:[]}
let persona={name:'Existing persona',systemPrompt:'AION2 helper',stylePrompt:'Existing English voice',goalPrompt:'Understand player needs',forbiddenPrompt:'Do not spam',examplePrompt:'Hi there',updatedAt:1}
let personaFail=false, personaReadFail=false
const decision={need:'了解付费辅导',evidence:'How much?',missing:[],intent:'pricing',action:'handoff',reason:'玩家同意交接',reply:'',guideId:'',handoffTo:'sales',handoffAccepted:true,discordPreference:'unknown',paidPreference:'unknown',stopRequested:false,summary:'玩家希望了解辅导价格，已同意转真人。'}
let profile={serverId:'1001',characterId:'1',characterName:'Nightblade',status:'waiting',version:1,memory:decision.summary,discordDeclined:false,paidDeclined:false,discordSent:false,sentGuides:[],decision,updatedAt:Date.now(),assignedTo:''}
let fail=false,simulationCount=0
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('src/styles.css'));return}
 if(req.url==='/api/ai/persona'){
  res.setHeader('Content-Type','application/json')
  if((req.method==='GET' && personaReadFail) || (req.method==='PUT' && personaFail)){res.statusCode=500;res.end(JSON.stringify({error:'测试人设失败'}));return}
  if(req.method==='PUT'){let raw='';for await(const chunk of req)raw+=chunk;persona={...JSON.parse(raw),updatedAt:Date.now()}}
  res.end(JSON.stringify({persona}));return
 }
 if(req.url?.startsWith('/api/ai/reception')){
  res.setHeader('Content-Type','application/json')
  if(req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)
   if(fail){res.statusCode=500;res.end(JSON.stringify({ok:false,error:'测试保存失败'}));return}
   if(body.action==='settings')settings=body.settings
   if(body.action==='control')profile={...profile,status:body.status,version:profile.version+1,assignedTo:'Alice',updatedAt:Date.now()}
   if(body.action==='preview'){simulationCount++;res.end(JSON.stringify({ok:true,decision:{...decision,action:'ask',intent:'none',reply:'What class are you playing?',handoffTo:'none'},issues:[],simulation:{status:'ai',memory:'Player needs damage help',discordDeclined:false,paidDeclined:false,discordSent:false,sentGuides:[]}}));return}
   res.end(JSON.stringify({ok:true}));return
  }
  res.end(JSON.stringify(req.url.includes('?')?{ok:true,turns:[]}:{ok:true,settings,profiles:[profile]}));return
 }
 res.setHeader('Content-Type','text/html');res.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="padding:24px;background:#f6f8fb"><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage({viewport:{width:1365,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('button',{name:/Nightblade/}).click()
 await page.getByRole('button',{name:'真人接管',exact:true}).click()
 await page.getByRole('status').filter({hasText:'已接管'}).waitFor()
 assert.equal(profile.status,'human')
 mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/reception-queue-desktop.png',fullPage:true})
 await page.getByRole('button',{name:'AI 配置',exact:true}).click()
 assert.equal(await page.getByLabel('说话风格',{exact:true}).inputValue(),'Existing English voice')
 assert.equal(await page.getByLabel('接待补充规则').inputValue(),'Natural gaming chat')
 await page.getByLabel('说话风格',{exact:true}).fill('Shared updated English voice')
 await page.getByRole('button',{name:'接待队列',exact:true}).click()
 await page.getByRole('button',{name:'AI 配置',exact:true}).click()
 assert.equal(await page.getByLabel('说话风格',{exact:true}).inputValue(),'Shared updated English voice')
 personaFail=true;await page.getByRole('button',{name:'保存通用人设',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'测试人设失败'}).waitFor();personaFail=false
 assert.equal(persona.stylePrompt,'Existing English voice')
 await page.getByRole('button',{name:'保存通用人设',exact:true}).click()
 await page.getByRole('status').filter({hasText:'通用人设已保存'}).waitFor()
 assert.equal(persona.stylePrompt,'Shared updated English voice')
 assert.equal(persona.systemPrompt,'AION2 helper')
 await page.screenshot({path:'artifacts/unified-ai-config-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:'artifacts/unified-ai-config-mobile.png',fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.setViewportSize({width:1365,height:950})
 await page.getByRole('button',{name:'添加攻略'}).click()
 await page.getByLabel('标题',{exact:true}).fill('Dungeon rotation')
 await page.getByLabel('链接',{exact:true}).fill('https://example.com/rotation')
 await page.getByLabel('解决什么问题').fill('Warrior dungeon damage rotation')
 await page.getByRole('button',{name:'保存配置'}).click();await page.getByRole('status').filter({hasText:'内容库已保存'}).waitFor()
 assert.equal(settings.guides.length,1)
 fail=true;await page.getByRole('button',{name:'保存配置'}).click();await page.getByRole('alert').filter({hasText:'测试保存失败'}).waitFor();fail=false
 await page.getByRole('button',{name:'模拟对话',exact:true}).click();await page.getByLabel('模拟玩家消息').fill('My damage is terrible lol')
 await page.getByRole('button',{name:'生成下一句'}).click();await page.locator('.reception-bubble.outgoing').getByText('What class are you playing?').waitFor();assert.equal(simulationCount,1)
 await page.screenshot({path:'artifacts/reception-preview-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/reception-preview-mobile.png',fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 personaReadFail=true;await page.goto(`http://127.0.0.1:${server.address().port}/#config`);await page.reload()
 await page.getByRole('button',{name:'重试读取人设'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'保存通用人设',exact:true}).isDisabled(),true)
 personaReadFail=false;await page.getByRole('button',{name:'重试读取人设'}).click()
 await page.waitForFunction(()=>document.querySelector('input[maxlength="60"]')?.value==='Existing persona')
 assert.equal(await page.getByLabel('说话风格',{exact:true}).inputValue(),'Shared updated English voice')
 assert.deepEqual(errors,[]);console.log('PASS: reception desktop/mobile UI, takeover, guide editing/saving, failure display and simulated conversation')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
