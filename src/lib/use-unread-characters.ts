import { useEffect, useMemo, useRef, useState } from 'react'
import { avatarColorFor, type GameCharacter } from '#/lib/game-characters'
import { toGameCharacter, type CharacterResponse } from '#/lib/use-character-directory'

export type UnreadTarget = { characterId: string; serverKey: string; targetName: string }

export function unreadTargetKey(target: UnreadTarget) {
  return JSON.stringify([target.serverKey, target.characterId ? 'id' : 'name', target.characterId || target.targetName])
}

export function targetMatchesCharacter(target: UnreadTarget, character: GameCharacter) {
  if (target.serverKey && target.serverKey !== character.serverKey) return false
  return target.characterId
    ? target.characterId === character.characterId
    : Boolean(target.targetName && target.targetName === character.name)
}

export function fallbackUnreadCharacter(target: UnreadTarget): GameCharacter {
  return {
    id: `unread:${unreadTargetKey(target)}`,
    characterId: target.characterId,
    name: target.targetName || target.characterId,
    serverKey: target.serverKey,
    serverName: target.serverKey,
    legionName: '', className: '', level: 0, faction: '', avatarUrl: '', lastSeenAt: 0,
    avatarColor: avatarColorFor(target.characterId || target.targetName),
  }
}

export function useUnreadCharacters(targets: UnreadTarget[], knownCharacters: GameCharacter[]) {
  const cache = useRef(new Map<string, GameCharacter | null>())
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const targetJson = JSON.stringify([...new Map(targets.map((target) => [unreadTargetKey(target), target])).values()])
  const knownById = useMemo(() => new Map(knownCharacters.map(character => [
    JSON.stringify([character.serverKey, character.characterId]), character,
  ])), [knownCharacters])
  // Only a fully scoped ID is conclusive from a partial directory page.
  // A name lookup still needs the API to rule out off-page ambiguities.
  const pendingJson = JSON.stringify((JSON.parse(targetJson) as UnreadTarget[])
    .filter(target => !(target.serverKey && target.characterId && knownById.has(JSON.stringify([target.serverKey, target.characterId]))))
    .sort((left, right) => unreadTargetKey(left).localeCompare(unreadTargetKey(right))))

  useEffect(() => {
    const controller = new AbortController()
    const pending = (JSON.parse(pendingJson) as UnreadTarget[]).filter((target) => !cache.current.has(unreadTargetKey(target)))
    setLoading(pending.length > 0)
    setError('')
    let next = 0
    let failed = false
    async function resolveTargets() {
      while (next < pending.length && !controller.signal.aborted) {
        const target = pending[next++]
        try {
          const params = new URLSearchParams({ limit: '2', includeTotal: '0' })
          if (target.serverKey) params.set('serverId', target.serverKey)
          params.set(target.characterId ? 'characterId' : 'characterName', target.characterId || target.targetName)
          const response = await fetch(`/api/characters?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
          if (!response.ok) throw new Error(`未读角色加载失败 (${response.status})`)
          const result = await response.json() as CharacterResponse
          if (!result.ok || !Array.isArray(result.characters)) throw new Error('未读角色加载失败')
          // Ambiguous names must not select a character from an arbitrary server.
          const character = result.characters.length === 1 ? toGameCharacter(result.characters[0]) : null
          if (character && !targetMatchesCharacter(target, character)) throw new Error('未读角色响应与查询目标不匹配')
          if (!controller.signal.aborted) cache.current.set(unreadTargetKey(target), character)
        } catch (cause) {
          if (controller.signal.aborted) return
          failed = true
          setError(cause instanceof Error ? cause.message : '未读角色加载失败')
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, resolveTargets)).then(() => {
      if (controller.signal.aborted) return
      setRevision((value) => value + 1)
      setLoading(false)
      if (!failed) setError('')
    })
    return () => controller.abort()
  }, [pendingJson, retry])

  const characters = useMemo(() => {
    const result = new Map<string, GameCharacter>()
    for (const target of JSON.parse(targetJson) as UnreadTarget[]) {
      const known = target.serverKey && target.characterId ? knownById.get(JSON.stringify([target.serverKey, target.characterId])) : undefined
      const character = known || cache.current.get(unreadTargetKey(target)) || fallbackUnreadCharacter(target)
      result.set(character.id, character)
    }
    return [...result.values()]
  }, [targetJson, knownById, revision])

  return { characters, loading, error, retry: () => {
    for (const [key, character] of cache.current) if (!character) cache.current.delete(key)
    setRetry((value) => value + 1)
  } }
}
