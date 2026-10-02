import assert from 'node:assert/strict'
import {readFileSync,mkdirSync} from 'node:fs'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')
const source=readFileSync('src/routes/index.tsx','utf8')
const original=readFileSync('scripts/test-message-ai-scope.mjs','utf8')
const fixture=original.split('const fixture=`')[1].split('`')[0].replace('onSend={()=>{}}','onSend={()=>{window.sent.push(content)}}').replace('<Fixture/>','<TrackingProvider><Fixture/></TrackingProvider>')
const bundle=await build({stdin:{contents:source+fixture,resolveDir:root+'src/routes',loader:'tsx'},bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent'})
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return}
 if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('src/styles.css'));return}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,entries:[],servers:[],messages:[],statuses:[],nextCursor:null,totalCount:2,characters:[1,2].map(id=>({id,characterId:String(id),characterName:'Role '+id,serverId:'1001',legionName:'测试军团',className:'剑星',level:45}))}));return}
 res.setHeader('Content-Type','text/html');res.end('<html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body style="padding:20px"><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}}), errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByPlaceholder('发送消息给 Role 1').waitFor()
 assert.equal(await page.locator('.message-ai-panel').isVisible(),false)
 const paneBefore=await page.locator('.chat-pane').boundingBox()
 assert.ok(paneBefore.width>700)
 await page.getByRole('button',{name:'AI 助手',exact:true}).click()
 await page.locator('.message-ai-panel textarea').fill('保留助手输入')
 await page.getByRole('button',{name:'收起 AI 助手'}).click()
 await page.getByRole('button',{name:'AI 助手',exact:true}).click()
 assert.equal(await page.locator('.message-ai-panel textarea').inputValue(),'保留助手输入')
 await page.getByRole('button',{name:'收起 AI 助手'}).click()
 await page.locator('.broadcast-character').click()
 const bulk=page.locator('.chat-composer textarea')
 await bulk.fill('第一行');await bulk.press('Enter')
 assert.equal(await page.evaluate(()=>window.bulk.length),0)
 assert.equal(await bulk.inputValue(),'第一行\n')
 await bulk.press('Control+Enter')
 assert.equal(await page.evaluate(()=>window.bulk.length),1)
 await page.locator('.character-select-button').first().click()
 await page.locator('.chat-composer textarea').fill('私聊内容')
 await page.locator('.chat-composer textarea').press('Enter')
 assert.deepEqual(await page.evaluate(()=>window.sent),['私聊内容'])
 await page.locator('.message-directory-filters summary').click()
 assert.ok(await page.getByRole('button',{name:'选择种族'}).isVisible())
 await page.locator('.message-directory-filters summary').click()
 mkdirSync('artifacts',{recursive:true})
 await page.screenshot({path:'artifacts/message-workspace-desktop.png'})
 await page.setViewportSize({width:390,height:844})
 assert.ok(await page.locator('.chat-pane').isVisible())
 assert.equal(await page.locator('.character-panel').isVisible(),false)
 await page.getByRole('button',{name:'角色列表',exact:true}).click()
 assert.ok(await page.locator('.character-panel').isVisible())
 assert.equal(await page.locator('.chat-pane').isVisible(),false)
 await page.locator('.character-select-button').last().click()
 assert.ok(await page.getByPlaceholder('发送消息给 Role 2').isVisible())
 await page.screenshot({path:'artifacts/message-workspace-mobile.png'})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 assert.deepEqual(errors,[])
 console.log('PASS: conversation space, persistent assistant collapse, filter disclosure, bulk keyboard behavior, private sending and mobile navigation')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
