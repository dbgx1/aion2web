import { ArrowDown } from 'lucide-react'

export function ChatScrollNotice({ paused, unread, onLatest }: { paused: boolean; unread: number; onLatest: () => void }) {
  if (!paused) return null
  return <button type="button" className="chat-scroll-notice" onClick={onLatest} aria-label={unread ? `${unread} 条新消息，回到最新消息` : '回到最新消息'}>
    <ArrowDown size={15} aria-hidden="true" />
    <span>{unread ? `${unread} 条新消息` : '回到最新消息'}</span>
  </button>
}
