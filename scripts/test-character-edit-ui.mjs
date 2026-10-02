import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const bundle = await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {CharacterActions} from './src/components/character-actions';createRoot(document.getElementById('root')).render(<CharacterActions character={{id:'1',name:'测试角色',characterId:'123',serverName:'测试区服',legionName:'',className:'',faction:'',level:1}} onSaved={async()=>{}}/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})
let requests=[], fail=false
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
 if(req.url==='/api/characters'){let raw='';for await(const chunk of req)raw+=chunk;requests.push({method:req.method,...JSON.parse(raw)});res.setHeader('Content-Type','application/json');res.statusCode=fail?409:200;res.end(JSON.stringify({ok:!fail,error:'角色已由其他客服跟踪'}));return}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage()
 page.on('pageerror',error=>console.error(error.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('button',{name:'修改',exact:true}).click()
 await page.getByLabel('角色名称').fill('新角色')
 fail=true;await page.getByRole('button',{name:'保存修改'}).click();await page.getByRole('alert').waitFor()
 assert.equal(await page.getByLabel('角色名称').inputValue(),'新角色')
 fail=false;await page.getByRole('button',{name:'保存修改'}).click();await page.getByRole('dialog').waitFor({state:'hidden'})
 assert.equal(requests.at(-1).name,'新角色');assert.equal(requests.at(-1).method,'PATCH')
 await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByText(/无法撤销/).waitFor()
 await page.getByRole('button',{name:'取消'}).click();assert.equal(requests.length,2)
 await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'确认删除'}).click();await page.getByRole('dialog').waitFor({state:'hidden'})
 assert.equal(requests.at(-1).method,'DELETE');assert.equal(requests.at(-1).confirm,true)
 console.log('PASS: edit form, retained fields after error, save, delete warning, cancellation and confirmation')
}finally{await browser.close();server.close()}
