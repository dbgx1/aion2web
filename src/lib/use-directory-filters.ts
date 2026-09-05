import { useCallback, useEffect, useRef, useState } from 'react'

export const ALL_SERVERS_KEY = '__all__'
type DirectoryFilters = { raceId: string; serverKey: string; legionName: string | null }
const DEFAULT_FILTERS: DirectoryFilters = { raceId: '0', serverKey: ALL_SERVERS_KEY, legionName: null }

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
    return { raceId: filters.raceId, serverKey: filters.serverKey, legionName: filters.legionName || null }
  } catch {
    // Disabled browser storage or old/corrupt preferences must not break the page.
    return DEFAULT_FILTERS
  }
}

export function useDirectoryFilters(storageKey?: string) {
  const [snapshot, setSnapshot] = useState<{ key?: string; filters: DirectoryFilters } | null>(null)
  const current = useRef(snapshot)
  useEffect(() => {
    const next = { key: storageKey, filters: readFilters(storageKey) }
    current.current = next
    setSnapshot(next)
  }, [storageKey])
  const ready = snapshot !== null && snapshot.key === storageKey
  const filters = ready ? snapshot.filters : DEFAULT_FILTERS
  const updateFilters = useCallback((update: (previous: DirectoryFilters) => DirectoryFilters) => {
    if (!current.current || current.current.key !== storageKey) return
    const next = { key: storageKey, filters: update(current.current.filters) }
    current.current = next
    setSnapshot(next)
    // Save at selection time, not in a later effect that a route change could interrupt.
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(next.filters)) } catch { /* Keep working in memory. */ }
    }
  }, [storageKey])
  return { filters, ready, updateFilters }
}
