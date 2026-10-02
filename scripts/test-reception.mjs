import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import ts from 'typescript'
const bundle = await build({ entryPoints: ['src/lib/reception.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const lib = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const db = new DatabaseSync(':memory:')
db.exec(readFileSync('migrations/0016_ai_reception.sql', 'utf8'))
db.exec(readFileSync('migrations/0006_ai_personas.sql', 'utf8'))
function statement(sql, args = []) {
  return { bind: (...values) => statement(sql, values), first: () => db.prepare(sql).get(...args) || null,
    all: () => ({ results: db.prepare(sql).all(...args) }), run: () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }) }
}
const DB = { prepare: sql => statement(sql), batch: statements => {
  db.exec('BEGIN'); try { const result = statements.map(s => s.run()); db.exec('COMMIT'); return result } catch(e) { db.exec('ROLLBACK'); throw e }
} }
function load(path, deps) {
  const exports = {}
  runInNewContext(ts.transpileModule(readFileSync(path,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Response, Request, URL, Uint8Array, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, structuredClone, crypto, console,
      require: name => { assert.ok(name in deps, name); return deps[name] } })
  return exports
}
const decision = patch => ({ need: '提高副本输出', evidence: 'my damage is low', missing: ['职业'], intent: 'none', action: 'ask', reason: '缺少职业信息',
  reply: 'What class are you playing?', guideId: '', handoffTo: 'none', handoffAccepted: false, discordPreference: 'unknown', paidPreference: 'unknown', stopRequested: false, summary: '玩家想提升副本输出；职业未知。', ...patch })
const personaLib = load('src/lib/ai-persona.ts', {})
const personas = load('src/server/ai-persona.server.ts', { 'cloudflare:workers': { env: { DB } }, '#/lib/ai-persona': personaLib })
let model = async () => decision(), calls = 0, lastPrompts = []
const api = load('src/server/reception.server.ts', {
  'cloudflare:workers': { env: { DB } }, '@tanstack/ai': { chat: async options => { calls++; lastPrompts = options.systemPrompts; return model() } }, '@tanstack/ai-openrouter': { openRouterText: () => ({}) },
  '#/server/ai-persona.server': personas,
  '#/lib/reception': lib, './server-access.server': { allowedServerIds: async p => p.scope ?? null },
  '#/lib/ai-error-details': { aiErrorDetails: error => ({ message: error.message }) },
})
const alice = { userKey: 'alice', username: 'Alice' }, bob = { userKey: 'bob', username: 'Bob' }
const input = (id='one', message='my damage is low') => ({ serverId: '1001', characterId: id, characterName: 'Player', instruction: '', history: [{ id: id + '-message', direction:'incoming', content:message, time:'2026-09-15T12:00:00Z' }] })
const signal = () => new AbortController().signal
try {
  const settings = { ...lib.defaultReceptionSettings, discordUrl:'https://discord.gg/fixture', discordPurpose:'Find groups',
    guides:[{ id:'g1', title:'Rotation', url:'https://example.com/guide', needs:'dungeon rotation', prerequisites:'Warrior', version:'current', enabled:true }] }
  assert.equal(lib.receptionSettingsSchema.safeParse({ ...settings, discordUrl:'javascript:alert(1)' }).success,false)
  const profile = api.emptyReceptionProfile(input())
  const guard = (d,p={}) => lib.enforceReceptionDecision(decision(d),settings,{...profile,...p},input().history)
  assert.equal(guard({intent:'purchase',evidence:'invented'}).decision.intent,'none')
  assert.equal(guard({action:'handoff',handoffAccepted:false,handoffTo:'sales'}).decision.action,'wait')
  assert.equal(guard({action:'discord',reply:'Join us.'},{discordDeclined:true}).decision.action,'wait')
  assert.equal(guard({action:'discord',reply:'Join us.',discordPreference:'requested',evidence:'invented'},{discordDeclined:true}).decision.action,'wait')
  assert.equal(guard({action:'guide',guideId:'g1',reply:'This covers your rotation.'}).decision.reply,'This covers your rotation.\nhttps://example.com/guide')
  assert.equal(guard({action:'guide',guideId:'g1',reply:'Guide'},{sentGuides:['g1']}).decision.action,'wait')
  assert.equal(guard({reply:'Go to https://evil.example/'}).decision.action,'wait')
  assert.equal(guard({reply:'What class? What level?'}).decision.action,'wait')
  assert.equal(guard({stopRequested:true},{status:'human'}).decision.action,'wait')
  assert.equal(guard({stopRequested:true}).decision.action,'close')
  assert.equal(guard({intent:'support'}).decision.intent,'none')
  assert.equal(guard({need:'question'}).decision.need,'my damage is low')
  assert.equal(guard({action:'offer_handoff',intent:'pricing'},{paidDeclined:true}).decision.action,'wait')
  await api.saveReceptionSettings('alice',settings)
  const legacy = { ...personaLib.defaultAiPersona, name: 'Alice existing persona', stylePrompt: 'Keep Alice original voice' }
  await personas.saveAiPersona(alice, legacy)
  assert.equal((await api.receptionSettings('bob')).guides.length,0)
  let first = await api.planReception(alice,input(),signal())
  assert.equal(first.status,'ready'); assert.equal(calls,1)
  assert.ok(lastPrompts.includes(personas.aiPersonaPrompt(await personas.getAiPersona(alice))))
  assert.ok(lastPrompts.join('\n').includes('Keep Alice original voice'))
  assert.equal((await api.planReception(alice,input(),signal())).turnId,first.turnId)
  assert.equal(calls,1)
  assert.equal(await api.claimReceptionTurn(first.turnId,'bob'),false)
  assert.equal(await api.claimReceptionTurn(first.turnId,'alice'),true)
  assert.equal(await api.claimReceptionTurn(first.turnId,'alice'),false)
  await api.completeReceptionTurn(await api.findReceptionTurn(first.turnId),'sent')
  assert.equal((await api.findReceptionTurn(first.turnId)).status,'sent')
  assert.equal((await api.planReception(bob,input(),signal())).status,'sent')
  // Older drafts cannot send after human takeover, including another operator.
  first = await api.planReception(alice,input('takeover'),signal())
  let p = await api.receptionProfile('1001','takeover')
  assert.equal(await api.controlReception(bob,'1001','takeover','human',p.version),true)
  assert.equal(await api.claimReceptionTurn(first.turnId,'alice'),false)
  assert.equal(await api.controlReception(alice,'1001','takeover','ai',p.version),false)
  // Refusal persists into later messages and survives operators.
  model = async () => decision({evidence:'no discord please',discordPreference:'declined',reply:'No problem.'})
  first = await api.planReception(alice,input('refusal','no discord please'),signal())
  assert.equal((await api.receptionProfile('1001','refusal')).discordDeclined,true)
  model = async () => decision({action:'discord',reply:'Join our group.',evidence:'need a team'})
  const refused = input('refusal','need a team'); refused.history[0].id = 'next-message'
  first = await api.planReception(alice,refused,signal()); assert.equal(first.decision.action,'wait')
  // Guide is recorded ONLY after a confirmed send.
  model = async () => decision({action:'guide',guideId:'g1',reply:'This explains the rotation.'})
  first = await api.planReception(alice,input('guide'),signal())
  assert.equal((await api.receptionProfile('1001','guide')).sentGuides.length,0)
  await api.claimReceptionTurn(first.turnId,'alice')
  await api.completeReceptionTurn(await api.findReceptionTurn(first.turnId),'sent')
  assert.equal((await api.receptionProfile('1001','guide')).sentGuides[0],'g1')
  // Unknown receipts stop sending rather than silently retrying.
  model = async () => decision()
  first = await api.planReception(alice,input('uncertain'),signal())
  await api.claimReceptionTurn(first.turnId,'alice')
  await api.completeReceptionTurn(await api.findReceptionTurn(first.turnId),'uncertain')
  assert.equal((await api.receptionProfile('1001','uncertain')).status,'waiting')
  assert.equal((await api.planReception(alice,input('uncertain'),signal())).status,'skipped')
  // Commercial handoff is a durable queue action, not a generated success claim.
  model = async () => decision({ action:'handoff',intent:'purchase',evidence:'connect me to sales',handoffAccepted:true,handoffTo:'sales',reply:'I sent it!' })
  first = await api.planReception(alice,input('sale','connect me to sales'),signal())
  assert.equal(first.decision.reply,''); assert.equal((await api.receptionProfile('1001','sale')).status,'waiting')
  // An interrupted generation cannot overwrite a human takeover.
  let release, started
  const startedPromise = new Promise(resolve => { started = resolve })
  model = async () => { started(); return new Promise(resolve => { release = resolve }) }
  const pending = api.planReception(alice,input('race'),signal()); await startedPromise
  p = await api.receptionProfile('1001','race'); await api.controlReception(bob,'1001','race','human',p.version)
  release(decision()); first = await pending
  assert.equal(first.status,'skipped'); assert.equal((await api.receptionProfile('1001','race')).status,'human')
  model = async () => { throw new Error('fixture provider failure') }
  await assert.rejects(api.planReception(alice,input('failure'),signal()),/fixture/)
  assert.equal((await api.receptionProfile('1001','failure')).status,'waiting')
  assert.equal((await api.listReception({ ...alice,scope:['9999'] })).length,0)
  // A resource hallucination gets one bounded correction, not a silent drop.
  let correctionCalls = 0
  model = async () => ++correctionCalls === 1 ? decision({action:'guide',guideId:'missing',reply:'Here is a guide.'}) : decision()
  const corrected = await api.evaluateReception('alice',input('correction'),api.emptyReceptionProfile(input('correction')),signal())
  assert.equal(correctionCalls,2);assert.equal(corrected.decision.action,'ask');assert.ok(corrected.issues[0].includes('拦截'))
  // Uncertain work must be resolved before resuming AI; evidence then persists.
  p=await api.receptionProfile('1001','uncertain')
  assert.equal(await api.controlReception(alice,'1001','uncertain','ai',p.version),false)
  const uncertainRow=db.prepare("SELECT * FROM reception_turns WHERE character_id='uncertain'").get()
  await api.completeReceptionTurn(uncertainRow,'skipped',true)
  assert.equal(await api.controlReception(alice,'1001','uncertain','ai',p.version),true)
  // Already-owned conversations should not consume a model request.
  const beforeIdle=calls
  await api.evaluateReception('alice',input(),{...profile,status:'human'},signal())
  assert.equal(calls,beforeIdle)
  // The existing persona store is shared, changes apply next turn, and owners remain isolated.
  model = async () => decision()
  await personas.saveAiPersona(alice, { ...legacy, stylePrompt: 'Updated shared voice' })
  await api.evaluateReception('alice', input(), profile, signal())
  assert.ok(lastPrompts.join('\n').includes('Updated shared voice'))
  await api.evaluateReception('bob', input(), profile, signal())
  assert.ok(!lastPrompts.join('\n').includes('Updated shared voice'))
  assert.equal((await api.receptionSettings('alice')).style, settings.style)
  // Exercise the actual endpoint validators/authentication and same-origin guard.
  let principal = null
  const route = load('src/routes/api/ai/reception.ts', {
    '@tanstack/react-router':{createFileRoute:()=>config=>config}, zod: await import('zod'), '#/lib/reception':lib,
    '#/server/admin-auth.server':{currentAdminPrincipal:async()=>principal}, '#/server/api-auth.server':{jsonError:(error,status)=>Response.json({ok:false,error},{status})},
    '#/server/server-access.server':{canAccessServer:async(_,id)=>id==='1001'}, '#/server/reception.server':api,
  }).Route.server.handlers
  assert.equal((await route.GET({request:new Request('https://test/api/ai/reception')})).status,401)
  const post = (body,origin='https://test')=>route.POST({request:new Request('https://test/api/ai/reception',{method:'POST',headers:{origin},body:JSON.stringify(body)})})
  assert.equal((await post({})).status,401); principal=alice
  assert.equal((await post({action:'settings',settings},'https://evil.test')).status,403)
  assert.equal((await post({action:'settings',settings})).status,200)
  assert.equal((await post({action:'plan',input:{...input(),serverId:'9999'}})).status,403)
  assert.equal((await post({action:'plan',input:{...input(),history:[]}})).status,400)
  console.log('PASS: reception policy, real SQL persistence, consent, resource delivery, deduplication, takeover, stale decisions, uncertain receipts, failure queue, account scope and API validation')
} finally { db.close() }
