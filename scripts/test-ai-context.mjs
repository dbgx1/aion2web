import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle = await build({entryPoints:['src/lib/ai-context.ts'],bundle:true,write:false,platform:'node',format:'esm'})
const { serializeAiContext, AiContextLimitError } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const input = {
  surface:'managed', task:{instruction:'只回答问题，不重复发送旧消息',scope:'single'},
  selectedCharacter:{characterId:'one',serverKey:'1001'},
  recentPublicMessages:Array.from({length:10},()=>({content:'公频'.repeat(600)})),
  recentPrivateMessages:Array.from({length:12},(_,id)=>({id,content:id===11?'最新问题必须完整保留':'旧记录'.repeat(600)})),
}
const original = structuredClone(input)
const serialized = serializeAiContext(input)
assert.ok(serialized.length<=12000)
const kept = JSON.parse(serialized)
assert.deepEqual(kept.task,input.task)
assert.deepEqual(kept.selectedCharacter,input.selectedCharacter)
assert.deepEqual(kept.recentPrivateMessages.at(-1),input.recentPrivateMessages.at(-1))
assert.deepEqual(kept.recentPrivateMessages,input.recentPrivateMessages.slice(-kept.recentPrivateMessages.length))
assert.deepEqual(input,original,'Trimming must not mutate UI evidence')
assert.equal(serializeAiContext(kept),serialized,'Context pruning is idempotent')
assert.throws(()=>serializeAiContext({task:{instruction:'x'.repeat(13000)}}),AiContextLimitError)
assert.throws(()=>serializeAiContext({recentPrivateMessages:[{content:'x'.repeat(13000)}]}),AiContextLimitError)
assert.equal(serializeAiContext(undefined),'')
console.log('PASS: bounded valid JSON context, immutable evidence, complete persistent task/recipient metadata, newest question retention and explicit oversized-input error')
