import { useCallback, useEffect, useState } from 'react'
import {
  avatarColorFor,
  type CharacterDirectoryServer,
  type GameCharacter,
} from '#/lib/game-characters'

type ApiCharacter = {
  id: number
  characterName: string
  characterId: string
  serverId: string
  serverName: string
  legionName: string
  level: number
  className: string
  faction: string
  avatarUrl: string
}

type CharacterResponse = {
  ok: boolean
  characters: ApiCharacter[]
  nextCursor: number | null
}

type ServerDirectoryResponse = {
  ok: boolean
  servers: CharacterDirectoryServer[]
}

export const ALL_SERVERS_KEY = '__all__'
export const NO_LEGION_KEY = '__none__'

export function useServerDirectory() {
  const [servers, setServers] = useState<CharacterDirectoryServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/characters?directory=1', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`目录加载失败 (${response.status})`)
        return response.json() as Promise<ServerDirectoryResponse>
      })
      .then((result) => setServers(result.servers))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setError(caught instanceof Error ? caught.message : '目录加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  return { servers, loading, error }
}

function toGameCharacter(character: ApiCharacter): GameCharacter {
  return {
    id: String(character.id),
    characterId: character.characterId,
    name: character.characterName,
    serverKey: character.serverId,
    serverName: character.serverName || character.serverId,
    legionName: character.legionName,
    className: character.className,
    level: character.level,
    faction: character.faction,
    avatarUrl: character.avatarUrl,
    avatarColor: avatarColorFor(character.characterId),
  }
}

export function useCharacterDirectory() {
  const [servers, setServers] = useState<CharacterDirectoryServer[]>([])
  const [selectedServerKey, setSelectedServerKey] = useState('')
  const [selectedLegionName, setSelectedLegionName] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [characters, setCharacters] = useState<GameCharacter[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/characters?directory=1', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`目录加载失败 (${response.status})`)
        return response.json() as Promise<ServerDirectoryResponse>
      })
      .then((result) => {
        setServers(result.servers)
        setSelectedServerKey((current) => current || result.servers[0]?.serverId || '')
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setError(caught instanceof Error ? caught.message : '目录加载失败')
        setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const fetchCharacters = useCallback(async (cursor: number, append: boolean, signal?: AbortSignal) => {
    if (!selectedServerKey) {
      setCharacters([])
      setNextCursor(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ limit: '50' })
    if (selectedServerKey !== ALL_SERVERS_KEY) params.set('serverId', selectedServerKey)
    if (selectedLegionName === NO_LEGION_KEY) params.set('withoutLegion', '1')
    else if (selectedLegionName) params.set('legionName', selectedLegionName)
    if (search.trim()) params.set('q', search.trim())
    if (cursor > 0) params.set('cursor', String(cursor))

    try {
      const response = await fetch(`/api/characters?${params}`, { signal })
      if (!response.ok) throw new Error(`角色加载失败 (${response.status})`)
      const result = await response.json() as CharacterResponse
      const nextCharacters = result.characters.map(toGameCharacter)
      setCharacters((current) => append ? [...current, ...nextCharacters] : nextCharacters)
      setNextCursor(result.nextCursor)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof Error ? caught.message : '角色加载失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [search, selectedLegionName, selectedServerKey])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetchCharacters(0, false, controller.signal)
    }, search ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [fetchCharacters, search])

  function selectServer(serverKey: string) {
    setSelectedServerKey(serverKey)
    setSelectedLegionName(null)
    setSearch('')
  }

  function selectLegion(legionName: string | null) {
    setSelectedLegionName(legionName)
    setSearch('')
  }

  return {
    servers,
    characters,
    selectedServerKey,
    isAllServers: selectedServerKey === ALL_SERVERS_KEY,
    selectedLegionName,
    search,
    nextCursor,
    loading,
    error,
    setSearch,
    selectServer,
    selectLegion,
    loadMore: () => nextCursor === null ? Promise.resolve() : fetchCharacters(nextCursor, true),
  }
}
