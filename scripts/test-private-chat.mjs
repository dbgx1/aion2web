import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  runInNewContext(outputText, { exports, Response, Request, URL, TextEncoder, TextDecoder, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
    return dependencies[name]
  } })
  return exports
}

const channel = load('../src/lib/chat-channel.ts')
const timeline = load('../src/lib/chat-timeline.ts')

const event = (id, messageType, requestId = '', gameMessageId = '') => ({
  id, messageType, requestId, gameMessageId, agentId: 'client-a',
  direction: messageType.startsWith('control_') && messageType !== 'control_sent' ? 'system' : 'outgoing',
  content: '121', time: '2026-09-04T13:46:10.000Z',
})

test('command, receipt and echo form one bubble regardless of arrival order and clock skew', () => {
  const sent = { ...event('sent', 'control_sent', 'request-a'), time: '2026-09-04T13:46:14.000Z' }
  const receipt = event('receipt', 'control_result', 'request-a', '1413294121202344960')
  const echo = event('echo', 'chat_message', '', '1413294121202344960')
  for (const input of [[sent, receipt, echo], [echo, receipt, sent], [receipt, echo, sent], [sent, echo, receipt]]) {
    const result = timeline.mergePrivateChatTimeline(input)
    assert.equal(result.length, 1)
    assert.equal(result[0].requestId, 'request-a')
    assert.equal(result[0].time, echo.time)
    assert.equal(result[0].content, '121')
  }
  assert.equal(timeline.mergePrivateChatTimeline([sent, echo]).length, 2, 'No content/time guessing before receipt')
  assert.equal(timeline.mergePrivateChatTimeline([sent]).length, 1, 'Pending or failed command remains visible')
})

test('actual repeated sends, incoming messages and separate clients are preserved', () => {
  const events = ['a', 'b'].flatMap(key => [event(`sent-${key}`, 'control_sent', key), event(`result-${key}`, 'control_result', key, `guid-${key}`), event(`echo-${key}`, 'chat_message', '', `guid-${key}`)])
  assert.equal(timeline.mergePrivateChatTimeline(events).length, 2)
  assert.equal(timeline.mergePrivateChatTimeline([...events, { ...events[2], id: 'incoming', direction: 'incoming' }]).length, 3)
  assert.equal(timeline.mergePrivateChatTimeline([...events, ...events.map(item => ({ ...item, agentId: 'client-b' }))]).length, 4)
  assert.equal(timeline.mergePrivateChatTimeline([...events, { ...events[2], id: 'replayed-echo' }]).length, 2)
})

test('history enrichment survives a live copy and GUIDs retain all digits', () => {
  const guid = '1413294121202344960'
  const stored = event('sent', 'control_sent', 'request-a', guid)
  const live = event('sent', 'control_sent', 'request-a')
  assert.equal(timeline.mergePrivateChatTimeline([stored, live, event('echo', 'chat_message', '', guid)]).length, 1)
  for (const raw of [{ result: { response: { guid } } }, { payload: { jsonData: { guid } } }, { jsonData: { guid } }]) {
    assert.equal(timeline.gameMessageIdFromRaw(raw), guid)
  }
  assert.equal(timeline.gameMessageIdFromRaw({ jsonData: { guid: Number(guid) } }), '')
  assert.equal(timeline.gameMessageIdFromRaw(null), '')
})

test('message replay performs no application-row writes and keeps account-scoped deduplication', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'))
    db.exec(readFileSync(new URL('../migrations/0005_account_scoped_chat_history.sql', import.meta.url), 'utf8'))
    db.exec(`INSERT INTO game_characters (id,character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at)
      VALUES (1,'Role A','role-a','1001',1,1,1)`)
    const database = { prepare: sql => ({ bind: (...bindings) => ({
      first: async () => db.prepare(sql).get(...bindings),
      all: async () => ({results:db.prepare(sql).all(...bindings)}),
      run: async () => ({meta:{changes:db.prepare(sql).run(...bindings).changes}}),
    }) }), batch: async statements => Promise.all(statements.map(statement => statement.run())) }
    const service = load('../src/server/messages.server.ts', {
      '#/lib/chat-channel':channel, '#/lib/chat-timeline':timeline, '#/server/characters.server':{database:()=>database},
    })
    const input = {serverId:'1001',characterId:'role-a',operator:{userKey:'owner-a',username:'A'},messages:[{
      sourceMessageId:'source-1',requestId:'request-1',agentId:'client-a',messageType:'control_sent',direction:'outgoing',content:'121',sentAt:1000,
    }]}
    assert.equal((await service.storeMessages(input)).inserted,1)
    const changes = () => db.prepare('SELECT total_changes() AS n').get().n
    const before = changes()
    const replay = await service.storeMessages(input)
    assert.equal(replay.inserted,0)
    assert.equal(replay.ignored,1)
    assert.equal(changes(),before,'Replay must not rewrite conversation metadata or insert ignored rows')
    const next = {...input.messages[0],sourceMessageId:'source-2',sentAt:2000,content:'next'}
    assert.equal((await service.storeMessages({...input,messages:[...input.messages,next,next]})).inserted,1)
    assert.equal(db.prepare('SELECT last_message_preview FROM chat_conversations WHERE owner_user_key=?').get('owner-a').last_message_preview,'next')
    const afterNext = changes()
    await service.storeMessages(input)
    assert.equal(changes(),afterNext,'Older replay must not rewrite or roll back the latest preview')
    assert.equal((await service.storeMessages({...input,operator:{userKey:'owner-b',username:'B'}})).inserted,1)
  } finally {db.close()}
})

