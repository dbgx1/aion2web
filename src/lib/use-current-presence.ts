import { useEffect, useRef, useState } from 'react'
import { PRESENCE_TIMEOUT_MS, type PresenceCharacter } from './presence-mqtt'
import type { PresenceQueryOutcome } from './use-presence-query'

type RunQuery = (loadTargets: (signal: AbortSignal) => Promise<PresenceCharacter[]>, signal?: AbortSignal) => Promise<PresenceQueryOutcome>

/** Poll only the open conversation, sharing the manual query's single-flight guard. */
export function useCurrentPresence({ target, contextKey, active, connected, intervalMs, runQuery }: {
  target?: PresenceCharacter
  contextKey: string
  active: boolean
  connected: boolean
  intervalMs: number
  runQuery: RunQuery
}) {
  const [message, setMessage] = useState('')
  const latest = useRef({ target, runQuery })
  const inFlight = useRef<Promise<PresenceQueryOutcome> | null>(null)
  useEffect(() => { latest.current = { target, runQuery } })
  const serverId = target?.serverId
  const characterId = target?.characterId

  useEffect(() => {
    if (!active || !serverId || !characterId) { setMessage(''); return }
    if (!intervalMs) { setMessage('定时查询已关闭'); return }
    if (!connected) { setMessage('连接断开，定时查询已暂停'); return }
    const interval = Math.max(30_000, intervalMs)
    let disposed = false
    let running = false
    let failures = 0
    let timer: number | undefined
    let controller: AbortController | undefined
    const available = () => !disposed && navigator.onLine && document.visibilityState === 'visible'
    const pauseMessage = () => navigator.onLine ? '页面隐藏，定时查询已暂停' : '网络断开，定时查询已暂停'

    function schedule(delay: number) {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void poll(), delay)
    }

    async function poll() {
      if (running || !available()) return
      running = true
      let outcome: PresenceQueryOutcome = 'aborted'
      try {
        // A cancelled previous conversation may still be saving its received results.
        if (inFlight.current) await inFlight.current
        if (!available()) return
        controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PRESENCE_TIMEOUT_MS + 15_000)])
        setMessage('正在查询当前角色…')
        const query = latest.current.runQuery(async () => [{ serverId: serverId!, characterId: characterId!, name: latest.current.target?.name }], signal)
        inFlight.current = query
        try { outcome = await query }
        finally { if (inFlight.current === query) inFlight.current = null }
        if (signal.aborted && !controller.signal.aborted) outcome = 'failed'
      } catch {
        outcome = 'failed'
      } finally {
        running = false
        controller = undefined
        if (!disposed) {
          if (!available()) setMessage(pauseMessage())
          else if (outcome === 'busy') {
            setMessage('等待当前在线查询完成…')
            schedule(5_000)
          } else if (outcome === 'aborted') {
            setMessage(`本轮已停止，${interval / 1000} 秒后再查`)
            schedule(interval)
          }
          else {
            failures = outcome === 'failed' ? failures + 1 : 0
            const delay = Math.min(300_000, interval * 2 ** Math.min(failures, 4))
            setMessage(outcome === 'failed' ? `查询未完成，${delay / 1000} 秒后重试` : `本轮完成，${delay / 1000} 秒后再查`)
            schedule(delay)
          }
        }
      }
    }

    function wake() {
      window.clearTimeout(timer)
      if (!available()) {
        controller?.abort()
        setMessage(pauseMessage())
      } else if (!running) schedule(0)
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('offline', wake)
    wake()
    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('offline', wake)
    }
  }, [active, connected, contextKey, serverId, characterId, intervalMs])

  return message
}
