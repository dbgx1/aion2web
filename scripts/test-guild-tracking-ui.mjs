import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')
const bundle=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {GuildTrackingProvider,GuildTrackingButton,GuildTrackingSummary} from './src/components/guild-tracking';createRoot(document.getElementById('root')).render(<GuildTrackingProvider><GuildTrackingSummary onSelect={c=>document.getElementById('selected').textContent=c.legionName}/><GuildTrackingButton serverId="1001" legionName="测试军团"/></GuildTrackingProvider>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"'}})
let claims=[],canManage=false,conflict=false,requests=[]
const claim=(isMine,version=1)=>({serverId:'1001',legionName:'测试军团',ownerName:isMine?'我':'客服甲',isMine,version,updatedAt:1})
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('src/styles.css'));return}
 if(req.url==='/api/guild-tracking'){
  res.setHeader('Content-Type','application/json')
  if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push(body);if(conflict){claims=[claim(false,4)];res.statusCode=409;res.end(JSON.stringify({ok:false,error:'军团已被其他客服跟踪'}));return}claims=body.action==='claim'?[claim(true)]:[];res.end('{"ok":true}');return}
  res.end(JSON.stringify({ok:true,claims,canManage}));return
 }
 res.setHeader('Content-Type','text/html');res.end('<html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="root"></div><p id="selected"></p><script src="/bundle.js"></script></html>')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('button',{name:'跟踪军团',exact:true}).click();await page.getByRole('button',{name:'取消军团跟踪',exact:true}).waitFor()
 await page.getByRole('button',{name:'取消军团跟踪',exact:true}).click();await page.getByRole('button',{name:'返回',exact:true}).click();assert.equal(requests.length,1)
 await page.getByRole('button',{name:'取消军团跟踪',exact:true}).click();await page.getByRole('button',{name:'确认释放',exact:true}).click();await page.getByRole('button',{name:'跟踪军团',exact:true}).waitFor();assert.equal(requests.at(-1).version,1)
 conflict=true;await page.getByRole('button',{name:'跟踪军团',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'已由其他客服跟踪',exact:true}).isDisabled(),true)
 assert.equal(await page.getByRole('button',{name:'管理员释放'}).count(),0)
 canManage=true;conflict=false;await page.reload();await page.getByRole('button',{name:'管理员释放'}).click();await page.getByRole('button',{name:'确认释放'}).click();await page.getByRole('button',{name:'跟踪军团',exact:true}).waitFor();assert.equal(requests.at(-1).version,4)
 await page.getByRole('button',{name:'跟踪军团',exact:true}).click();await page.getByRole('button',{name:/军团跟踪管理（1）/}).click();await page.getByRole('button',{name:/测试军团 ·/}).click();assert.equal(await page.locator('#selected').textContent(),'测试军团')
 assert.deepEqual(errors,[]);console.log('PASS: claim, cancel confirmation, release, conflict refresh, disabled other owner, admin release revision and management list')
}finally{await browser.close();server.close()}