test('private game events save missing peers without creating the sender or overwriting directory data', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'))
    db.exec(readFileSync(new URL('../migrations/0005_account_scoped_chat_history.sql', import.meta.url), 'utf8'))
    const database = { prepare: sql => ({ bind: (...bindings) => ({
      first: async () => db.prepare(sql).get(...bindings),
      all: async () => ({ results: db.prepare(sql).all(...bindings) }),
      run: async () => ({ meta: { changes: db.prepare(sql).run(...bindings).changes } }),
    }) }), batch: async statements => Promise.all(statements.map(statement => statement.run())) }
    const service = load('../src/server/messages.server.ts', {
      '#/lib/chat-channel': channel, '#/lib/chat-timeline': timeline,
      '#/server/characters.server': { database: () => database },
    })
    const peerId = '281756451687619142'
    const senderId = '281756451687404891'
    const message = {
      sourceMessageId: 'missing-peer-echo', messageType: 'chat_message', direction: 'outgoing',
      content: 'existing message', status: 'sent', sentAt: 1000,
      raw: { direction: 'S->C', payload: { jsonData: {
        gameRoomKeyInfo: { type: 'ONE_ON_ONE' }, isFromGame: true,
        playNcCharId: senderId, userName: 'Local player', serverId: '1001',
        receiverCharacterId: peerId, receiverServerId: '1002', receiverUserName: 'Private peer',
      } } },
    }
    const input = { serverId: '1002', characterId: peerId, operator: { userKey: 'owner-a', username: 'A' }, messages: [message] }
    for (const invalid of [
      { ...input, characterId: senderId },
      { ...input, serverId: '1001' },
      { ...input, messages: [{ ...message, direction: 'incoming' }] },
      { ...input, messages: [{ ...message, messageType: 'control_sent' }] },
      { ...input, messages: [{ ...message, raw: { chat_meta: { kind: 'private' } } }] },
      ...[{ receiverUserName: '' }, { receiverCharacterId: Number(peerId) }].map(change => ({
        ...input, messages: [{ ...message, raw: { payload: { jsonData: { ...message.raw.payload.jsonData, ...change } } } }],
      })),
    ]) assert.equal(await service.storeMessages(invalid), null)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_characters').get().n, 0)

    // Exercise the same batch API contract used by the live browser's retry.
    const route = load('../src/routes/api/messages.ts', {
      '@tanstack/react-router': { createFileRoute: () => value => value },
      '#/server/admin-auth.server': { currentAdminPrincipal: async () => input.operator },
      '#/server/api-auth.server': { jsonError: (error, status) => Response.json({ error }, { status }) },
      '#/server/messages.server': service,
    }).Route
    const response = await route.server.handlers.POST({ request: new Request('https://example.test/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversations: [input] }),
    }) })
    const ack = await response.json()
    assert.equal(response.status, 200)
    assert.equal(ack.failed, 0)
    assert.equal(ack.conversations[0].inserted, 1)
    const peer = db.prepare('SELECT * FROM game_characters').get()
    assert.equal(peer.character_id, peerId)
    assert.equal(peer.server_id, '1002')
    assert.equal(peer.character_name, 'Private peer')
    assert.equal(peer.level, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_characters').get().n, 1)
    db.prepare('UPDATE game_characters SET level=80, legion_name=?, metadata_json=? WHERE id=?').run('Existing legion', '{"rich":true}', peer.id)
    assert.equal((await service.storeMessages(input)).inserted, 0)
    const preserved = db.prepare('SELECT * FROM game_characters').get()
    assert.equal(preserved.level, 80)
    assert.equal(preserved.legion_name, 'Existing legion')
    assert.equal(preserved.metadata_json, '{"rich":true}')
    const other = await service.storeMessages({ ...input, operator: { userKey: 'owner-b', username: 'B' } })
    assert.equal(other.inserted, 1, 'History remains account scoped')

    const incoming = { ...message, sourceMessageId: 'incoming', direction: 'incoming', raw: {
      payload: { jsonData: { ...message.raw.payload.jsonData, isFromGame: false, serverId: '1001' } },
    } }
    assert.equal((await service.storeMessages({ ...input, serverId: '1001', characterId: senderId, messages: [incoming] })).inserted, 1)
    assert.equal(db.prepare('SELECT character_name FROM game_characters WHERE character_id=?').get(senderId).character_name, 'Local player')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_characters').get().n, 2)
  } finally { db.close() }
})

