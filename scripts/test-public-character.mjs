import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const db=new DatabaseSync(':memory:')
for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()) db.exec(readFileSync('migrations/'+f,'utf8'))
let principal={userKey:'agent-1',role:'agent'}, scope=null
function load(file,deps){const exports={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,URL,require:n=>{assert.ok(n in deps,n);return deps[n]}});return exports}
const api=load('src/server/public-character.server.ts',{
  'cloudflare:workers':{env:{DB:{prepare:sql=>({bind:(...args)=>({run:async()=>({meta:db.prepare(sql).run(...args)})})})}}},
  './admin-auth.server':{currentAdminPrincipal:async()=>principal},
  './server-access.server':{allowedServerIds:async()=>scope},
  './api-auth.server':{jsonError:(error,status)=>Response.json({ok:false,error},{status})},
  './request-body.server':{readLimitedBody:async(req,max)=>{const s=await req.text();return s.length>max?null:s}},
  './characters.server':{listCharacters:async q=>({characters:db.prepare('SELECT * FROM game_characters WHERE server_id=? AND character_id=?').all(q.serverId,q.characterId)})},
})
const input={characterName:'coconiv',characterId:'619807898717071672',serverId:'2202'}
const add=(body=input,origin='https://test')=>api.addPublicCharacter(new Request('https://test/api/characters',{method:'POST',headers:{origin},body:JSON.stringify(body)}))
assert.equal((await (await add()).json()).created,true,'Subaccounts can add an identified public speaker')
assert.equal(db.prepare('SELECT character_id FROM game_characters').get().character_id,input.characterId)
db.exec("UPDATE game_characters SET level=50,combat_power=8888,legion_name='Keep',class_name='Keep',metadata_json='{\"important\":true}'")
assert.equal((await (await add({...input,characterName:'OldName'})).json()).created,false)
const saved=db.prepare('SELECT * FROM game_characters').get()
assert.equal(saved.character_name,'coconiv'); assert.equal(saved.level,50); assert.equal(saved.combat_power,8888)
assert.equal(saved.legion_name,'Keep'); assert.equal(saved.metadata_json,'{"important":true}')
assert.equal((await (await add({...input,serverId:'2201'})).json()).created,true,'Same ID on a different server is a different identity')
for(const body of [null,[],{...input,characterId:''},{...input,characterId:Number(input.characterId)},{...input,serverId:''},{...input,characterName:'x'.repeat(101)}]) assert.equal((await add(body)).status,400)
assert.equal((await add({...input,padding:'x'.repeat(9000)})).status,413)
assert.equal((await add(input,'https://other')).status,403)
principal=null;assert.equal((await add()).status,401);principal={userKey:'agent-1'}
scope=['1305'];assert.equal((await add()).status,403)
const channel=load('src/lib/chat-channel.ts',{})
const {publicSpeaker}=load('src/lib/public-speaker.ts',{'./chat-channel':channel})
const message={type:'chat_message',title:'coconiv',raw:{chat_meta:{sender:'coconiv',senderCharacterId:input.characterId,serverId:'2202',roomType:'WORLD'}}}
assert.equal(publicSpeaker(message).characterId,input.characterId)
assert.equal(publicSpeaker({...message,raw:{...message.raw,direction:'S->C',payload:{jsonData:{isFromGame:true}}}}).characterId,input.characterId,'Incoming game-origin public messages must retain their actions')
assert.equal(publicSpeaker({...message,raw:{chat_meta:{...message.raw.chat_meta,senderCharacterId:Number(input.characterId)}}}).characterId,'')
assert.equal(publicSpeaker({...message,type:'control_result'}),null)
assert.equal(publicSpeaker({...message,raw:{chat_meta:{...message.raw.chat_meta,roomType:'ONE_ON_ONE'}}}),null)
assert.equal(publicSpeaker({...message,raw:{...message.raw,direction:'C->S'}}),null)
db.close();console.log('PASS: authenticated public-player insert, exact ID, deduplication, profile preservation, validation, scope, origin and speaker parsing')
