import { isOutgoingChatPayload, isPrivateChatPayload } from './chat-channel'
import type { ConsoleMessage } from './use-aion-console'

export function isIncomingCharacterReply(message: ConsoleMessage) {
  return message.type === 'chat_message'
    && isPrivateChatPayload(message.raw)
    && !isOutgoingChatPayload(message.raw)
}

type InboxSnapshot = { messages: ConsoleMessage[]; readMessageIds: ReadonlySet<string> }

/** Session inbox: event-log rotation must never discard an unread reply. */
export class MessageInbox {
  private entries = new Map<string, ConsoleMessage>()
  private readIds = new Set<string>()
  private listeners = new Set<() => void>()
  private state: InboxSnapshot = { messages: [], readMessageIds: this.readIds }

  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  accept(message: ConsoleMessage) {
    if (!isIncomingCharacterReply(message) || this.entries.has(message.id) || this.readIds.has(message.id)) return
    this.entries.set(message.id, message)
    this.emit()
  }

  markRead = (ids: string[]) => {
    const unread = ids.filter(id => this.entries.has(id) && !this.readIds.has(id))
    if (!unread.length) return
    this.readIds = new Set([...this.readIds, ...unread])
    // Keep recent read replies available in the open conversation even when the
    // separate 500-event log consists entirely of bulk-send receipts.
    let readCount = 0
    for (const id of [...this.entries.keys()].reverse()) {
      if (this.readIds.has(id) && ++readCount > 500) this.entries.delete(id)
    }
    this.emit()
  }

  private emit() {
    this.state = { messages: [...this.entries.values()].reverse(), readMessageIds: this.readIds }
    for (const listener of this.listeners) listener()
  }
}
