import { database } from '#/server/characters.server'
import type { ChatMessageUpload } from '#/lib/chat-storage'
import type { AdminPrincipal } from '#/server/admin-users.server'
import { isPrivateChatPayload, privateChatPeerFromPayload } from '#/lib/chat-channel'
import { gameMessageIdFromRaw } from '#/lib/chat-timeline'

type MessageRow = {
  id: number
  source_message_id: string | null
  request_id: string | null
  agent_id: string | null
  direction: 'incoming' | 'outgoing' | 'system'
  message_type: string
  sender_name_snapshot: string | null
  content: string
  status: 'pending' | 'sent' | 'delivered' | 'received' | 'failed'
  error_message: string | null
  operator_user_key: string | null
  operator_username: string | null
  sent_at: number
  created_at: number
  raw_json: string | null
  correlated_receipt?: string | null
}

function correlatedReceipt(row: MessageRow): { gameMessageId?: string; status?: MessageRow['status']; errorMessage?: string } {
  try {
    return JSON.parse(row.correlated_receipt || '{}')
  } catch {
    return {}
  }
}

function storedGameMessageId(row: MessageRow) {
  const receipt = correlatedReceipt(row)
  if (typeof receipt.gameMessageId === 'string') return receipt.gameMessageId
  try {
    return gameMessageIdFromRaw(JSON.parse(row.raw_json || 'null'))
  } catch {
    return ''
  }
}

type ConversationOwner = {
  userKey: string
  username: string
}

async function findCharacter(serverId: string, characterId: string) {
  return database().prepare(`
    SELECT id FROM game_characters WHERE server_id = ? AND character_id = ?
  `).bind(serverId, characterId).first<{ id: number }>()
}

async function ensureConversation(characterRef: number, owner: ConversationOwner, agentId: string, now: number) {
  const existing = await database().prepare(`
    SELECT id FROM chat_conversations WHERE character_ref = ? AND owner_user_key = ?
  `).bind(characterRef, owner.userKey).first<{ id: number }>()
  if (existing) return existing.id
  await database().prepare(`
    INSERT INTO chat_conversations (
      character_ref, owner_user_key, owner_username, last_agent_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(character_ref, owner_user_key) DO NOTHING
  `).bind(characterRef, owner.userKey, owner.username, agentId, now, now).run()
  const conversation = await database().prepare(`
    SELECT id FROM chat_conversations WHERE character_ref = ? AND owner_user_key = ?
  `).bind(characterRef, owner.userKey).first<{ id: number }>()
  if (!conversation) throw new Error('无法创建角色会话')
  return conversation.id
}

