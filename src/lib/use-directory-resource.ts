import { useEffect, useSyncExternalStore } from 'react'
import type { CharacterDirectoryServer } from './game-characters'

const EMPTY = { servers: [] as CharacterDirectoryServer[], loading: true, error: '', fetchedAt: 0 }
let snapshot = EMPTY
let pending: Promise<void> | null = null
let forcedRefresh: Promise<void> | null = null
const listeners = new Set<() => void>()
function publish(value: typeof EMPTY) {
  snapshot = value
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Browser-only shared resource: effects initiate loads; the SSR snapshot is empty.
// Both the portal and the active page use the same request and 60-second cache.
export function refreshDirectory(force = false): Promise<void> {
  if (pending) {
    if (!force) return pending
    // An import/explicit refresh during the first load must see the new data.
    return forcedRefresh ||= pending.then(() => refreshDirectory(true)).finally(() => { forcedRefresh = null })
  }
  if (!force && snapshot.fetchedAt && Date.now() - snapshot.fetchedAt < 60_000) return Promise.resolve()
  publish({ ...snapshot, loading: true, error: '' })
  pending = (async () => {
    try {
      const response = await fetch('/api/characters?directory=1', { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
      const result = await response.json() as { ok?: boolean; servers?: CharacterDirectoryServer[] }
      if (!response.ok || !result.ok || !Array.isArray(result.servers)) throw new Error(`目录加载失败 (${response.status})`)
      publish({ servers: result.servers, loading: false, error: '', fetchedAt: Date.now() })
    } catch (cause) {
      publish({ ...snapshot, loading: false, error: cause instanceof Error ? cause.message : '目录加载失败' })
    } finally { pending = null }
  })()
  return pending
}

export function useDirectoryResource() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
  useEffect(() => { void refreshDirectory() }, [])
  return state
}
