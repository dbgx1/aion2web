import { database } from '#/server/characters.server'
import type { ChatMessageUpload } from '#/lib/chat-storage'

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
  sent_at: number
  created_at: number
}

async function findCharacter(serverId: string, characterId: string) {
  return database().prepare(`
    SELECT id FROM game_characters WHERE server_id = ? AND character_id = ?
  `).bind(serverId, characterId).first<{ id: number }>()
}

async function ensureConversation(characterRef: number, agentId: string, now: number) {
  await database().prepare(`
    INSERT INTO chat_conversations (character_ref, last_agent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(character_ref) DO UPDATE SET
      last_agent_id = CASE WHEN excluded.last_agent_id <> '' THEN excluded.last_agent_id ELSE last_agent_id END,
      updated_at = excluded.updated_at
  `).bind(characterRef, agentId, now, now).run()
  const conversation = await database().prepare(`
    SELECT id FROM chat_conversations WHERE character_ref = ?
  `).bind(characterRef).first<{ id: number }>()
  if (!conversation) throw new Error('无法创建角色会话')
  return conversation.id
}

export async function storeMessages(input: {
  serverId: string
  characterId: string
  messages: ChatMessageUpload[]
}) {
  const character = await findCharacter(input.serverId, input.characterId)
  if (!character) return null

  const now = Date.now()
  const newest = [...input.messages].sort((left, right) => right.sentAt - left.sentAt)[0]
  const conversationId = await ensureConversation(character.id, newest?.agentId || '', now)
  const insert = database().prepare(`
    INSERT OR IGNORE INTO chat_messages (
      conversation_id, source_message_id, request_id, agent_id, direction,
      message_type, sender_name_snapshot, content, status, error_message,
      raw_json, sent_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const results = await database().batch(input.messages.map((message) => insert.bind(
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
    message.sentAt,
    now,
  )))
  const inserted = results.reduce((total, result) => total + (result.meta.changes ?? 0), 0)

  if (newest) {
    await database().prepare(`
      UPDATE chat_conversations SET
        last_agent_id = CASE WHEN ? <> '' THEN ? ELSE last_agent_id END,
        last_message_preview = CASE WHEN last_message_at IS NULL OR last_message_at <= ? THEN ? ELSE last_message_preview END,
        last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at <= ? THEN ? ELSE last_message_at END,
        updated_at = ?
      WHERE id = ?
    `).bind(
      newest.agentId || '', newest.agentId || '',
      newest.sentAt, newest.content.slice(0, 160),
      newest.sentAt, newest.sentAt, now, conversationId,
    ).run()
  }

  return { inserted, ignored: input.messages.length - inserted }
}

export async function listMessages(input: {
  serverId: string
  characterId: string
  beforeId: number
  limit: number
}) {
  const character = await findCharacter(input.serverId, input.characterId)
  if (!character) return null
  const conversation = await database().prepare(`
    SELECT id FROM chat_conversations WHERE character_ref = ?
  `).bind(character.id).first<{ id: number }>()
  if (!conversation) return { messages: [], nextCursor: null }

  const beforeFilter = input.beforeId > 0 ? 'AND id < ?' : ''
  const bindings = input.beforeId > 0
    ? [conversation.id, input.beforeId, input.limit + 1]
    : [conversation.id, input.limit + 1]
  const result = await database().prepare(`
    SELECT id, source_message_id, request_id, agent_id, direction, message_type,
      sender_name_snapshot, content, status, error_message, sent_at, created_at
    FROM chat_messages
    WHERE conversation_id = ? ${beforeFilter}
    ORDER BY id DESC
    LIMIT ?
  `).bind(...bindings).all<MessageRow>()
  const hasMore = result.results.length > input.limit
  const rows = result.results.slice(0, input.limit)
  return {
    messages: rows.map((row) => ({
      id: row.id,
      sourceMessageId: row.source_message_id || '',
      requestId: row.request_id || '',
      agentId: row.agent_id || '',
      direction: row.direction,
      messageType: row.message_type,
      senderName: row.sender_name_snapshot || '',
      content: row.content,
      status: row.status,
      errorMessage: row.error_message || '',
      sentAt: row.sent_at,
      createdAt: row.created_at,
    })),
    nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
  }
}
