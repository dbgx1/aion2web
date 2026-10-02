import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  avatarColorFor,
  type GameCharacter,
} from '#/lib/game-characters'
import { refreshDirectory, useDirectoryResource } from './use-directory-resource'
import { ALL_SERVERS_KEY, useDirectoryFilters, type CharacterSort, type DirectoryInitialScope } from './use-directory-filters'

type ApiCharacter = {
  id: number
  characterName: string
  characterId: string
  serverId: string
  serverName: string
  legionName: string
  legionPosition: number | null
  level: number
  combatPower?: number | null
  equipItemLevel?: number | null
  gender?: number | null
  className: string
  faction: string
  avatarUrl: string
  lastSeenAt: number
}

export type CharacterResponse = {
  ok: boolean
  characters: ApiCharacter[]
  nextCursor: number | string | null
  totalCount: number | null
}

export { ALL_SERVERS_KEY } from './use-directory-filters'
export const NO_LEGION_KEY = '__none__'
export const RACE_OPTIONS = [
  { value: '0', label: '全部种族' },
  { value: '1', label: '天族' },
  { value: '2', label: '魔族' },
]

export function useServerDirectory() {
  return useDirectoryResource()
}

export function toGameCharacter(character: ApiCharacter): GameCharacter {
  return {
    id: String(character.id),
    characterId: character.characterId,
    name: character.characterName,
    serverKey: character.serverId,
    serverName: character.serverName || character.serverId,
    legionName: character.legionName,
    legionPosition: character.legionPosition ?? null,
    className: character.className,
    level: character.level,
    combatPower: character.combatPower ?? null,
    equipItemLevel: character.equipItemLevel ?? null,
    gender: character.gender ?? null,
    faction: character.faction,
    avatarUrl: character.avatarUrl,
    avatarColor: avatarColorFor(character.characterId),
    lastSeenAt: character.lastSeenAt,
  }
}

