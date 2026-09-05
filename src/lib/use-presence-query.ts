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

function normalizePresence(value: CharacterPresence, now = Date.now()): CharacterPresence {
  const status = value.online === false ? 'offline'
    : value.online !== true ? 'unknown'
      : value.checkedAt !== null && now - value.checkedAt > ONLINE_FRESH_MS ? 'stale' : 'online'
  return status === value.status ? value : { ...value, status }
}

type PresenceLookup = { serverId: string; characterId: string }

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
      if (status.status === 'online' && status.checkedAt !== null) {
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
    presenceQueryController.current = null
    setPresenceQueueing(false)
    setPresenceMessage('查询已停止，已返回的结果会继续保存。')
  }

  async function runQuery(loadTargets: (signal: AbortSignal) => Promise<PresenceCharacter[]>) {
    if (presenceQueryController.current) return
    const generation = ++queryGeneration.current
    const controller = new AbortController()
    presenceQueryController.current = controller
    setPresenceQueueing(true)
    setPresenceMessage('正在加载待查询角色…')
    let saveChain = Promise.resolve()
    let saveError = ''
    let received = 0
    let failed = 0
    try {
      const targets = [...new Map((await loadTargets(controller.signal)).map(character => [presenceCharacterKey(character), character])).values()]
      if (controller.signal.aborted) return
      function receiveResults(envelope: PresenceEnvelope) {
        if (controller.signal.aborted || presenceQueryController.current !== controller) return
        received += envelope.results.length
        failed += envelope.results.filter((result) => result.status === 'unknown').length
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
        setPresenceMessage(`已查询 ${received}/${targets.length} 个角色，失败 ${failed} 个，正在保存…`)
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
      for (let offset = 0; offset < targets.length; offset += PRESENCE_BATCH_SIZE) {
        if (controller.signal.aborted) break
        setPresenceMessage(`正在查询 ${received}/${targets.length} 个角色…`)
        await queryPresence(targets.slice(offset, offset + PRESENCE_BATCH_SIZE), receiveResults, controller.signal)
        await saveChain
        if (saveError) throw new Error('查询已停止')
      }
      if (!controller.signal.aborted) setPresenceMessage(`查询完成：${received} 个角色，失败 ${failed} 个，结果已保存。`)
    } catch (cause) {
      await saveChain
      if (!controller.signal.aborted) {
        setPresenceMessage(`${cause instanceof Error ? cause.message : '在线查询失败'}${saveError ? `；部分结果未保存：${saveError}` : ''}`)
      }
    } finally {
      await saveChain
      if (generation === queryGeneration.current) {
        if (presenceQueryController.current === controller) presenceQueryController.current = null
        setPresenceQueueing(false)
        if (controller.signal.aborted) setPresenceMessage(`查询已停止：已返回 ${received} 个角色，失败 ${failed} 个。${saveError ? `部分结果未保存：${saveError}` : '已返回结果已保留。'}`)
      }
    }
  }


  return { presenceByCharacter, presenceLoading, presenceQueueing, presenceMessage, refreshVisiblePresence, runQuery, stopQuery, setVisiblePresenceLookups }
}
