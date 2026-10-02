import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const source = readFileSync(new URL('../src/routes/index.tsx', import.meta.url), 'utf8')
const fixture = `
import {createRoot} from 'react-dom/client'
function Fixture() {
  const [section, setSection] = useState('messages')
  useEffect(() => {
    const navigate = event => setSection(event.detail)
    window.addEventListener('fixture-navigate', navigate)
    return () => window.removeEventListener('fixture-navigate', navigate)
  }, [])
  return <AuthenticatedHome section={section} user={{userKey:'a',username:'Alice',role:'agent'}} onLogout={() => {}} />
}
createRoot(document.getElementById('root')).render(<Fixture />)
`
const bundle = await build({
  stdin: {contents: source + fixture, resolveDir: root + 'src/routes', loader:'tsx'},
  bundle: true, write:false, outdir:"fixture", platform:'browser', format:'iife', jsx:'automatic', alias:{'#':root+'src'}, loader:{'.md':'text'},
  define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'}, logLevel:'silent',
  plugins:[{name:'fixture',setup(build) {
    build.onResolve({filter:/^(@tanstack\/react-router|#\/lib\/use-aion-console)$/}, args => ({path:args.path,namespace:'fixture'}))
    build.onLoad({filter:/.*/,namespace:'fixture'}, args => ({resolveDir:root,loader:'tsx',contents:args.path.includes('react-router') ? `
      import React from 'react'
      const navigate = ({to}) => window.dispatchEvent(new CustomEvent('fixture-navigate',{detail:to.slice(1)}))
      export const useNavigate = () => navigate
      export const createFileRoute = () => options => options
      export const Link = ({to,children,...props}) => <a {...props} href={to} onClick={e=>{e.preventDefault();navigate({to})}}>{children}</a>
    ` : `
      import {useEffect,useMemo,useState} from 'react'
      const initialAgents=['1001','1002','1003',''].map((serverId,i)=>({agentId:'A'+(i+1),host:'A'+(i+1),characterName:i===0?'当前角色·测试':'',serverId,room:'test',status:'online',lastSeenAt:Date.now()}))
      const noop=()=>{}
      const sendCommand=(...args)=>{(window.sentCommands||=[]).push(args);return true}
      export function useAionConsole(){
        const [selectedAgentId,setSelectedAgentId]=useState(new URLSearchParams(location.search).get('selected')||'A1')
        const [agents,setAgents]=useState(initialAgents)
        useEffect(()=>{window.setFixtureAgents=setAgents},[])
        const [messages,setMessages]=useState([])
        useEffect(()=>{const receive=e=>setMessages(e.detail);window.addEventListener('fixture-messages',receive);return()=>window.removeEventListener('fixture-messages',receive)},[])
        return useMemo(()=>({selectedAgentId,setSelectedAgentId,agents,messages,inboxMessages:messages,readMessageIds:new Set(),markMessagesRead:noop,connectionState:'connected',connectionMessage:'connected',settings:{room:'test',mqttUrl:'',prefix:''},disconnect:noop,connect:noop,reconnect:noop,publishDiscover:noop,sendCommand,clearMessages:noop}),[selectedAgentId,messages,agents])
      }
    `}))
  }}],
})
let lockReads=0,directoryReads=0,messageWrites=0
let failMessageWrites=false
const messageBodies=[]
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost')
  if(url.pathname==='/bundle.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);return}
  if(url.pathname.startsWith('/api/')){
    let result={ok:true,entries:[],characters:[{id:1,characterId:'1',characterName:'Role 1',serverId:'1001',serverName:'1001',legionName:'',className:'',level:1,faction:'',avatarUrl:'',lastSeenAt:0}],servers:[{serverId:'1001',serverName:'1001',raceId:1,legions:[],unaffiliatedCount:1,characterCount:1},{serverId:'1002',serverName:'1002',legions:[],characterCount:0}],statuses:[],messages:[],nextCursor:null,totalCount:1}
    if(url.pathname==='/api/characters'&&url.searchParams.has('directory')) directoryReads++
    if(url.pathname==='/api/messages'&&request.method==='POST'){
      let body='';for await(const chunk of request)body+=chunk
      const payload=JSON.parse(body)
      messageBodies.push(payload)
      messageWrites++
      if(failMessageWrites){response.statusCode=503;result={ok:false,error:'temporary failure'}}
      else result={ok:true,conversations:payload.conversations.map(group=>({ok:true,serverId:group.serverId,characterId:group.characterId,received:group.messages.length}))}
    }
    if(url.pathname==='/api/client-locks'){lockReads++;response.statusCode=404;result={error:'removed'}}
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify(result));return
  }
  response.setHeader('Content-Type','text/html')
  response.end(url.pathname==='/closed'?'Closed':'<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try {
  const page=await browser.newPage()
  const errors=[];page.on('pageerror',error=>{errors.push(error.message); console.error(error.message)})
  const base=`http://127.0.0.1:${server.address().port}`
  await page.goto(base)
  await page.getByPlaceholder('发送消息给 Role 1').waitFor()
  for (const [label, status] of [['已聊', 'chatted'], ['未聊天', 'unchatted']]) {
    const filtered = page.waitForRequest(request => new URL(request.url()).searchParams.get('chatStatus') === status)
    await page.getByRole('tab', { name: label, exact: true }).click()
    await filtered
    assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true')
  }
  await page.getByRole('tab', { name: '全部角色', exact: true }).click()
  const sortControl = page.getByRole('combobox', { name: '角色列表战力排序' })
  for (const sort of ['power_desc', 'power_asc']) {
    const sorted = page.waitForResponse(response => new URL(response.url()).searchParams.get('sort') === sort)
    await sortControl.selectOption(sort)
    await sorted
    assert.equal(await sortControl.inputValue(), sort)
  }
  await page.reload()
  await page.getByPlaceholder('发送消息给 Role 1').waitFor()
  assert.equal(await sortControl.inputValue(), 'power_asc', 'Message list restores saved power sorting')
  await sortControl.selectOption('default')
  assert.equal(await page.getByPlaceholder('发送消息给 Role 1').isEnabled(),true)
  await page.getByRole('button',{name:'返回客户端中心',exact:true}).click()
  assert.equal(await page.locator('.client-table tbody tr').count(),4,'All clients are visible, including unknown or missing server IDs')
  assert.equal(await page.getByRole('columnheader', { name: '角色名', exact: true }).count(), 0)
  assert.equal(await page.locator('.client-table tbody tr').first().getByText('当前角色·测试', { exact: true }).count(), 0)
  assert.equal(await page.locator('.client-table tbody tr').nth(1).getByText('未识别角色', { exact: true }).count(), 0)
  assert.equal(await page.getByText('占用',{exact:false}).count(),0)
  await page.locator('.client-table tbody tr').nth(1).getByRole('button',{name:'进入操作'}).click()
  await page.getByRole('button',{name:'返回客户端中心',exact:true}).click()
  await page.locator('.client-table tbody tr').first().getByRole('button',{name:'进入操作'}).click()
  await page.reload()
  await page.getByPlaceholder('发送消息给 Role 1').waitFor()
  assert.equal(await page.getByPlaceholder('发送消息给 Role 1').isEnabled(),true,'Reload needs no acquisition')
  const denied=await browser.newPage()
  await denied.goto(base+'?selected=A3')
  await denied.getByRole('button',{name:'返回客户端中心',exact:true}).waitFor()
  await denied.goto(base+'?selected=offline')
  await denied.getByText('所选客户端未在线',{exact:true}).waitFor()
  assert.equal(await denied.locator('.chat-composer').count(),0,'Remembered offline client is not operable')
  await denied.close()
  assert.equal(await page.locator('.side-nav a').filter({hasText:'控制台'}).count(),0,'Agents cannot see console navigation')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fixture-navigate',{detail:'console'})))
  await page.locator('.client-table').waitFor()
  assert.equal(await page.getByLabel('JSON 命令').count(),0,'Direct console navigation cannot render command controls for agents')
  assert.equal(await page.evaluate(()=>window.sentCommands?.length||0),0,'Denied console navigation cannot publish commands')
  await page.locator('.side-nav a').filter({hasText:'实时消息'}).click()
  await page.getByPlaceholder('发送消息给 Role 1').waitFor()
  await page.locator('.broadcast-character').click()
  await page.getByPlaceholder('发送给筛选结果中的 1 个角色').fill('test draft')
  let pendingBulkRoute, resolveBulkRequest
  const pendingBulkRequest=new Promise(resolve=>resolveBulkRequest=resolve)
  await page.route('**/api/characters?**',async route=>{
    if(new URL(route.request().url()).searchParams.has('bulk')){pendingBulkRoute=route;resolveBulkRequest();return}
    await route.continue()
  })
  const bulkCancelled=page.waitForEvent('requestfailed',request=>request.url().includes('bulk=1'))
  await page.getByRole('button',{name:'发送给 1 人',exact:true}).click()
  await pendingBulkRequest
  await page.getByRole('button',{name:'停止群发',exact:true}).click()
  await bulkCancelled
  await pendingBulkRoute.fulfill({json:{ok:true,characters:[],nextCursor:null}}).catch(()=>{})
  await page.getByText('群发已停止：已发送 0 / 0。',{exact:true}).waitFor({timeout:5000}).catch(async error=>{
    console.log('Bulk stop UI:',await page.locator('.form-feedback').allTextContents());throw error
  })
  assert.equal(await page.evaluate(()=>window.sentCommands?.length||0),0)
  await page.getByRole('button',{name:'结束本次任务',exact:true}).click()
  await page.unroute('**/api/characters?**')
  let bulkLookups=0
  await page.route('**/api/characters?**',async route=>{
    if(!new URL(route.request().url()).searchParams.has('bulk')){await route.continue();return}
    bulkLookups++
    await route.fulfill({json:{ok:true,characters:[1,2].map(id=>({id,characterId:String(id),characterName:'Role '+id,serverId:'1001',legionName:'',level:1})),nextCursor:null}})
  })
  await page.clock.install()
  await page.getByLabel('群发间隔最大毫秒').fill('10000')
  await page.getByLabel('群发间隔最小毫秒').fill('10000')
  await page.getByPlaceholder('发送给筛选结果中的 1 个角色').fill('stop on server change')
  await page.getByRole('button',{name:'发送给 1 人',exact:true}).click()
  await page.waitForFunction(()=>window.sentCommands?.length===1)
  await page.evaluate(()=>window.setFixtureAgents([{agentId:'A1',host:'A1',serverId:'1003',room:'test',status:'online',lastSeenAt:Date.now()}]))
  await page.getByRole('button',{name:'返回客户端中心',exact:true}).waitFor()
  await page.clock.fastForward(20000)
  assert.equal(await page.evaluate(()=>window.sentCommands.length),1,'Changing the client server still aborts bulk before next send')
  await page.evaluate(()=>window.setFixtureAgents([{agentId:'A1',host:'A1',serverId:'1001',room:'test',status:'online',lastSeenAt:Date.now()}]))
  await page.locator('.broadcast-character').click()
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='继续群发')?.disabled)
  await page.getByPlaceholder('发送给筛选结果中的 1 个角色').fill('a different draft')
  await page.getByPlaceholder('搜索角色或 ID').fill('changed filter')
  const lookupsBeforeResume=bulkLookups
  await page.getByRole('button',{name:'继续群发',exact:true}).evaluate(button=>{button.click();button.click()})
  await page.getByRole('region',{name:'本次群发任务'}).waitFor({state:'hidden'})
  assert.equal(bulkLookups,lookupsBeforeResume,'Resume uses the captured recipient snapshot, not a new directory read')
  const commands=await page.evaluate(()=>window.sentCommands)
  assert.deepEqual(commands.map(args=>args[1].characterId),['1','2'],'Double resume skips already published recipients')
  assert.deepEqual(commands.map(args=>args[1].content),['stop on server change','stop on server change'],'Draft and filter changes cannot rewrite the paused task')
  await page.getByPlaceholder('搜索角色或 ID').fill('')
  await page.getByPlaceholder('发送给筛选结果中的 1 个角色').fill('manual pause')
  await page.getByRole('button',{name:'发送给 1 人',exact:true}).click()
  await page.waitForFunction(()=>window.sentCommands.length===3)
  await page.getByRole('button',{name:'暂停群发',exact:true}).click()
  await page.getByRole('button',{name:'继续群发',exact:true}).waitFor()
  await page.clock.fastForward(20000)
  assert.equal(await page.evaluate(()=>window.sentCommands.length),3,'Paused task performs no timed sends')
  await page.getByRole('button',{name:'继续群发',exact:true}).click()
  await page.getByRole('region',{name:'本次群发任务'}).waitFor({state:'hidden'})
  assert.deepEqual(await page.evaluate(()=>window.sentCommands.slice(2).map(args=>args[1].characterId)),['1','2'])
  console.log('PASS: pause/resume retains original recipients/content, does not requery or replay, pauses on a client server change, and tolerates double resume')
  // A failed save backs off even when React receives more message arrays.
  failMessageWrites=true
  const pendingMessage={id:'save-1',agentId:'A1',type:'control_sent',content:'persist me',time:new Date().toISOString(),raw:{payload:{requestId:'save-1',characterId:'1',serverKey:'1001',content:'persist me'}}}
  const sendFixture=messages=>page.evaluate(detail=>window.dispatchEvent(new CustomEvent('fixture-messages',{detail})),messages)
  const failedSave=page.waitForResponse(response=>response.url().endsWith('/api/messages')&&response.request().method()==='POST')
  await sendFixture([pendingMessage])
  await page.clock.fastForward(5000)
  await failedSave
  const firstAttempt=messageWrites
  for(let i=0;i<10;i++) await sendFixture([pendingMessage,{...pendingMessage,id:'save-'+(i+2)}])
  assert.equal(messageWrites,firstAttempt,'Incoming messages must not bypass retry backoff')
  await page.clock.fastForward(5000)
  await page.waitForFunction(()=>true)
  assert.ok(messageWrites<=firstAttempt+1,'At most one retry batch after first backoff')
  // A fixed window combines multiple React updates, and success stops empty writes.
  failMessageWrites=false
  await page.getByRole('button',{name:'重试保存',exact:true}).click()
  const burst = Array.from({length:20},(_,index)=>({...pendingMessage,id:'burst-'+index}))
  const beforeBurst=messageWrites
  for(let i=1;i<=burst.length;i++) await sendFixture(burst.slice(0,i))
  assert.equal(messageWrites,beforeBurst,'No POST on every incoming MQTT update')
  const savedBurst=page.waitForResponse(response=>response.url().endsWith('/api/messages')&&response.request().method()==='POST')
  await page.clock.fastForward(5000)
  await savedBurst
  await page.getByRole('button',{name:'重试保存',exact:true}).waitFor({state:'hidden'})
  assert.equal(messageWrites,beforeBurst+1)
  assert.equal(messageBodies.at(-1).conversations[0].messages.length,20)
  await page.clock.fastForward(30000)
  assert.equal(messageWrites,beforeBurst+1,'Confirmed messages and empty windows must not write')
  // One failed request stops a multi-request backlog before later chunks are sent.
  failMessageWrites=true
  await sendFixture(Array.from({length:250},(_,index)=>({...pendingMessage,id:'backlog-'+index})))
  const backlogWrites=messageWrites
  const failedBacklog=page.waitForResponse(response=>response.url().endsWith('/api/messages')&&response.request().method()==='POST')
  await page.clock.fastForward(5000)
  await failedBacklog
  await page.getByRole('alert').filter({hasText:'消息暂未保存'}).waitFor()
  assert.equal(messageWrites,backlogWrites+1,'Failure must stop remaining chunks, not upload all in parallel')
  let rejectedUploads=0
  await page.route('**/api/messages',route=>{
    if(route.request().method()!=='POST') return route.continue()
    rejectedUploads++
    return route.fulfill({status:400,json:{error:'invalid message'}})
  })
  await sendFixture([{...pendingMessage,id:'invalid-message'}])
  await page.getByRole('button',{name:'重试保存',exact:true}).click()
  await page.clock.fastForward(5000)
  await page.getByRole('alert').filter({hasText:'服务器拒绝'}).waitFor()
  await page.clock.fastForward(60000)
  assert.equal(rejectedUploads,1,'Permanent failure is visible and does not automatically upload again')
  await page.unroute('**/api/messages')
  failMessageWrites=false
  // Explicit retry must resubmit a rejection: it was never marked as saved.
  const retryRejected=page.waitForResponse(response=>response.url().endsWith('/api/messages')&&response.request().method()==='POST')
  await page.getByRole('button',{name:'重试保存',exact:true}).click()
  await page.clock.fastForward(5000)
  await retryRejected
  await page.getByRole('button',{name:'重试保存',exact:true}).waitFor({state:'hidden'})
  assert.equal(messageBodies.at(-1).conversations[0].messages[0].sourceMessageId,'invalid-message')
  let malformedUploads=0
  await page.route('**/api/messages',route=>{
    if(route.request().method()!=='POST') return route.continue()
    malformedUploads++
    return route.fulfill({json:{ok:true}})
  })
  await sendFixture([{...pendingMessage,id:'missing-ack'}])
  await page.clock.fastForward(5000)
  await page.getByRole('alert').filter({hasText:'消息暂未保存'}).waitFor()
  assert.equal(malformedUploads,1)
  await page.unroute('**/api/messages')
  const retryUnconfirmed=page.waitForResponse(response=>response.url().endsWith('/api/messages')&&response.request().method()==='POST')
  await page.getByRole('button',{name:'重试保存',exact:true}).click()
  await page.clock.fastForward(5000)
  await retryUnconfirmed
  await page.getByRole('button',{name:'重试保存',exact:true}).waitFor({state:'hidden'})
  assert.equal(messageBodies.at(-1).conversations[0].messages[0].sourceMessageId,'missing-ack')
  console.log('PASS: fixed-window batching, confirmed messages stay saved, failed backlog stops after one request')
  console.log('PASS: rejected and malformed acknowledgements are visible, retain retryability, and are not counted as saved')
  assert.equal(lockReads,0,'No occupancy requests on entry, reload, switching, sending or heartbeat')
  assert.deepEqual(errors,[])
  console.log('PASS: all clients enter directly, unknown server IDs remain visible, client server changes abort bulk, no occupancy API traffic')
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
