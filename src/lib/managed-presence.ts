import type { GameCharacter } from './game-characters'
import type { PresenceResult } from './presence-mqtt'

export const MANAGED_PRESENCE_FRESH_MS = 180_000
const keyOf = (character: GameCharacter) => JSON.stringify([character.serverKey, character.characterId])

/** Bounded, serial discovery over the fixed filter; no timer per recipient. */
export class ManagedPresence {
  private cache = new Map<string, { result?: PresenceResult; queriedAt: number }>()
  private cursor = 0
  private byKey: Map<string, GameCharacter>
  constructor(private characters: GameCharacter[]) { this.byKey = new Map(characters.map(character => [keyOf(character), character])) }
  result(key: string, now: number) {
    const cached = this.cache.get(key)
    return cached && now - cached.queriedAt < MANAGED_PRESENCE_FRESH_MS ? cached.result : undefined
  }
  online(key: string, now: number) {
    const result = this.cache.get(key)?.result
    return result?.status === 'online' && now - result.checkedAt <= MANAGED_PRESENCE_FRESH_MS
  }
  get queried() { return this.cache.size }
  count(now: number) { return [...this.cache.keys()].filter(key => this.online(key, now)).length }
  record(characters: GameCharacter[], results: PresenceResult[], now: number) {
    const allowed = new Map(characters.map(character => [keyOf(character), character]))
    for (const key of allowed.keys()) this.cache.set(key, { queriedAt: now })
    for (const result of results) {
      const key = JSON.stringify([result.serverId, result.characterId])
      if (allowed.has(key)) this.cache.set(key, { queriedAt: Math.min(now, result.checkedAt), result })
    }
  }
  batch(now: number, pending: string[]) {
    const selected = new Map<string, GameCharacter>()
    const add = (key: string) => {
      const character = this.byKey.get(key), cached = this.cache.get(key)
      if (character && selected.size < 50 && (!cached || now - cached.queriedAt >= MANAGED_PRESENCE_FRESH_MS)) selected.set(key, character)
    }
    // Confirm new replies and formerly online roles before scanning the next page.
    pending.forEach(add)
    for (const [key, cached] of this.cache) if (cached.result?.status === 'online') add(key)
    for (let i = 0; i < this.characters.length && selected.size < 50; i++) {
      add(keyOf(this.characters[this.cursor++ % this.characters.length]))
    }
    return [...selected.values()]
  }
}
