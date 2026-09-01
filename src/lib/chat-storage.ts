export type StoredChatMessage = {
  id: number
  sourceMessageId: string
  requestId: string
  agentId: string
  direction: 'incoming' | 'outgoing' | 'system'
  messageType: string
  senderName: string
  content: string
  status: 'pending' | 'sent' | 'delivered' | 'received' | 'failed'
  errorMessage: string
  sentAt: number
  createdAt: number
}

export type ChatMessageUpload = {
  sourceMessageId?: string
  requestId?: string
  agentId?: string
  direction: 'incoming' | 'outgoing' | 'system'
  messageType?: string
  senderName?: string
  content: string
  status?: 'pending' | 'sent' | 'delivered' | 'received' | 'failed'
  errorMessage?: string
  raw?: Record<string, unknown>
  sentAt: number
}
