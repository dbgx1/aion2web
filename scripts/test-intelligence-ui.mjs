import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')
const bundle=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {PlayerIntelligence} from './src/components/player-intelligence';import {TrackingProvider} from './src/components/character-tracking';createRoot(document.getElementById('root')).render(<TrackingProvider><PlayerIntelligence storageKey="test-intel" onChat={c=>document.getElementById('chat').textContent=c.name}/></TrackingProvider>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"'}})
let fail=false;const requests=[]
const row={name:'测试军团',server_id:'1001',server_name:'希埃爾',rank:1,score:3,member_count:3,known_power_count:2,last_seen_at:1}
const player={id:1,name:'测试成员',character_id:'123',server_id:'1001',server_name:'希埃爾',legion_name:'测试军团',rank:3,score:6000,combat_power:6000,level:50,class_name:'剑星',legion_position:0,last_seen_at:1}
const server=createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('src/styles.css'));return}
 const url=new URL(req.url,'http://local');let data
 if(url.pathname==='/api/guild-tracking')data={ok:true,claims:[],canManage:false}
 else if(url.pathname==='/api/character-tracking')data={ok:true,entries:[],claims:[{characterId:'1',ownerName:'客服甲',isMine:false}]}
 else if(url.pathname==='/api/intelligence'){requests.push(url.searchParams.toString());if(fail){res.statusCode=500;data={ok:false,error:'测试读取失败'}}else data={ok:true,rows:url.searchParams.get('q')==='空'?[]:[url.searchParams.get('view')==='players'?player:row],total:url.searchParams.get('q')==='空'?0:1,queriedAt:Date.now()}}
 else if(url.pathname==='/api/characters')data=url.searchParams.get('directory')?{ok:true,servers:[{serverId:'1001',serverName:'希埃爾',legions:[]}]}:{ok:true,characters:[{id:1,characterName:'测试成员',characterId:'123',serverId:'1001',serverName:'希埃爾',legionName:'测试军团',legionPosition:0,level:50,combatPower:6000,className:'剑星',lastSeenAt:1}],totalCount:1,nextCursor:null}
 if(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return}
 res.setHeader('Content-Type','text/html');res.end('<html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="root"></div><p id="chat"></p><script src="/bundle.js"></script></html>')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('button',{name:'测试成员',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'已由 客服甲 跟踪：测试成员'}).isDisabled(),true)
 await page.getByRole('button',{name:'私聊',exact:true}).click();assert.equal(await page.locator('#chat').textContent(),'测试成员')
 await page.getByRole('button',{name:'角色排行榜',exact:true}).click();await page.getByRole('button',{name:'测试成员',exact:true}).click();await page.getByText('Character ID：123',{exact:true}).waitFor()
 await page.getByRole('button',{name:'查看所属军团'}).click();await page.getByRole('button',{name:'私聊',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'军团排行榜',exact:true}).count(),0);await page.getByLabel('排列指标').selectOption('level')
 await page.getByLabel('搜索',{exact:true}).fill('空');await page.getByText('没有符合条件的数据，请调整筛选。').waitFor()
 await page.reload();await page.getByText('没有符合条件的数据，请调整筛选。').waitFor();assert.equal(await page.getByLabel('排列指标').inputValue(),'level')
 fail=true;await page.getByLabel('搜索',{exact:true}).fill('');await page.getByRole('alert').waitFor();fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('button',{name:'测试成员',exact:true}).waitFor()
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
 assert.deepEqual(errors,[]);assert.ok(requests.some(q=>q.includes('metric=level')));console.log('PASS: guild members, tracking ownership, chat, rank detail, view switching, persisted filters, empty/error/retry and mobile width')
}finally{await browser.close();server.close()}
