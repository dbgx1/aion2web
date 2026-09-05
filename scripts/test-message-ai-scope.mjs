import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')
const source=readFileSync(new URL('../src/routes/index.tsx',import.meta.url),'utf8')
const fixture=`
import {createRoot} from 'react-dom/client'
function Fixture(){
 const [selected,select]=useState(),[content,setContent]=useState(''),[operation,setOperation]=useState('one')
 window.changeOperation=()=>setOperation('two')
 window.sent ||= []; window.bulk ||= []
 return <MessageCenter agent={{agentId:'agent',serverId:'1001',host:'Agent'}} selectedCharacter={selected} onCharacterSelect={select}
  agentMessages={[]} messages={[]} readMessageIds={new Set()} onMessagesRead={()=>{}} content={content} onContentChange={setContent}
  actionMessage="" onBack={()=>{}} onSend={()=>{}} onSendPrivateChat={value=>{window.sent.push({id:selected.characterId,value});return true}}
  onSendAll={async()=>{window.bulk.push(true);return {sent:true,sentCount:1,totalCount:1,varied:false,message:'sent'}}}
  onStopBulkSend={()=>{}} onQueryPresence={async()=>{}} presenceConnected={false} bulkSending={false} canOperate={true} lockOwner=""
  operationKey={operation} bulkIntervalRangeMs={{min:1000,max:1000}} onBulkIntervalRangeChange={()=>{}} />
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const bundle=await build({stdin:{contents:source+fixture,loader:'tsx',resolveDir:root+'src/routes'},bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',
 alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent',
 plugins:[{name:'fake-ai-transport',setup(b){
  b.onResolve({filter:/^@tanstack\/ai-react$/},()=>({path:'fake-ai',namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:root,contents:`
   import {useRef,useState} from 'react'
   export const fetchServerSentEvents=()=>({})
   export function useChat(options){
    const [loading,setLoading]=useState(false), session=useRef()
    if(!session.current){
     const item={started:0,stopped:0,tools:[]};(window.aiSessions||=[]).push(item);session.current=item
     item.stop=()=>{item.stopped++;setLoading(false);item.resolve?.()}
     item.sendMessage=()=>{item.started++;setLoading(true);return new Promise(resolve=>item.resolve=resolve)}
    }
    session.current.tools=options.tools;window.aiSession=session.current
    return {isLoading:loading,messages:[],sendMessage:session.current.sendMessage,stop:session.current.stop,clear:()=>{}}
   }
  `}))
 }}]})
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return}
 if(url.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json')
  res.end(JSON.stringify({ok:true,servers:[],messages:[],statuses:[],nextCursor:null,totalCount:2,
   characters:[1,2].map(id=>({id,characterId:String(id),characterName:'Role '+id,serverId:'1001',legionName:'',level:1}))}));return
 }
 res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try{
 const page=await browser.newPage(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByPlaceholder('发送消息给 Role 1').waitFor()
 const start=async()=>{
  await page.locator('.message-ai-panel textarea').fill('send a greeting')
  await page.getByRole('button',{name:'询问 AI',exact:true}).click()
  await page.waitForFunction(()=>window.aiSession.started>0)
 }
 await start()
 await page.evaluate(()=>window.oldSession=window.aiSession)
 await page.locator('.character-select-button strong').getByText('Role 2',{exact:true}).click()
 await page.getByPlaceholder('发送消息给 Role 2').waitFor()
 const rejectOld=()=>page.evaluate(async()=>{
  const failures=[]
  for(const tool of window.oldSession.tools){try{await tool.execute({content:'late message'});failures.push(false)}catch{failures.push(true)}}
  return failures
 })
 assert.deepEqual(await rejectOld(),[true,true,true,true],'Every old sending/draft tool is invalid after recipient switch')
 assert.ok(await page.evaluate(()=>window.oldSession.stopped>0))
 await start()
 const result=await page.evaluate(()=>window.aiSession.tools.find(t=>t.name==='send_private_chat').execute({content:'current message'}))
 assert.equal(result.sent,true,'A valid new-scope request can still send')
 assert.deepEqual(await page.evaluate(()=>window.sent),[{id:'2',value:'current message'}])
 await page.evaluate(()=>window.oldSession=window.aiSession)
 await page.getByPlaceholder('搜索角色或 ID').fill('new filter')
 await page.waitForFunction(()=>window.aiSession!==window.oldSession)
 assert.deepEqual(await rejectOld(),[true,true,true,true],'Filter changes invalidate the captured group-send callback')
 await start()
 await page.evaluate(()=>{window.oldSession=window.aiSession;window.changeOperation()})
 await page.waitForFunction(()=>window.aiSession!==window.oldSession)
 assert.deepEqual(await rejectOld(),[true,true,true,true],'A different lock generation invalidates old tools')
 await start()
 await page.evaluate(()=>window.oldSession=window.aiSession)
 await page.locator('.message-ai-panel').getByRole('button',{name:'停止',exact:true}).click()
 assert.deepEqual(await rejectOld(),[true,true,true,true],'Stop invalidates pending tool callbacks immediately')
 assert.deepEqual(errors,[])
 console.log('PASS: actual MessageCenter AI tools reject stale recipient/filter/lock scopes and stopped requests; current scope still sends')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