test('real history SQL correlates across pages within the account/character/client, and API retains GUID only', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'))
    db.exec(readFileSync(new URL('../migrations/0005_account_scoped_chat_history.sql', import.meta.url), 'utf8'))
    db.exec(readFileSync(new URL('../migrations/0010_message_directory_performance.sql', import.meta.url), 'utf8'))
    db.exec(`INSERT INTO game_characters (id,character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at)
      VALUES (1,'Role A','role-a','1001',1,1,1),(2,'Role B','role-b','1001',1,1,1);
      INSERT INTO chat_conversations (id,character_ref,owner_user_key,owner_username,created_at,updated_at)
      VALUES (1,1,'owner-a','A',1,1),(2,1,'owner-b','B',1,1),(3,2,'owner-a','A',1,1);`)
    const insert = db.prepare(`INSERT INTO chat_messages
      (conversation_id,source_message_id,request_id,agent_id,direction,message_type,content,status,sent_at,created_at,raw_json)
      VALUES (?,?,?,?,?,?,?,'sent',1,1,?)`)
    const guid = '1413294121202344960'
    const receiptRaw = value => JSON.stringify({ result: { response: { guid: value }, request: { headers: { secret: 'must-not-return' } } } })
    insert.run(1,'receipt','request-a','client-a','system','control_result','receipt',receiptRaw(guid))
    db.exec("UPDATE chat_messages SET status='delivered' WHERE source_message_id='receipt'")
    insert.run(1,'sent','request-a','client-a','outgoing','control_sent','121',null)
    insert.run(1,'echo',null,'client-a','outgoing','chat_message','121',JSON.stringify({ payload: { jsonData: { guid, gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } } }))
    insert.run(2,'other-owner','request-a','client-a','system','control_result','receipt',receiptRaw('other-owner'))
    insert.run(3,'other-role','request-a','client-a','system','control_result','receipt',receiptRaw('other-role'))
    insert.run(1,'other-client','request-a','client-b','system','control_result','receipt',receiptRaw('other-client'))
    let historyPlan = ''
    const service = load('../src/server/messages.server.ts', {
      '#/lib/chat-channel': channel, '#/lib/chat-timeline': timeline,
      '#/server/characters.server': { database: () => ({ prepare: sql => ({ bind: (...bindings) => ({
        first: async () => db.prepare(sql).get(...bindings),
        all: async () => {
          historyPlan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings).map(row => row.detail).join('\n')
          return { results: db.prepare(sql).all(...bindings) }
        },
      }) }) }) },
    })
    const input = { serverId: '1001', characterId: 'role-a', owner: { userKey: 'owner-a' }, beforeId: 4, limit: 1 }
    const first = await service.listMessages(input)
    const second = await service.listMessages({ ...input, beforeId: first.nextCursor })
    assert.equal(first.messages[0].gameMessageId, guid)
    assert.equal(second.messages[0].gameMessageId, guid, 'Receipt on an older page still correlates')
    assert.equal(second.messages[0].status,'delivered','A receipt outside the page must resolve the command status')
    assert.equal(second.nextCursor, 2)
    assert.match(historyPlan, /idx_messages_request/)
    assert.match(historyPlan, /idx_messages_conversation_cursor/)
    assert.ok(!historyPlan.includes('TEMP B-TREE'), historyPlan)
    const merged = timeline.mergePrivateChatTimeline([...first.messages, ...second.messages].map(row => ({ ...row, id: row.sourceMessageId, time: new Date(row.sentAt).toISOString() })))
    assert.equal(merged.length, 1)
    assert.equal(merged[0].requestId, 'request-a')
    const route = load('../src/routes/api/messages.ts', {
      '@tanstack/react-router': { createFileRoute: () => value => value },
      '#/server/admin-auth.server': { currentAdminPrincipal: async () => input.owner },
      '#/server/api-auth.server': { jsonError: (error, status) => Response.json({ error }, { status }) },
      '#/server/messages.server': service,
    }).Route
    const response = await route.server.handlers.GET({ request: new Request('https://example.test/api/messages?serverId=1001&characterId=role-a&before=3&limit=1') })
    const body = await response.json()
    assert.equal(body.messages[0].gameMessageId, guid)
    assert.equal(body.messages[0].status,'delivered')
    db.exec("UPDATE chat_messages SET status='failed', error_message='game rejected' WHERE source_message_id='receipt'")
    const failedPage=await service.listMessages({...input,beforeId:3})
    assert.equal(failedPage.messages[0].status,'failed')
    assert.equal(failedPage.messages[0].errorMessage,'game rejected')
    assert.ok(!JSON.stringify(body).includes('must-not-return'))
    assert.ok(!Object.hasOwn(body.messages[0], 'raw_json'))
  } finally { db.close() }
})
test('private chat requires explicit channel evidence, not direction or sender', () => {
  for (const raw of [null, {}, { direction: 'S->C' }, { chat_meta: { kind: 'normal', sender: 'Player' } }, { payload: { jsonData: { gameRoomKeyInfo: { type: 'GROUP' } } } }]) {
    assert.equal(channel.isPrivateChatPayload(raw), false)
  }
  for (const raw of [{ chat_meta: { kind: 'private' } }, { chat_meta: { roomType: 'ONE_ON_ONE' } }, { payload: { jsonData: { gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } } }, { jsonData: { gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } }]) {
    assert.equal(channel.isPrivateChatPayload(raw), true)
  }
})