export async function storeMessages(input: {
  serverId: string
  characterId: string
  messages: ChatMessageUpload[]
  operator: AdminPrincipal
}) {
  let messages = input.messages.filter((message) => message.messageType !== 'chat_message' || isPrivateChatPayload(message.raw))
  if (messages.length === 0) return { inserted: 0, ignored: input.messages.length }
  const now = Date.now()
  let character = await findCharacter(input.serverId, input.characterId)
  if (!character) {
    const peer = messages.flatMap(message => {
      if (message.messageType !== 'chat_message') return []
      const peer = privateChatPeerFromPayload(message.raw)
      return peer && peer.direction === message.direction && peer.serverId === input.serverId
        && peer.characterId === input.characterId ? [peer] : []
    })[0]
    if (!peer) return null
    // A real private-chat peer may not have been encountered by the directory
    // crawler yet. Preserve richer records if an import wins this insert race.
    await database().prepare(`
      INSERT INTO game_characters (
        character_name, character_id, server_id, first_seen_at, last_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_id, character_id) DO NOTHING
    `).bind(peer.characterName, peer.characterId, peer.serverId, now, now, now).run()
    character = await findCharacter(input.serverId, input.characterId)
    if (!character) throw new Error('无法保存私聊角色信息')
  }

  const newest = [...messages].sort((left, right) => right.sentAt - left.sentAt)[0]
  const conversationId = await ensureConversation(character.id, input.operator, newest?.agentId || '', now)
  // Avoid even attempting duplicate inserts (and their index/sequence work).
  // Batches stay below D1's bound-parameter limit, including direct service callers.
  const sourceIds = [...new Set(messages.map(message => message.sourceMessageId).filter((id): id is string => Boolean(id)))]
  const seen = new Set<string>()
  for (let offset = 0; offset < sourceIds.length; offset += 50) {
    const ids = sourceIds.slice(offset, offset + 50)
    const existing = await database().prepare(`
      SELECT source_message_id FROM chat_messages WHERE conversation_id = ?
        AND source_message_id IN (${ids.map(() => '?').join(', ')})
    `).bind(conversationId, ...ids).all<{ source_message_id: string }>()
    for (const row of existing.results) seen.add(row.source_message_id)
  }
  messages = messages.filter(message => {
    if (!message.sourceMessageId) return true
    if (seen.has(message.sourceMessageId)) return false
    seen.add(message.sourceMessageId)
    return true
  })
  const insert = database().prepare(`
    INSERT OR IGNORE INTO chat_messages (
      conversation_id, source_message_id, request_id, agent_id, direction,
      message_type, sender_name_snapshot, content, status, error_message,
      raw_json, operator_user_key, operator_username, sent_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const results = messages.length ? await database().batch(messages.map((message) => insert.bind(
    conversationId,
    message.sourceMessageId || null,
    message.requestId || null,
    message.agentId || null,
    message.direction,
    message.messageType || 'text',
    message.senderName || null,
    message.content,
    message.status || (message.direction === 'incoming' ? 'received' : 'sent'),
    message.errorMessage || null,
    message.raw ? JSON.stringify(message.raw) : null,
    message.direction === 'incoming' ? null : input.operator.userKey,
    message.direction === 'incoming' ? null : input.operator.username,
    message.sentAt,
    now,
  ))) : []
  const inserted = results.reduce((total, result) => total + (result.meta.changes ?? 0), 0)

  if (newest) {
    await database().prepare(`
      UPDATE chat_conversations SET
        last_agent_id = CASE WHEN ? <> '' THEN ? ELSE last_agent_id END,
        last_message_preview = CASE WHEN last_message_at IS NULL OR last_message_at <= ? THEN ? ELSE last_message_preview END,
        last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at <= ? THEN ? ELSE last_message_at END,
        updated_at = ?, owner_username = ?
      WHERE id = ? AND (last_message_at IS NULL OR last_message_at < ?
        OR (last_message_at = ? AND (last_message_preview IS NOT ? OR owner_username IS NOT ?
          OR (? <> '' AND last_agent_id IS NOT ?))))
    `).bind(
      newest.agentId || '', newest.agentId || '',
      newest.sentAt, newest.content.slice(0, 160),
      newest.sentAt, newest.sentAt, now, input.operator.username, conversationId,
      newest.sentAt, newest.sentAt, newest.content.slice(0, 160), input.operator.username,
      newest.agentId || '', newest.agentId || '',
    ).run()
  }

  return { inserted, ignored: input.messages.length - inserted }
}

export async function listMessages(input: {
  serverId: string
  characterId: string
  owner: ConversationOwner
  beforeId: number
  limit: number
}) {
  const character = await findCharacter(input.serverId, input.characterId)
  if (!character) return null
  const conversation = await database().prepare(`
    SELECT id FROM chat_conversations WHERE character_ref = ? AND owner_user_key = ?
  `).bind(character.id, input.owner.userKey).first<{ id: number }>()
  if (!conversation) return { messages: [], nextCursor: null }

  const beforeFilter = input.beforeId > 0 ? 'AND id < ?' : ''
  const bindings = input.beforeId > 0
    ? [conversation.id, input.beforeId, input.limit + 1]
    : [conversation.id, input.limit + 1]
  // Resolve commands through the indexed conversation/request lookup even when
  // their receipts lie outside this history page. Never expose raw request data.
  const result = await database().prepare(`
    SELECT id, source_message_id, request_id, agent_id, direction, message_type,
      sender_name_snapshot, content, status, error_message,
      operator_user_key, operator_username, sent_at, created_at, raw_json,
      CASE WHEN message_type = 'control_sent' AND request_id IS NOT NULL THEN (
        SELECT json_object(
          'gameMessageId', json_extract(CASE WHEN json_valid(receipt.raw_json) THEN receipt.raw_json ELSE '{}' END, '$.result.response.guid'),
          'status', receipt.status,
          'errorMessage', receipt.error_message
        )
        FROM chat_messages AS receipt
        WHERE receipt.conversation_id = chat_messages.conversation_id
          AND receipt.request_id = chat_messages.request_id
          AND receipt.agent_id IS chat_messages.agent_id
          AND receipt.message_type = 'control_result'
        ORDER BY receipt.id DESC LIMIT 1
      ) END AS correlated_receipt
    FROM chat_messages
    WHERE conversation_id = ? ${beforeFilter}
    ORDER BY id DESC
    LIMIT ?
  `).bind(...bindings).all<MessageRow>()
  const hasMore = result.results.length > input.limit
  const rows = result.results.slice(0, input.limit)
  return {
    messages: rows.filter((row) => {
      if (row.message_type !== 'chat_message') return true
      try {
        return isPrivateChatPayload(JSON.parse(row.raw_json || 'null'))
      } catch {
        return false
      }
    }).map((row) => ({
      id: row.id,
      sourceMessageId: row.source_message_id || '',
      requestId: row.request_id || '',
      agentId: row.agent_id || '',
      gameMessageId: storedGameMessageId(row),
      direction: row.direction,
      messageType: row.message_type,
      senderName: row.sender_name_snapshot || '',
      content: row.content,
      status: correlatedReceipt(row).status || row.status,
      errorMessage: correlatedReceipt(row).errorMessage || row.error_message || '',
      operatorUserKey: row.operator_user_key || '',
      operatorUsername: row.operator_username || '',
      sentAt: row.sent_at,
      createdAt: row.created_at,
    })),
    nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
  }
}
