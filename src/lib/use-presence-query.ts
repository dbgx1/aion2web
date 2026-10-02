import { useCallback, useEffect, useRef, useState } from 'react'
import { PRESENCE_BATCH_SIZE, presenceCharacterKey, type PresenceCharacter, type PresenceEnvelope, type PresenceResult, type QueryPresence } from '#/lib/presence-mqtt'

export type CharacterPresence = {
  serverId: string
  characterId: string
  name: string
  online: boolean | null
  status: 'online' | 'offline' | 'stale' | 'unknown'
  checkedAt: number | null
  updatedAt: number | null
  sourceId: string
}
function presenceKey(serverId: string, characterId: string) { return `${serverId}\u0000${characterId}` }
const ONLINE_FRESH_MS = 180_000
function queryErrorMessage(cause: unknown) {
  if (cause instanceof Error && cause.name === 'TimeoutError') return '查询服务响应超时，请检查网络及对应区服的查询客户端后重试。'
  if (cause instanceof TypeError) return '无法连接查询服务，请检查网络后重试。'
  return cause instanceof Error ? cause.message : '在线查询失败，请检查对应区服的查询客户端后重试。'
}

function normalizePresence(value: CharacterPresence, now = Date.now()): CharacterPresence {
  const status = value.online === null || value.checkedAt === null ? 'unknown'
    : now - value.checkedAt > ONLINE_FRESH_MS ? 'stale'
      : value.online ? 'online' : 'offline'
  return status === value.status ? value : { ...value, status }
}

type PresenceLookup = { serverId: string; characterId: string }
export type PresenceQueryOutcome = 'complete' | 'failed' | 'busy' | 'aborted'
type PresenceTargets = PresenceCharacter[] | AsyncIterable<PresenceCharacter[]>

