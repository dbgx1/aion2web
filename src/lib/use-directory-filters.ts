import { useCallback, useEffect, useRef, useState } from 'react'

export const ALL_SERVERS_KEY = '__all__'
export type CharacterSort = 'default' | 'power_desc' | 'power_asc'
type DirectoryFilters = { raceId: string; serverKey: string; legionName: string | null; legionLeadersOnly: boolean; sort: CharacterSort }
const DEFAULT_FILTERS: DirectoryFilters = { raceId: '0', serverKey: ALL_SERVERS_KEY, legionName: null, legionLeadersOnly: false, sort: 'default' }

function readFilters(storageKey?: string): DirectoryFilters {
  if (!storageKey) return DEFAULT_FILTERS
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return DEFAULT_FILTERS
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_FILTERS
    const filters = value as Record<string, unknown>
    if (!['0', '1', '2'].includes(String(filters.raceId)) || typeof filters.raceId !== 'string'
      || typeof filters.serverKey !== 'string' || !filters.serverKey || filters.serverKey.length > 100
      || (filters.legionName !== null && (typeof filters.legionName !== 'string' || filters.legionName.length > 1000))) return DEFAULT_FILTERS
    return { raceId: filters.raceId, serverKey: filters.serverKey, legionName: filters.legionName || null, legionLeadersOnly: filters.legionLeadersOnly === true,
      sort: filters.sort === 'power_desc' || filters.sort === 'power_asc' ? filters.sort : 'default' }
  } catch {
    // Disabled browser storage or old/corrupt preferences must not break the page.
    return DEFAULT_FILTERS
  }
}

export type DirectoryInitialScope = { key: string; serverId?: string }

export function useDirectoryFilters(storageKey?: string, initialScope?: DirectoryInitialScope) {
  const scopeKey = initialScope ? JSON.stringify([initialScope.key, initialScope.serverId || '']) : ''
  const defaultServer = initialScope?.serverId || ALL_SERVERS_KEY
  const [snapshot, setSnapshot] = useState<{ key?: string; scopeKey: string; filters: DirectoryFilters } | null>(null)
  const current = useRef(snapshot)
  useEffect(() => {
    const saved = readFilters(storageKey)
    // Opening a client or detecting its new server starts on that server. Keep
    // manual choices for this visit, but don't restore another client's scope.
    const filters = scopeKey ? { ...saved, raceId: '0', serverKey: defaultServer, legionName: null, legionLeadersOnly: false } : saved
    const next = { key: storageKey, scopeKey, filters }
    current.current = next
    setSnapshot(next)
  }, [storageKey, scopeKey, defaultServer])
  const ready = snapshot !== null && snapshot.key === storageKey && snapshot.scopeKey === scopeKey
  const filters = ready ? snapshot.filters : { ...DEFAULT_FILTERS, serverKey: defaultServer }
  const updateFilters = useCallback((update: (previous: DirectoryFilters) => DirectoryFilters) => {
    if (!current.current || current.current.key !== storageKey || current.current.scopeKey !== scopeKey) return
    const next = { key: storageKey, scopeKey, filters: update(current.current.filters) }
    current.current = next
    setSnapshot(next)
    // Save at selection time, not in a later effect that a route change could interrupt.
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(next.filters)) } catch { /* Keep working in memory. */ }
    }
  }, [storageKey, scopeKey])
  return { filters, ready, updateFilters }
}
