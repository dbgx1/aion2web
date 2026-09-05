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
) => Promise<void>

export function presenceCharacterKey(character: { serverId: string; characterId: string }) {
  return `${character.serverId}\u0000${character.characterId}`
}

export function queryPresenceMqtt(
  client: MqttClient,
  query: PresenceQuery,
  onResults: (envelope: PresenceEnvelope) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!client.connected) return Promise.reject(new Error('MQTT 未连接'))
  if (signal.aborted) return Promise.reject(new Error('在线查询已停止'))
  const parsed = presenceQuerySchema.safeParse(query)
  if (!parsed.success) return Promise.reject(new Error('在线查询角色格式错误'))
  const { requestId, replyTopic, expiresAt, characters } = parsed.data
  if (expiresAt <= Date.now()) return Promise.reject(new Error('查询请求已过期'))
  const pending = new Map(characters.map((character) => [presenceCharacterKey(character), character]))

  return new Promise((resolve, reject) => {
    let finished = false
    const timer = setTimeout(() => finish(new Error('在线查询超时，未返回的角色状态未知'), true), expiresAt - Date.now())
    function finish(error?: Error, reportMissing = false) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      client.removeListener('message', receive)
      client.removeListener('close', disconnected)
      signal.removeEventListener('abort', aborted)
      if (client.connected) client.unsubscribe(replyTopic)
      if (reportMissing && pending.size) {
        onResults({ type: 'presence_result', requestId, results: [...pending.values()].map((character) => ({
          ...character, status: 'unknown', checkedAt: Math.min(Date.now(), expiresAt), error: error!.message,
        })) })
      }
      if (error) reject(error)
      else resolve()
    }
    function disconnected() { finish(new Error('MQTT 连接中断，未返回的角色状态未知'), true) }
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
    signal.addEventListener('abort', aborted, { once: true })
    // Wait for SUBACK so a fast query result cannot arrive before subscription.
    client.subscribe(replyTopic, { qos: 1 }, (error, grants) => {
      if (finished) return
      if (error || !grants?.length || grants.some((grant) => grant.qos === 128)) {
        finish(error || new Error('MQTT 查询结果订阅失败'))
        return
      }
      client.publish(query.requestTopic, JSON.stringify({
        type: 'presence_query', requestId, serviceId: query.serviceId, replyTopic, expiresAt,
        characters: [...pending.values()],
      }), { qos: 1, retain: false }, (publishError) => {
        if (publishError) finish(publishError)
      })
    })
  })
}
