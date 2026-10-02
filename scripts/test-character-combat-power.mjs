import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
function load(path, deps={}) {
  const exports={}
  runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:name=>{assert.ok(name in deps,name);return deps[name]}})
  return exports
}
const {parseCharacterUpload}=load('src/lib/character-upload.ts')
const base={characterName:'Fixture',characterId:'1',serverId:'1001'}
for(const combatPower of [-1,1.5,true,[],{},' ',Infinity,Number.MAX_SAFE_INTEGER+1]) assert.equal(parseCharacterUpload({...base,combatPower},0).ok,false)
assert.equal(parseCharacterUpload({...base,combat_power:'123456'},0).value.combatPower,123456)
for(const legionPosition of ['yes',4,-1,1.5,true,false,[],{},'', ' ',Infinity]) assert.equal(parseCharacterUpload({...base,legionPosition},0).ok,false)
for (const position of [0,1,2,3]) assert.equal(parseCharacterUpload({...base,legion_position:String(position)},0).value.legionPosition,position)
assert.equal(parseCharacterUpload({...base,isLegionLeader:true},0).ok,false)
const db=new DatabaseSync(':memory:')
try {
  db.exec(readFileSync('migrations/0001_initial.sql','utf8'))
  db.prepare('INSERT INTO game_characters(character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at) VALUES (?,?,?,?,?,?)').run('Legacy','old','1001',1,1,1)
  db.exec(readFileSync('migrations/0011_character_combat_power.sql','utf8'))
  db.exec(readFileSync('migrations/0013_character_legion_leader.sql','utf8'))
  db.exec(readFileSync('migrations/0014_character_power_sort.sql','utf8'))
  assert.equal(db.prepare("SELECT combat_power FROM game_characters WHERE character_id='old'").get().combat_power,null)
  assert.equal(db.prepare("SELECT is_legion_leader FROM game_characters WHERE character_id='old'").get().is_legion_leader,0)
  db.prepare("UPDATE game_characters SET is_legion_leader=1 WHERE character_id='old'").run()
  db.prepare("INSERT INTO game_characters(character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at) VALUES('NonLeader','legacy-nonleader','1001',1,1,1)").run()
  db.exec(readFileSync('migrations/0020_character_legion_position.sql','utf8'))
  assert.equal(db.prepare("SELECT legion_position FROM game_characters WHERE character_id='legacy-nonleader'").get().legion_position,null)
  db.prepare("DELETE FROM game_characters WHERE character_id='legacy-nonleader'").run()
  assert.equal(db.prepare("SELECT legion_position FROM game_characters WHERE character_id='old'").get().legion_position,0)
  db.prepare("UPDATE game_characters SET legion_position=NULL WHERE character_id='old'").run()
  assert.throws(()=>db.exec("UPDATE game_characters SET legion_position=4"))
  db.exec(readFileSync('migrations/0021_character_equipment_gender.sql','utf8'))
  const api=load('src/server/characters.server.ts',{
    '#/lib/aion2-servers':load('src/lib/aion2-servers.ts'),
    'cloudflare:workers':{env:{DB:{
      prepare:sql=>({bind:(...args)=>({sql,args,all:async()=>({results:db.prepare(sql).all(...args)}),first:async()=>db.prepare(sql).get(...args)})}),
      batch:async statements=>statements.map(({sql,args})=>({meta:db.prepare(sql).run(...args)})),
    }}},
  })
  const upload=async extra=>{const parsed=parseCharacterUpload({...base,...extra},0);assert.equal(parsed.ok,true);await api.upsertCharacters([parsed.value])}
  const power=()=>db.prepare("SELECT combat_power FROM game_characters WHERE character_id='1'").get().combat_power
  const leader=()=>db.prepare("SELECT legion_position FROM game_characters WHERE character_id='1'").get().legion_position
  await upload({combatPower:123456});assert.equal(power(),123456)
  await upload({});assert.equal(power(),123456,'Legacy upload must not erase collected power')
  await upload({combatPower:null});assert.equal(power(),123456)
  await upload({combatPower:0});assert.equal(power(),0,'Zero is a measured value, not missing')
  await upload({combatPower:789});assert.equal(power(),789)
  await upload({legionPosition:0});assert.equal(leader(),0)
  await upload({});assert.equal(leader(),0,'Legacy upload must not erase legion leader status')
  await upload({legionPosition:2});assert.equal(leader(),2)
  for (const legionPosition of [0,1,2,3,null]) { await upload({legionPosition}); assert.equal(leader(),legionPosition); await upload({}); assert.equal(leader(),legionPosition) }
  await upload({legionPosition:2})
  const listed=await api.listCharacters({serverId:'1001',legionName:'',withoutLegion:false,search:'',cursor:0,limit:20})
  assert.equal(listed.characters.find(c=>c.characterId==='1').combatPower,789)
  assert.equal(listed.characters.find(c=>c.characterId==='old').combatPower,null)
  assert.equal(listed.characters.find(c=>c.characterId==='1').legionPosition,2)
  assert.equal(listed.characters.find(c=>c.characterId==='old').legionPosition,null)
  await upload({legionPosition:0,legionName:'Test Legion'})
  const leaderQuery={serverId:'1001',legionName:'Test Legion',withoutLegion:false,search:'',cursor:0,limit:1,legionLeadersOnly:true}
  const leaders=await api.listCharacters(leaderQuery)
  assert.equal(leaders.totalCount,1)
  assert.equal(leaders.characters.length,1)
  assert.equal(leaders.characters[0].characterId,'1')
  assert.equal(leaders.characters[0].legionPosition,0)
  const afterLeader=await api.listCharacters({...leaderQuery,cursor:leaders.characters[0].id,includeTotal:false})
  assert.equal(afterLeader.characters.length,0)
  assert.equal(afterLeader.totalCount,null)
  assert.equal((await api.listCharacters({...leaderQuery,serverId:'2001'})).totalCount,0)
  assert.equal((await api.listCharacters({...leaderQuery,legionName:'Other Legion'})).totalCount,0)
  assert.equal((await api.listCharacters({...leaderQuery,legionName:'',legionLeadersOnly:false})).totalCount,2)
  for (const [characterId,combatPower] of [['high',2000],['tie',789],['zero',0],['unknown',null]]) {
    await upload({characterId,combatPower,legionName:'Test Legion',legionPosition:0})
  }
  for (const [sort,expected] of [
    ['power_desc',['high','1','tie','zero','old','unknown']],
    ['power_asc',['zero','1','tie','high','old','unknown']],
  ]) {
    let cursor=0; const ids=[]
    do {
      const page=await api.listCharacters({...leaderQuery,legionName:'',legionLeadersOnly:false,sort,cursor,limit:1})
      assert.equal(page.totalCount,6,'Total includes all pages')
      ids.push(...page.characters.map(c=>c.characterId))
      cursor=page.nextCursor
      assert.ok(ids.length<=6,'Pagination must terminate')
    } while (cursor!==null)
    assert.deepEqual(ids,expected,'Sort must cover all pages, break ties by ID, and put unknown power last')
    const filtered=await api.listCharacters({...leaderQuery,sort,cursor:0,limit:100})
    assert.deepEqual(Array.from(filtered.characters,c=>c.characterId),expected.filter(id=>id!=='old'))
  }
  console.log('PASS: migrations, power sorting across pages, ties, zero/unknown power, combined filters, uploads and legacy data')
} finally {db.close()}
