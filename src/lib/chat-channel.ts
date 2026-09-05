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

// Only private game events can supply a missing directory identity. In outgoing
// echoes the sender is the local player; the receiver is the conversation peer.
export function privateChatPeerFromPayload(value: unknown) {
  if (!isPrivateChatPayload(value)) return null
  const raw = record(value)
  const payload = raw.payload ? record(raw.payload) : raw
  const data = record(payload.jsonData)
  const meta = record(raw.chat_meta)
  const outgoing = isOutgoingChatPayload(value)
  const identifier = (value: unknown) => typeof value === 'string' ? value.trim()
    : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : ''
  const characterId = identifier(outgoing
    ? meta.receiverCharacterId || data.receiverCharacterId
    : meta.senderCharacterId || data.playNcCharId)
  const serverId = identifier(outgoing
    ? meta.receiverServerId || data.receiverServerId || meta.serverId || data.serverId
    : meta.serverId || data.serverId)
  const name = outgoing ? meta.receiver || data.receiverUserName : meta.sender || data.userName || data.alias
  const characterName = typeof name === 'string' ? name.trim() : ''
  if (!characterId || characterId.length > 120 || !serverId || serverId.length > 120
    || !characterName || characterName.length > 120) return null
  return { characterId, serverId, characterName, direction: outgoing ? 'outgoing' : 'incoming' }
}
