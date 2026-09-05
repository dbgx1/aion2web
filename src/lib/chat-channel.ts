function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function isPrivateChatPayload(value: unknown) {
  const raw = record(value)
  const payload = raw.payload ? record(raw.payload) : raw
  const data = record(payload.jsonData)
  const meta = record(raw.chat_meta)
  const room = record(data.gameRoomKeyInfo)
  return meta.kind === 'private' || meta.roomType === 'ONE_ON_ONE' || room.type === 'ONE_ON_ONE'
}

export function isOutgoingChatPayload(value: unknown) {
  const raw = record(value)
  const payload = raw.payload ? record(raw.payload) : raw
  const data = record(payload.jsonData)
  const meta = record(raw.chat_meta)
  const kind = text(meta.kind || payload.kind || data.kind).toLowerCase()
  const direction = text(raw.direction || payload.direction || data.direction).toUpperCase()
  const isFromGame = data.isFromGame ?? payload.isFromGame
  return kind === 'outgoing' || direction === 'C->S' || isFromGame === true || text(isFromGame).toLowerCase() === 'true'
}
