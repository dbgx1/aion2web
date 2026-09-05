import { createFileRoute } from '@tanstack/react-router'
import type { ChatMessageUpload } from '#/lib/chat-storage'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { listMessages, storeMessages } from '#/server/messages.server'

const MAX_BODY_BYTES = 512 * 1024
const MAX_MESSAGES = 50
const MAX_BATCH_CONVERSATIONS = 50
const MAX_BATCH_MESSAGES = 250
const DIRECTIONS = new Set(['incoming', 'outgoing', 'system'])
const STATUSES = new Set(['pending', 'sent', 'delivered', 'received', 'failed'])

async function readMessageBody(request: Request) {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return body + decoder.decode()
      bytes += chunk.value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function parseMessage(value: unknown, index: number): ChatMessageUpload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`messages[${index}] 必须是对象`)
  }
  const input = value as Record<string, unknown>
  const direction = text(input.direction, 16)
  const content = text(input.content, 10_000)
  const sentAt = typeof input.sentAt === 'number' ? input.sentAt : Date.parse(text(input.sentAt, 64))
  const status = text(input.status, 16)
  if (!DIRECTIONS.has(direction)) throw new Error(`messages[${index}].direction 无效`)
  if (!content) throw new Error(`messages[${index}].content 不能为空`)
  if (!Number.isFinite(sentAt) || sentAt <= 0) throw new Error(`messages[${index}].sentAt 无效`)
  if (status && !STATUSES.has(status)) throw new Error(`messages[${index}].status 无效`)

  return {
    sourceMessageId: text(input.sourceMessageId, 300) || undefined,
    requestId: text(input.requestId, 300) || undefined,
    agentId: text(input.agentId, 200) || undefined,
    direction: direction as ChatMessageUpload['direction'],
    messageType: text(input.messageType, 50) || 'text',
    senderName: text(input.senderName, 200) || undefined,
    content,
    status: status ? status as ChatMessageUpload['status'] : undefined,
    errorMessage: text(input.errorMessage, 1000) || undefined,
    raw: typeof input.raw === 'object' && input.raw !== null && !Array.isArray(input.raw)
      ? input.raw as Record<string, unknown> : undefined,
    sentAt,
  }
}

function parseMessageGroup(value: unknown, index: number) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`conversations[${index}] 必须是对象`)
  }
  const input = value as Record<string, unknown>
  const serverId = text(input.serverId ?? input.server_id, 100)
  const characterId = text(input.characterId ?? input.character_id, 200)
  if (!serverId || !characterId) throw new Error(`conversations[${index}] 缺少 serverId 或 characterId`)
  if (!Array.isArray(input.messages) || input.messages.length === 0) throw new Error(`conversations[${index}].messages 不能为空`)
  if (input.messages.length > MAX_MESSAGES) throw new Error(`conversations[${index}].messages 每组最多 ${MAX_MESSAGES} 条`)
  return {
    serverId,
    characterId,
    messages: input.messages.map((message, messageIndex) => parseMessage(message, messageIndex)),
  }
}

export const Route = createFileRoute('/api/messages')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        const url = new URL(request.url)
        const serverId = text(url.searchParams.get('serverId'), 100)
        const characterId = text(url.searchParams.get('characterId'), 200)
        if (!serverId || !characterId) return jsonError('serverId 和 characterId 不能为空', 400)
        const beforeId = Math.max(0, Number.parseInt(url.searchParams.get('before') || '0', 10) || 0)
        const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50))
        const result = await listMessages({ serverId, characterId, owner: principal, beforeId, limit })
        if (!result) return jsonError('角色不存在', 404)
        return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
      },
      POST: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        const contentLength = Number(request.headers.get('content-length') || 0)
        if (contentLength > MAX_BODY_BYTES) return jsonError('请求体过大', 413)

        let rawBody: string | null
        try {
          rawBody = await readMessageBody(request)
        } catch {
          return jsonError('无法读取请求体', 400)
        }
        if (rawBody === null) return jsonError('请求体过大', 413)

        let body: unknown
        try {
          body = JSON.parse(rawBody)
        } catch {
          return jsonError('请求体必须是合法 JSON', 400)
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) return jsonError('请求体必须是对象', 400)
        const input = body as Record<string, unknown>
        if (Array.isArray(input.conversations)) {
          if (input.conversations.length === 0) return jsonError('conversations 不能为空', 400)
          if (input.conversations.length > MAX_BATCH_CONVERSATIONS) return jsonError(`每次最多上传 ${MAX_BATCH_CONVERSATIONS} 组会话`, 400)

          let conversations: ReturnType<typeof parseMessageGroup>[]
          try {
            conversations = input.conversations.map(parseMessageGroup)
          } catch (cause) {
            return jsonError(cause instanceof Error ? cause.message : '消息格式无效', 400)
          }

          const received = conversations.reduce((total, conversation) => total + conversation.messages.length, 0)
          if (received > MAX_BATCH_MESSAGES) return jsonError(`每次最多上传 ${MAX_BATCH_MESSAGES} 条消息`, 400)

          const results = []
          for (const conversation of conversations) {
            const result = await storeMessages({ ...conversation, operator: principal })
            results.push(result
              ? { ok: true, serverId: conversation.serverId, characterId: conversation.characterId, received: conversation.messages.length, ...result }
              : {
                ok: false,
                status: 404,
                serverId: conversation.serverId,
                characterId: conversation.characterId,
                received: conversation.messages.length,
                inserted: 0,
                ignored: conversation.messages.length,
                error: '角色不存在，请先上传角色信息',
              })
          }

          return Response.json({
            ok: true,
            received,
            inserted: results.reduce((total, result) => total + result.inserted, 0),
            ignored: results.reduce((total, result) => total + result.ignored, 0),
            failed: results.filter((result) => !result.ok).length,
            conversations: results,
          })
        } else {
          const serverId = text(input.serverId ?? input.server_id, 100)
          const characterId = text(input.characterId ?? input.character_id, 200)
          if (!serverId || !characterId) return jsonError('serverId 和 characterId 不能为空', 400)
          if (!Array.isArray(input.messages) || input.messages.length === 0) return jsonError('messages 不能为空', 400)
          if (input.messages.length > MAX_MESSAGES) return jsonError(`每次最多上传 ${MAX_MESSAGES} 条消息`, 400)

          let messages: ChatMessageUpload[]
          try {
            messages = input.messages.map(parseMessage)
          } catch (cause) {
            return jsonError(cause instanceof Error ? cause.message : '消息格式无效', 400)
          }
          const result = await storeMessages({ serverId, characterId, messages, operator: principal })
          if (!result) return jsonError('角色不存在，请先上传角色信息', 404)
          return Response.json({ ok: true, received: messages.length, ...result })
        }
      },
    },
  },
})
