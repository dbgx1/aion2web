import type { ConsoleMessage } from './use-aion-console'
import { isPrivateChatPayload } from './chat-channel'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : ''
}
export function publicSpeaker(message: ConsoleMessage) {
  if (message.type !== 'chat_message' || isPrivateChatPayload(message.raw)) return null
  const raw = record(message.raw)
  const payload = raw.payload ? record(raw.payload) : raw
  const data = record(payload.jsonData), meta = record(raw.chat_meta)
  // isFromGame means the message originated in the game, not that the local
  // player sent it. Real incoming WORLD messages also set it to true.
  const direction = text(raw.direction || payload.direction || data.direction).toUpperCase()
  if (direction === 'C->S' || text(meta.kind || payload.kind || data.kind).toLowerCase() === 'outgoing') return null
  return {
    characterName: text(meta.sender || data.userName || data.alias) || message.title,
    characterId: text(meta.senderCharacterId || data.playNcCharId || payload.characterId),
    serverId: text(meta.serverId || data.serverId || payload.serverKey),
  }
}
