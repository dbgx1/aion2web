import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoredChatMessage } from './chat-storage'

/** One cancellable page request per conversation; retries retain the previous cursor. */
export function useChatHistory(serverId = '', characterId = '') {
  const [messages, setMessages] = useState<StoredChatMessage[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const activeRequest = useRef<AbortController | null>(null)
  const failedPage = useRef(0)

  const fetchPage = useCallback(async (before = 0) => {
    if (!serverId || !characterId || activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ serverId, characterId, limit: '50' })
    if (before) params.set('before', String(before))
    try {
      const response = await fetch(`/api/messages?${params}`, { headers: { Accept: 'application/json' }, signal })
      const result = await response.json() as { ok?: boolean; messages?: StoredChatMessage[]; nextCursor?: number | null; error?: string }
      if (!response.ok) throw new Error(result.error || '读取聊天记录失败')
      if (signal.aborted || activeRequest.current !== controller) return
      if (!result.ok || !Array.isArray(result.messages) || !(result.nextCursor === null
        || (Number.isSafeInteger(result.nextCursor) && result.nextCursor! > 0 && (!before || result.nextCursor! < before)))) {
        throw new Error('聊天记录响应无效，请重试。')
      }
      setMessages(current => before
        ? [...new Map([...current, ...(result.messages || [])].map(message => [message.id, message])).values()]
        : result.messages || [])
      setCursor(result.nextCursor ?? null)
    } catch (cause) {
      if (controller.signal.aborted || activeRequest.current !== controller) return
      failedPage.current = before
      setError(signal.aborted ? '聊天记录读取超时，请重试。' : cause instanceof Error ? cause.message : '读取聊天记录失败')
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }, [serverId, characterId])

  useEffect(() => {
    setMessages([])
    setCursor(null)
    setError('')
    setLoading(false)
    failedPage.current = 0
    void fetchPage()
    return () => {
      activeRequest.current?.abort()
      activeRequest.current = null
    }
  }, [fetchPage])

  return { messages, cursor, loading, error,
    loadOlder: () => cursor === null ? Promise.resolve() : fetchPage(cursor),
    retry: () => fetchPage(failedPage.current),
  }
}