export function useCharacterDirectory(storageKey?: string, initialScope?: DirectoryInitialScope) {
  const { servers, error: directoryError } = useDirectoryResource()
  const { filters, ready: filtersReady, updateFilters } = useDirectoryFilters(storageKey, initialScope)
  const { raceId: selectedRaceId, serverKey: selectedServerKey, legionName: selectedLegionName, legionLeadersOnly, sort } = filters
  const clientServerId = initialScope?.serverId
  const filteredServers = useMemo(() => {
    const choices = clientServerId && !servers.some(server => server.serverId === clientServerId)
      ? [...servers, { serverId: clientServerId, serverName: `区服 ${clientServerId}`, raceId: 0, characterCount: 0, unaffiliatedCount: 0, legions: [] }]
      : servers
    return selectedRaceId === '0' ? choices : choices.filter(server => String(server.raceId) === selectedRaceId)
  }, [servers, selectedRaceId, clientServerId])
  const [search, setSearch] = useState('')
  const [chatStatus, setChatStatus] = useState<'all' | 'chatted' | 'unchatted'>('all')
  const [chatRevision, setChatRevision] = useState(0)
  useEffect(() => {
    if (chatStatus === 'all') return
    const refresh = () => setChatRevision(value => value + 1)
    window.addEventListener('aion:chat-history-saved', refresh)
    return () => window.removeEventListener('aion:chat-history-saved', refresh)
  }, [chatStatus])
  const [characters, setCharacters] = useState<GameCharacter[]>([])
  const [nextCursor, setNextCursor] = useState<number | string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const createCharacterParams = useCallback((limit: number, cursor: number | string = 0) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (chatStatus !== 'all') params.set('chatStatus', chatStatus)
    if (selectedRaceId !== '0') params.set('raceId', selectedRaceId)
    if (selectedServerKey !== ALL_SERVERS_KEY) params.set('serverId', selectedServerKey)
    if (selectedLegionName === NO_LEGION_KEY) params.set('withoutLegion', '1')
    else if (selectedLegionName) params.set('legionName', selectedLegionName)
    if (legionLeadersOnly) params.set('legionLeadersOnly', '1')
    if (search.trim()) params.set('q', search.trim())
    if (sort !== 'default') params.set('sort', sort)
    if (cursor !== 0) params.set('cursor', String(cursor))
    return params
  }, [search, selectedLegionName, selectedServerKey, selectedRaceId, legionLeadersOnly, sort, chatStatus])

  const characterRequest = useRef<AbortController | null>(null)
  const fetchCharacters = useCallback(async (cursor: number | string, append: boolean, signal?: AbortSignal) => {
    if (!filtersReady) return
    if (append && characterRequest.current) return
    characterRequest.current?.abort()
    if (!selectedServerKey) {
      characterRequest.current = null
      setCharacters([])
      setNextCursor(null)
      setTotalCount(0)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    characterRequest.current = controller
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    setLoading(true)
    setError('')
    const params = createCharacterParams(50, cursor)
    if (append) params.set('includeTotal', '0')

    try {
      const response = await fetch(`/api/characters?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      if (!response.ok) throw new Error(`角色加载失败 (${response.status})`)
      const result = await response.json() as CharacterResponse
      if (controller.signal.aborted) return
      const nextCharacters = result.characters.map(toGameCharacter)
      setCharacters((current) => append ? [...current, ...nextCharacters] : nextCharacters)
      setNextCursor(result.nextCursor)
      if (result.totalCount !== null) setTotalCount(result.totalCount)
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : '角色加载失败')
    } finally {
      signal?.removeEventListener('abort', abort)
      if (characterRequest.current === controller) {
        characterRequest.current = null
        if (!controller.signal.aborted) setLoading(false)
      }
    }
  }, [createCharacterParams, selectedServerKey, filtersReady])

  const streamAll = useCallback(async function* (signal?: AbortSignal, pageSize = 1000) {
    if (!filtersReady) throw new Error('筛选条件正在恢复，请稍后重试。')
    if (!selectedServerKey) return

    const visitedCursors = new Set<number | string>()
    let cursor: number | string = 0
    while (true) {
      signal?.throwIfAborted()
      if (visitedCursors.has(cursor)) throw new Error('角色分页游标重复，已停止读取。')
      visitedCursors.add(cursor)

      const params = createCharacterParams(pageSize, cursor)
      params.set('bulk', '1')
      params.set('includeTotal', '0')
      const response = await fetch(`/api/characters?${params}`, { signal: AbortSignal.any([
        ...(signal ? [signal] : []), AbortSignal.timeout(15_000),
      ]) })
      if (!response.ok) throw new Error(`全部角色加载失败 (${response.status})`)
      const result = await response.json() as CharacterResponse
      signal?.throwIfAborted()
      yield result.characters.map(toGameCharacter)
      if (result.nextCursor === null) return
      cursor = result.nextCursor
    }
  }, [createCharacterParams, selectedServerKey, filtersReady])

  const loadAll = useCallback(async (signal?: AbortSignal) => {
    const characters: GameCharacter[] = []
    for await (const page of streamAll(signal)) characters.push(...page)
    return characters
  }, [streamAll])

  useEffect(() => {
    if (!filtersReady) return
    const controller = new AbortController()
    setCharacters([])
    setNextCursor(null)
    setTotalCount(0)
    setLoading(true)
    const timer = window.setTimeout(() => {
      void fetchCharacters(0, false, controller.signal)
    }, search ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      characterRequest.current?.abort()
      characterRequest.current = null
    }
  }, [fetchCharacters, search, filtersReady, chatRevision])

  const selectServer = useCallback((serverKey: string) => {
    updateFilters(previous => previous.serverKey === serverKey ? previous : { ...previous, serverKey, legionName: null })
    setSearch('')
  }, [updateFilters])

  const selectRace = useCallback((raceId: string) => {
    const normalized = raceId === '1' || raceId === '2' ? raceId : '0'
    updateFilters(previous => previous.raceId === normalized ? previous : { ...previous, raceId: normalized, serverKey: ALL_SERVERS_KEY, legionName: null })
    setSearch('')
  }, [updateFilters])

  const selectLegion = useCallback((legionName: string | null) => {
    updateFilters(previous => ({ ...previous, legionName: legionName || null }))
    setSearch('')
  }, [updateFilters])

  return {
    sort,
    chatStatus,
    chatRevision,
    setChatStatus,
    setSort: (sort: CharacterSort) => updateFilters(previous => ({ ...previous, sort })),
    legionLeadersOnly,
    setLegionLeadersOnly: (legionLeadersOnly: boolean) => updateFilters(previous => ({ ...previous, legionLeadersOnly })),
    servers: filteredServers,
    selectedRaceId,
    selectRace,
    characters,
    selectedServerKey,
    isAllServers: selectedServerKey === ALL_SERVERS_KEY,
    selectedLegionName,
    search,
    nextCursor,
    totalCount,
    loading,
    error: error || directoryError,
    setSearch,
    selectServer,
    selectLegion,
    refresh: async () => {
      await refreshDirectory(true)
      await fetchCharacters(0, false)
    },
    loadMore: () => nextCursor === null ? Promise.resolve() : fetchCharacters(nextCursor, true),
    loadAll,
    streamAll,
  }
}
