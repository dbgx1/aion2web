import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { toServerSentEventsResponse } from '@tanstack/ai'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const source = readFileSync(new URL('../src/routes/index.tsx', import.meta.url), 'utf8')
const fixture = `
import {createRoot} from 'react-dom/client'
function Fixture(){
 const [content,setContent]=useState('');const noop=()=>{};
 window.sent ||= [];
 return <MessageAiAssistant agent={{agentId:'test',host:'test'}} selectedCharacter={{characterId:'one',name:'测试角色',serverKey:'1001'}}
  recipientMode="single" selectedFilterLabel="test" recipientCount={1} content={content} chronologicalMessages={[]} publicMessages={[]}
  bulkIntervalRangeMs={{min:1000,max:1000}} onContentChange={setContent} onSendPrivateChat={(text,signal)=>{window.sent.push(text);if(window.delayReceipt){window.sendSignal=signal;return new Promise(resolve=>window.finishReceipt=()=>resolve({sent:true,status:'confirmed',message:'LATE RECEIPT'}))}return Promise.resolve({sent:true,status:"confirmed",message:"confirmed"})}}
  onSendGroupChat={async()=>{throw Error('Unexpected group send')}} onRecipientModeChange={noop} onMessageViewChange={noop}/>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const bundle = await build({ stdin: { contents: source + fixture, resolveDir: root + 'src/routes', loader: 'tsx' }, bundle: true,
  write: false, outdir: 'fixture', platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '#': root + 'src' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' }, logLevel: 'silent' })
let mode = 'healthy', requests = [], serial = 0
const server = createServer(async (req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(f => f.path.endsWith('.js')).text); return }
  if (req.url === '/api/ai/chat') {
    let data = ''; for await (const chunk of req) data += chunk
    const body = JSON.parse(data); requests.push(body)
    const { threadId, runId } = body, messageId = 'm' + (++serial)
    const events = [{ type: 'RUN_STARTED', threadId, runId }]
    if (mode === 'stall') { res.setHeader('Content-Type', 'text/event-stream'); res.write('data: ' + JSON.stringify(events[0]) + '\n\n'); return }
    if (mode === 'partial') events.push({ type: 'TOOL_CALL_START', toolCallId: 'unfinished', toolCallName: 'send_private_chat' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'unfinished', delta: '{"content":"partial' },
      { type: 'RUN_ERROR', message: 'fixture upstream failure', code: '502' })
    else if (mode === 'send' && body.messages.at(-1).role !== 'tool') {
      const input = { content: '仅本地测试' }, toolCallId = 'send-' + serial
      events.push({ type: 'TOOL_CALL_START', toolCallId, toolCallName: 'send_private_chat' }, { type: 'TOOL_CALL_END', toolCallId, input },
        { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'interrupt', interrupts: [{ id: 'client_tool_' + toolCallId,
          reason: 'tanstack:client_tool_execution', toolCallId, responseSchema: {}, metadata: { kind: 'client_tool', toolName: 'send_private_chat', input } }] } })
    } else {
      events.push({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' })
      for (const delta of mode === 'malformed' ? ['function<|tool_', 'sep|>send_private_chat'] : ['本地测试回复 ' + serial]) {
        events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta })
      }
      if (mode !== 'truncated') events.push({ type: 'TEXT_MESSAGE_END', messageId }, { type: 'RUN_FINISHED', threadId, runId })
    }
    const response = toServerSentEventsResponse((async function* () { for (const event of events) yield { ...event, timestamp: Date.now() } })())
    res.setHeader('Content-Type', 'text/event-stream'); res.end(await response.text()); return
  }
  res.setHeader('Content-Type', 'text/html')
  res.end('<meta charset="utf-8"><style>body{font:15px sans-serif;max-width:760px;margin:24px auto;background:#f6f8fa}.console-ai-thread{height:450px;overflow:auto}.console-ai-message{padding:10px;margin:8px;background:white;border:1px solid #ddd}.is-user{background:#e8f6f2}textarea{width:95%;height:70px}.console-ai-feedback{color:#b42318}button{padding:10px;margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const prompt = page.locator('textarea')
  const submit = async value => { await prompt.fill(value); await page.getByRole('button', { name: '询问 AI', exact: true }).click() }
  const settled = async () => { await page.getByRole('button', { name: '询问 AI', exact: true }).waitFor() }
  for (let i = 0; i < 50; i++) {
    await submit('第 ' + (i + 1) + ' 轮'); await settled()
    assert.equal(await prompt.inputValue(), '')
  }
  assert.equal(requests.length, 50)
  assert.equal(requests.at(-1).messages.filter(m => m.role === 'user').length, 12)
  assert.ok(await page.locator('.console-ai-message').count() <= 80, 'UI history is bounded as well')
  for (const scenario of ['partial', 'malformed', 'truncated']) {
    mode = scenario
    const before = requests.length
    await submit('故障测试 ' + scenario); await settled()
    await page.locator('.console-ai-feedback.is-error').waitFor()
    assert.equal(await prompt.inputValue(), '故障测试 ' + scenario)
    assert.equal(requests.length, before + 1)
    mode = 'healthy'
    await submit('恢复测试 ' + scenario); await settled()
    assert.equal(await prompt.inputValue(), '')
    assert.equal(await page.locator('.console-ai-feedback.is-error').count(), 0)
    assert.deepEqual(await page.evaluate(() => window.sent), [])
  }
  mode = 'stall'
  await submit('停止测试')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await settled()
  assert.equal(await prompt.inputValue(), '停止测试')
  const beforeResume = requests.length
  mode = 'healthy'
  await submit('停止后继续'); await settled()
  assert.equal(await prompt.inputValue(), '')
  assert.equal(requests.length, beforeResume + 1, 'Stop does not submit a new request')
  mode = 'send'
  await submit('测试一次本地工具发送'); await settled()
  assert.deepEqual(await page.evaluate(() => window.sent), ['仅本地测试'])
  await page.evaluate(() => { window.delayReceipt = true })
  await submit('等待客户端确认时停止')
  await page.waitForFunction(() => typeof window.finishReceipt === 'function')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await settled()
  assert.equal(await page.evaluate(() => window.sendSignal.aborted), true, 'Stop cancels pending receipt wait')
  mode = 'healthy'
  await submit('立即开始新一轮'); await settled()
  const afterRestart = requests.length
  await page.evaluate(async () => { window.finishReceipt(); await new Promise(resolve => setTimeout(resolve, 50)) })
  assert.equal(requests.length, afterRestart, 'Late tool completion must not launch another model request')
  assert.equal(await page.getByText('LATE RECEIPT', { exact: true }).count(), 0, 'Old notice must not replace the new run')
  assert.equal(await prompt.inputValue(), '')
  const beforeClear = requests.length
  await page.getByRole('button', { name: '清空', exact: true }).click()
  assert.equal(await page.locator('.console-ai-message').count(), 0)
  assert.equal(requests.length, beforeClear)
  mode = 'healthy'
  await submit('清空后继续'); await settled()
  assert.equal(requests.at(-1).messages.length, 1)
  assert.deepEqual(errors, [])
  mkdirSync(new URL('../artifacts', import.meta.url), { recursive: true })
  await page.screenshot({ path: new URL('../artifacts/ai-multiturn-ui.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') })
  console.log('PASS: actual React assistant: 50 turns, bounded history, failure recovery, stop/restart including late execution receipt, local sends, clear/restart, no page exceptions')
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
