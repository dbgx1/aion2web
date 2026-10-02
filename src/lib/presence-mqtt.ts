import type { MqttClient } from 'mqtt'
import { z } from 'zod'

export const PRESENCE_BATCH_SIZE = 50
export const PRESENCE_TIMEOUT_MS = 180_000
const id = z.string().trim().min(1).max(200)
export const presenceCharacterSchema = z.object({
  serverId: id,
  characterId: id,
  name: z.string().max(200).optional(),
})
export const presenceResultSchema = presenceCharacterSchema.extend({
  status: z.enum(['online', 'offline', 'unknown']),
  checkedAt: z.number().int().positive().refine((value) => value <= Date.now() + 60_000),
  error: z.string().trim().min(1).max(500).optional(),
}).refine((value) => !value.error || value.status === 'unknown')
export const presenceEnvelopeSchema = z.object({
  type: z.literal('presence_result'),
  requestId: id,
  results: z.array(presenceResultSchema).min(1).max(PRESENCE_BATCH_SIZE),
})
export type PresenceCharacter = z.infer<typeof presenceCharacterSchema>
export type PresenceResult = z.infer<typeof presenceResultSchema>
export type PresenceEnvelope = z.infer<typeof presenceEnvelopeSchema>
export const presenceQuerySchema = z.object({
  type: z.literal('presence_query'), requestId: z.string().uuid(),
  serviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  requestTopic: z.string(), replyTopic: z.string(), expiresAt: z.number().int(),
  characters: z.array(presenceCharacterSchema).min(1).max(PRESENCE_BATCH_SIZE),
}).refine(query => query.requestTopic === `aion2/presence/${query.serviceId}/requests`
  && query.replyTopic === `aion2/presence/${query.serviceId}/results/${query.requestId}`)
export type PresenceQuery = z.infer<typeof presenceQuerySchema>
export type QueryPresence = (
  characters: PresenceCharacter[],
  onResults: (envelope: PresenceEnvelope) => void,
  signal: AbortSignal,
  onProgress?: (message: string, warning?: boolean) => void,
) => Promise<void>

export function presenceCharacterKey(character: { serverId: string; characterId: string }) {
  return `${character.serverId}\u0000${character.characterId}`
}

export function queryPresenceMqtt(
  client: MqttClient,
  query: PresenceQuery,
  onResults: (envelope: PresenceEnvelope) => void,
  signal: AbortSignal,
  onProgress?: (message: string, warning?: boolean) => void,
): Promise<void> {
  if (client.disconnecting) return Promise.reject(new Error('MQTT 已断开，请重新连接后查询'))
  if (signal.aborted) return Promise.reject(new Error('在线查询已停止'))
  const parsed = presenceQuerySchema.safeParse(query)
  if (!parsed.success) return Promise.reject(new Error('在线查询角色格式错误'))
  const { requestId, replyTopic, expiresAt, characters } = parsed.data
  if (expiresAt <= Date.now()) return Promise.reject(new Error('查询请求已过期'))
  const pending = new Map(characters.map((character) => [presenceCharacterKey(character), character]))

  return new Promise((resolve, reject) => {
    let finished = false
    let attempt = 0
    const slowTimer = setTimeout(() => {
      if (!finished && pending.size) onProgress?.(`查询较慢：还有 ${pending.size} 个角色未返回，可能正在排队或等待客户端响应。请检查对应区服的查询客户端；最多再等待 ${Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))} 秒。`, true)
    }, 15_000)
    const timer = setTimeout(() => finish(new Error('在线查询超时，未返回的角色状态未知。请检查对应区服的查询客户端是否在线、游戏是否可查询，再重试。'), true), expiresAt - Date.now())
    function finish(error?: Error, reportMissing = false) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearTimeout(slowTimer)
      client.removeListener('message', receive)
      client.removeListener('close', disconnected)
      client.removeListener('connect', subscribeAndQuery)
      client.removeListener('end', ended)
      signal.removeEventListener('abort', aborted)
      // MQTT.js removes its reconnect subscription cache even while offline.
      // Skipping this on disconnect leaks every canceled/expired result topic.
      if (!client.disconnecting) client.unsubscribe(replyTopic)
      if (reportMissing && pending.size) {
        onResults({ type: 'presence_result', requestId, results: [...pending.values()].map((character) => ({
          ...character, status: 'unknown', checkedAt: Math.min(Date.now(), expiresAt), error: error!.message,
        })) })
      }
      if (error) reject(error)
      else resolve()
    }
    function disconnected() {
      ++attempt // Ignore callbacks belonging to the closed connection.
      onProgress?.('查询连接已中断，正在等待重连。请检查网络；超过本次查询时限后会显示超时。', true)
    }
    function ended() { finish(new Error('MQTT 已断开，请重新连接后查询'), true) }
    function aborted() { finish(new Error('在线查询已停止')) }
    function receive(topic: string, buffer: Uint8Array) {
      if (finished || topic !== replyTopic) return
      let value: unknown
      try { value = JSON.parse(new TextDecoder().decode(buffer)) } catch { return }
      const parsedEnvelope = presenceEnvelopeSchema.safeParse(value)
      if (!parsedEnvelope.success) return
      const envelope = parsedEnvelope.data
      if (envelope.requestId !== requestId) return
      const results: PresenceResult[] = []
      for (const result of envelope.results) {
        const key = presenceCharacterKey(result)
        const character = pending.get(key)
        if (!character || result.checkedAt < expiresAt - PRESENCE_TIMEOUT_MS - 60_000) continue
        pending.delete(key)
        results.push({ ...result, name: character.name })
      }
      if (results.length) onResults({ ...envelope, results })
      if (!pending.size) finish()
    }
    client.on('message', receive)
    client.on('close', disconnected)
    client.on('connect', subscribeAndQuery)
    client.on('end', ended)
    signal.addEventListener('abort', aborted, { once: true })
    if (client.connected) subscribeAndQuery()
    else disconnected()
    function subscribeAndQuery() {
      if (finished || !client.connected) return
      if (Date.now() >= expiresAt) {
        finish(new Error('在线查询超时，未返回的角色状态未知'), true)
        return
      }
      const currentAttempt = ++attempt
      onProgress?.(`正在查询剩余 ${pending.size} 个角色…`)
      // Wait for SUBACK so a fast query result cannot arrive before subscription.
      client.subscribe(replyTopic, { qos: 1 }, (error, grants) => {
        if (finished || currentAttempt !== attempt || !client.connected) return
        if (error || !grants?.length || grants.some((grant) => grant.qos === 128)) {
          finish(error || new Error('MQTT 查询结果订阅失败'))
          return
        }
        client.publish(query.requestTopic, JSON.stringify({
          type: 'presence_query', requestId, serviceId: query.serviceId, replyTopic, expiresAt,
          characters: [...pending.values()],
        }), { qos: 1, retain: false }, (publishError) => {
          if (finished || currentAttempt !== attempt || !client.connected) return
          if (publishError) finish(publishError)
        })
      })
    }
  })
}