test('outgoing chat payloads are detected independently from private channel evidence', () => {
  assert.equal(channel.isOutgoingChatPayload({ chat_meta: { kind: 'outgoing' }, direction: 'S->C' }), true)
  assert.equal(channel.isOutgoingChatPayload({ payload: { direction: 'C->S' }, chat_meta: { kind: 'private' } }), true)
  assert.equal(channel.isOutgoingChatPayload({ jsonData: { isFromGame: true, gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } }), true)
  assert.equal(channel.isOutgoingChatPayload({ jsonData: { isFromGame: false, gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } }), false)
  assert.equal(channel.isOutgoingChatPayload({ chat_meta: { kind: 'private' }, direction: 'S->C' }), false)
})

test('old clients cannot persist public chat as private history', async () => {
  const service = load('../src/server/messages.server.ts', {
    '#/lib/chat-channel': channel,
    '#/lib/chat-timeline': timeline,
    '#/server/characters.server': { database() { throw new Error('Public messages must not write to the database') } },
  })
  const result = await service.storeMessages({ serverId: '1001', characterId: '123', operator: { userKey: 'agent:a' }, messages: [
    { messageType: 'chat_message', direction: 'incoming', content: 'public', raw: { direction: 'S->C', chat_meta: { kind: 'normal' } }, sentAt: 1 },
  ] })
  assert.equal(result.inserted, 0)
  assert.equal(result.ignored, 1)
})

test('history excludes previously stored public chat without deleting records or breaking the cursor', async () => {
  const records = [
    { id: 5, message_type: 'chat_message', content: 'public', raw_json: JSON.stringify({ chat_meta: { kind: 'normal' } }) },
    { id: 4, message_type: 'chat_message', content: 'private', raw_json: JSON.stringify({ chat_meta: { kind: 'private' } }) },
    { id: 3, message_type: 'control_sent', content: 'sent whisper', raw_json: null },
    { id: 2, message_type: 'chat_message', content: 'invalid raw', raw_json: 'invalid' },
    { id: 1, message_type: 'text', content: 'imported text', raw_json: null },
  ]
  const service = load('../src/server/messages.server.ts', {
    '#/lib/chat-channel': channel,
    '#/lib/chat-timeline': timeline,
    '#/server/characters.server': { database: () => ({ prepare: () => ({ bind: () => ({
      first: async () => ({ id: 1 }), all: async () => ({ results: records }),
    }) }) }) },
  })
  const result = await service.listMessages({ serverId: '1001', characterId: '123', owner: { userKey: 'agent:a' }, beforeId: 0, limit: 4 })
  assert.deepEqual(Array.from(result.messages, row => row.content), ['private', 'sent whisper'])
  assert.equal(result.nextCursor, 2)
  assert.equal(records.length, 5)
})