export function usePresenceQuery(queryPresence: QueryPresence, lookups?: PresenceLookup[]) {
  const [windowLookups, setWindowLookups] = useState<PresenceLookup[]>([])
  const visiblePresenceLookups = lookups ?? windowLookups
  const setVisiblePresenceLookups = useCallback((next: PresenceLookup[]) => {
    setWindowLookups(current => current.length === next.length && current.every((item, index) =>
      item.serverId === next[index].serverId && item.characterId === next[index].characterId) ? current : next)
  }, [])
  const [presenceByCharacter, setPresenceByCharacter] = useState<ReadonlyMap<string, CharacterPresence>>(() => new Map())
  useEffect(() => {
    const receive = (event: Event) => {
      const results = (event as CustomEvent<PresenceResult[]>).detail
      setPresenceByCharacter(current => {
        const next = new Map(current)
        for (const result of results) {
          const key = presenceKey(result.serverId, result.characterId)
          if ((next.get(key)?.checkedAt || 0) > result.checkedAt) continue
          next.set(key, normalizePresence({ serverId: result.serverId, characterId: result.characterId,
            name: result.name || '', online: result.status === 'unknown' ? null : result.status === 'online',
            status: result.status, checkedAt: result.checkedAt, updatedAt: Date.now(), sourceId: '' }))
        }
        return next
      })
    }
    window.addEventListener('aion:presence-results', receive)
    return () => window.removeEventListener('aion:presence-results', receive)
  }, [])
  useEffect(() => {
    let nextExpiry = Infinity
    for (const status of presenceByCharacter.values()) {
      if ((status.status === 'online' || status.status === 'offline') && status.checkedAt !== null) {
        nextExpiry = Math.min(nextExpiry, status.checkedAt + ONLINE_FRESH_MS + 1)
      }
    }
    if (!Number.isFinite(nextExpiry)) return
    // Expiration is a local display update, independent of API polling success.
    const expire = () => setPresenceByCharacter(current => {
      let next: Map<string, CharacterPresence> | undefined
      const now = Date.now()
      for (const [key, value] of current) {
        const normalized = normalizePresence(value, now)
        if (normalized !== value) (next ??= new Map(current)).set(key, normalized)
      }
      return next ?? current
    })
    const timer = window.setTimeout(expire, Math.min(2_147_483_647, Math.max(0, nextExpiry - Date.now())))
    const onVisibility = () => { if (document.visibilityState === 'visible') expire() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [presenceByCharacter])
  const [presenceLoading, setPresenceLoading] = useState(false)
  const [presenceQueueing, setPresenceQueueing] = useState(false)
  const [presenceMessage, setPresenceMessage] = useState('')
  const [currentQueryMessage, setCurrentQueryMessage] = useState('')
  const [presenceError, setPresenceError] = useState(false)
  const [currentQueryError, setCurrentQueryError] = useState(false)
  const activeQuery = useRef<{ background: boolean; done: Promise<void> } | null>(null)
  const presenceQueryController = useRef<AbortController | null>(null)
  const queryGeneration = useRef(0)
  const statusController = useRef<AbortController | null>(null)
  const statusRetryAt = useRef(0)
  const statusFailures = useRef(0)
  useEffect(() => () => { ++queryGeneration.current; presenceQueryController.current?.abort() }, [])
  const refreshVisiblePresence = useCallback(async (quiet = false) => {
    if (statusController.current || !navigator.onLine
      || (quiet && (document.visibilityState === 'hidden' || Date.now() < statusRetryAt.current))) return
    if (visiblePresenceLookups.length === 0) {
      setPresenceByCharacter(new Map())
      return
    }
    const controller = new AbortController()
    statusController.current = controller
    setPresenceLoading(true)
    if (!quiet) setPresenceMessage('')
    try {
      const statuses: CharacterPresence[] = []
      for (let offset = 0; offset < visiblePresenceLookups.length; offset += 500) {
        const response = await fetch('/api/presence/status', {
          method: 'POST',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characters: visiblePresenceLookups.slice(offset, offset + 500),
            maxAgeMs: ONLINE_FRESH_MS,
          }),
        })
        const result = await response.json() as { ok?: boolean; statuses?: CharacterPresence[]; error?: string }
        if (controller.signal.aborted) return
        if (!response.ok || !result.ok || !Array.isArray(result.statuses)) throw new Error(result.error || `在线状态读取失败 (${response.status})`)
        statuses.push(...result.statuses)
      }
      statusFailures.current = 0
      statusRetryAt.current = 0
      setPresenceByCharacter((current) => {
        const next = new Map(current)
        for (const status of statuses) {
          const key = presenceKey(status.serverId, status.characterId)
          if ((status.checkedAt || 0) >= (next.get(key)?.checkedAt || 0)) next.set(key, normalizePresence(status))
        }
        for (const [key, status] of next) {
          next.set(key, normalizePresence(status))
        }
        return next
      })
      if (!quiet) setPresenceMessage(`已刷新 ${statuses.length} 个角色的在线状态。`)
    } catch (cause) {
      if (controller.signal.aborted) return
      statusRetryAt.current = Date.now() + Math.min(300_000, 10_000 * 2 ** Math.min(++statusFailures.current, 5))
      if (!quiet) setPresenceMessage(cause instanceof Error ? cause.message : '在线状态读取失败。')
    } finally {
      if (statusController.current === controller) {
        statusController.current = null
        setPresenceLoading(false)
      }
    }
  }, [visiblePresenceLookups])

  useEffect(() => {
    setPresenceLoading(false)
    if (visiblePresenceLookups.length === 0) return
    // Scrolling can change the visible window many times in one second.
    const initial = window.setTimeout(() => void refreshVisiblePresence(true), 200)
    const timer = window.setInterval(() => void refreshVisiblePresence(true), 10_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshVisiblePresence(true)
      else {
        statusController.current?.abort()
        statusController.current = null
        setPresenceLoading(false)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onVisibility)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onVisibility)
      statusController.current?.abort()
      statusController.current = null
    }
  }, [refreshVisiblePresence, visiblePresenceLookups.length])


  function stopQuery() {
    const controller = presenceQueryController.current
    if (!controller) return
    controller.abort()
    setPresenceQueueing(false)
    setPresenceMessage('查询已停止，已返回的结果会继续保存。')
  }

  const runQuery = useCallback(async (loadTargets: (signal: AbortSignal) => Promise<PresenceTargets>, signal?: AbortSignal, background = false): Promise<PresenceQueryOutcome> => {
    if (signal?.aborted) return 'aborted'
    // A manual batch takes priority, but waits for the current role's received
    // results to finish saving before starting another request.
    if (!background && activeQuery.current?.background) {
      presenceQueryController.current?.abort()
      await activeQuery.current.done
      if (signal?.aborted) return 'aborted'
    }
    if (presenceQueryController.current) return 'busy'
    const generation = ++queryGeneration.current
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    presenceQueryController.current = controller
    let release!: () => void
    activeQuery.current = { background, done: new Promise<void>(resolve => { release = resolve }) }
    const setMessage = background ? setCurrentQueryMessage : setPresenceMessage
    const setError = background ? setCurrentQueryError : setPresenceError
    setError(false)
    if (!background) setPresenceQueueing(true)
    setMessage('正在加载待查询角色…')
    let saveChain = Promise.resolve()
    let saveError = ''
    let received = 0
    let failed = 0
    let failureReason = ''
    let outcome: PresenceQueryOutcome = 'complete'
    try {
      const source = await loadTargets(controller.signal)
      const pages = Array.isArray(source) ? [source] : source
      const seen = new Set<string>()
      let targetCount = 0
      if (controller.signal.aborted) return 'aborted'
      function receiveResults(envelope: PresenceEnvelope) {
        if (controller.signal.aborted || presenceQueryController.current !== controller) return
        received += envelope.results.length
        failed += envelope.results.filter((result) => result.status === 'unknown').length
        failureReason ||= envelope.results.find(result => result.status === 'unknown' && result.error)?.error ?? ''
        setError(failed > 0)
        setPresenceByCharacter((current) => {
          const next = new Map(current)
          for (const result of envelope.results) {
            const key = presenceKey(result.serverId, result.characterId)
            if ((next.get(key)?.checkedAt || 0) > result.checkedAt) continue
            next.set(key, normalizePresence({
              serverId: result.serverId, characterId: result.characterId, name: result.name || '',
              online: result.status === 'unknown' ? null : result.status === 'online',
              status: result.status,
              checkedAt: result.checkedAt, updatedAt: Date.now(), sourceId: '',
            }))
          }
          return next
        })
        setMessage(`已查询 ${received}/${targetCount} 个角色，失败 ${failed} 个${received < targetCount ? '，等待其余结果…' : '，正在保存…'}${failureReason ? ` ${failureReason}` : ''}`)
        // Keep received results saving even when the operator leaves this view.
        saveChain = saveChain.then(async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt) await new Promise(resolve => window.setTimeout(resolve, 1000 * 2 ** (attempt - 1)))
            try {
              const response = await fetch('/api/presence/results', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(envelope), signal: AbortSignal.timeout(15_000),
              })
              const result = await response.json() as { ok?: boolean; error?: string }
              if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                saveError = result.error || '在线状态保存失败'
                return
              }
              if (!response.ok || !result.ok) throw new Error(result.error || '在线状态保存失败')
              return
            } catch (cause) {
              if (attempt === 2) saveError = cause instanceof Error ? cause.message : '在线状态保存失败'
            }
          }
        })
      }
      for await (const page of pages) {
        if (controller.signal.aborted) break
        const targets = page.filter(character => {
          const key = presenceCharacterKey(character)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        targetCount += targets.length
        for (let offset = 0; offset < targets.length; offset += PRESENCE_BATCH_SIZE) {
          if (controller.signal.aborted) break
          setMessage(`正在查询 ${received}/${targetCount} 个角色…`)
          await queryPresence(targets.slice(offset, offset + PRESENCE_BATCH_SIZE), receiveResults, controller.signal, (message, warning) => {
            if (!controller.signal.aborted && presenceQueryController.current === controller) {
              setMessage(message)
              setError(Boolean(warning) || failed > 0)
            }
          })
          await saveChain
          if (saveError) throw new Error('查询已停止')
        }
        if (controller.signal.aborted) break
      }
      if (failed || received < targetCount) outcome = 'failed'
      if (!controller.signal.aborted) {
        setError(outcome === 'failed')
        setMessage(outcome === 'failed'
          ? `查询未全部成功：${targetCount} 个角色中 ${failed + targetCount - received} 个状态未能确认，已返回结果已保存。原因：${failureReason || '查询客户端未返回有效状态，请检查对应区服的查询客户端后重试。'}`
          : `查询完成：${received} 个角色，失败 0 个，结果已保存。`)
      }
    } catch (cause) {
      outcome = 'failed'
      await saveChain
      if (!controller.signal.aborted) {
        setError(true)
        setMessage(`查询失败：${queryErrorMessage(cause)}${saveError ? `；部分结果未保存：${saveError}` : ''}`)
      }
    } finally {
      await saveChain
      signal?.removeEventListener('abort', abort)
      if (generation === queryGeneration.current) {
        if (presenceQueryController.current === controller) presenceQueryController.current = null
        activeQuery.current = null
        if (!background) setPresenceQueueing(false)
        if (controller.signal.aborted) {
          const timedOut = controller.signal.reason?.name === 'TimeoutError'
          setError(timedOut || Boolean(saveError))
          setMessage(timedOut ? queryErrorMessage(controller.signal.reason) : `查询已停止：已返回 ${received} 个角色，失败 ${failed} 个。${saveError ? `部分结果未保存：${saveError}` : '已返回结果已保留。'}`)
        }
      }
      release()
    }
    return controller.signal.aborted ? controller.signal.reason?.name === 'TimeoutError' ? 'failed' : 'aborted' : outcome
  }, [queryPresence])
  const runCurrentQuery = useCallback((loadTargets: (signal: AbortSignal) => Promise<PresenceCharacter[]>, signal?: AbortSignal) =>
    runQuery(loadTargets, signal, true), [runQuery])


  return { presenceByCharacter, presenceLoading, presenceQueueing, presenceMessage, presenceError, currentQueryMessage, currentQueryError, refreshVisiblePresence, runQuery, runCurrentQuery, stopQuery, setVisiblePresenceLookups }
}
