import type { ChatMessageUpload } from './chat-storage'

export const MESSAGE_SYNC_MAX_BYTES = 512 * 1024
const MAX_GROUPS = 25
const MAX_MESSAGES = 100
const MAX_GROUP_MESSAGES = 50
const encoder = new TextEncoder()

export type MessageSyncGroup<T> = {
  serverId: string
  characterId: string
  sourceMessages: T[]
  messages: ChatMessageUpload[]
}

export function messageSyncBody<T>(groups: MessageSyncGroup<T>[]) {
  return JSON.stringify({ conversations: groups.map(({ serverId, characterId, messages }) => ({ serverId, characterId, messages })) })
}

// Measure the actual UTF-8 JSON, including raw data, escaping and envelope bytes.
// Oversize individual messages are surfaced to the caller, never silently saved.
export function packMessageSync<T>(groups: MessageSyncGroup<T>[]) {
  const chunks: MessageSyncGroup<T>[][] = []
  const rejected: T[] = []
  const envelopeBytes = encoder.encode('{"conversations":[]}').byteLength
  let chunk: MessageSyncGroup<T>[] = []
  let chunkBytes = envelopeBytes
  let chunkCount = 0
  function append(group: MessageSyncGroup<T>, bytes: number) {
    if (chunk.length && (chunk.length >= MAX_GROUPS || chunkCount + group.messages.length > MAX_MESSAGES
      || chunkBytes + bytes + 1 > MESSAGE_SYNC_MAX_BYTES)) {
      chunks.push(chunk)
      chunk = []
      chunkBytes = envelopeBytes
      chunkCount = 0
    }
    chunkBytes += bytes + (chunk.length ? 1 : 0)
    chunkCount += group.messages.length
    chunk.push(group)
  }
  for (const group of groups) {
    const empty = () => ({ serverId: group.serverId, characterId: group.characterId, messages: [] as ChatMessageUpload[], sourceMessages: [] as T[] })
    const baseBytes = encoder.encode(JSON.stringify({ serverId: group.serverId, characterId: group.characterId, messages: [] })).byteLength
    let part = empty()
    let partBytes = baseBytes
    group.messages.forEach((message, index) => {
      const bytes = encoder.encode(JSON.stringify(message)).byteLength
      if (envelopeBytes + baseBytes + bytes > MESSAGE_SYNC_MAX_BYTES) {
        rejected.push(group.sourceMessages[index])
        return
      }
      if (part.messages.length && (part.messages.length >= MAX_GROUP_MESSAGES
        || envelopeBytes + partBytes + bytes + 1 > MESSAGE_SYNC_MAX_BYTES)) {
        append(part, partBytes)
        part = empty()
        partBytes = baseBytes
      }
      partBytes += bytes + (part.messages.length ? 1 : 0)
      part.messages.push(message)
      part.sourceMessages.push(group.sourceMessages[index])
    })
    if (part.messages.length) append(part, partBytes)
  }
  if (chunk.length) chunks.push(chunk)
  return { chunks, rejected }
}
