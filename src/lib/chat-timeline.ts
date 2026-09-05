export type ChatTimelineEvent = {
  id: string
  agentId: string
  messageType: string
  gameMessageId?: string
  sourceMessageIds?: string[]
  content: string
  direction: 'incoming' | 'outgoing' | 'system'
  requestId: string
  time: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

/** Keep game GUIDs as strings: they exceed JavaScript's safe integer range. */
export function gameMessageIdFromRaw(raw: unknown): string {
  const value = record(raw)
  const payload = record(value.payload)
  const guid = record(record(value.result).response).guid
    ?? record(payload.jsonData).guid ?? record(value.jsonData).guid
  return typeof guid === 'string' ? guid
    : typeof guid === 'number' && Number.isSafeInteger(guid) ? String(guid) : ''
}

/** Input must already be scoped to one account/character conversation. */
export function mergePrivateChatTimeline(events: ChatTimelineEvent[]): ChatTimelineEvent[] {
  const sources = new Map<string, ChatTimelineEvent>()
  for (const event of events) {
    const key = JSON.stringify([event.agentId, event.id])
    const previous = sources.get(key)
    // A live copy may lack the correlation added by the history endpoint.
    sources.set(key, { ...event, gameMessageId: event.gameMessageId || previous?.gameMessageId })
  }

  const requestGames = new Map<string, string>()
  for (const event of sources.values()) {
    if (event.requestId && event.gameMessageId
      && (event.messageType === 'control_result' || event.messageType === 'control_sent')) {
      requestGames.set(JSON.stringify([event.agentId, event.requestId]), event.gameMessageId)
    }
  }

  const timeline = new Map<string, ChatTimelineEvent>()
  for (const event of sources.values()) {
    if (event.messageType === 'control_ack' || event.messageType === 'control_result') continue
    const requestKey = JSON.stringify([event.agentId, event.requestId])
    const gameMessageId = event.gameMessageId || (
      event.messageType === 'control_sent' ? requestGames.get(requestKey) : undefined
    )
    const isChat = event.messageType === 'chat_message' || event.messageType === 'control_sent'
    const key = JSON.stringify([event.agentId, event.direction,
      isChat && gameMessageId ? ['game', gameMessageId]
        : event.messageType === 'control_sent' && event.requestId ? ['request', event.requestId]
          : ['source', event.id],
    ])
    const previous = timeline.get(key)
    // Show the game's content/time, retaining the command's request for send status.
    const preferred = previous?.messageType === 'chat_message' ? previous : event
    const requestId = event.requestId || previous?.requestId || ''
    timeline.set(key, {
      ...preferred,
      id: requestId ? JSON.stringify([event.agentId, 'request', requestId]) : key,
      requestId,
      gameMessageId,
      sourceMessageIds: [...new Set([...(previous?.sourceMessageIds || []), event.id])],
    })
  }
  return [...timeline.values()].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
}
