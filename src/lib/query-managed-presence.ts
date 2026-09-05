import type { GameCharacter } from './game-characters'
import type { PresenceEnvelope, PresenceResult, QueryPresence } from './presence-mqtt'

/** Save once per batch, even if the provider streams individual results. */
export async function queryManagedPresence(characters: GameCharacter[], query: QueryPresence, signal: AbortSignal): Promise<PresenceResult[]> {
  const results = new Map<string, PresenceResult>()
  let requestId = '', failure: unknown
  try {
    await query(characters.map(character => ({ serverId: character.serverKey, characterId: character.characterId, name: character.name })), envelope => {
      if (signal.aborted) return
      requestId = envelope.requestId
      for (const result of envelope.results) results.set(JSON.stringify([result.serverId, result.characterId]), result)
      // Query results are already authoritative for the UI. Do not wait for the
      // remaining roles (up to 180s) or the batch's database write to finish.
      window.dispatchEvent(new CustomEvent('aion:presence-results', { detail: envelope.results }))
    }, signal)
  } catch (error) { failure = error }
  signal.throwIfAborted()
  const values = [...results.values()]
  if (values.length) {
    const envelope: PresenceEnvelope = { type: 'presence_result', requestId, results: values }
    const response = await fetch('/api/presence/results', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
    const result = await response.json() as { ok?: boolean; error?: string }
    if (!response.ok || !result.ok) throw new Error(result.error || '在线查询结果保存失败')
    signal.throwIfAborted()
  }
  // Preserve confirmed partial results after a timeout; unknown roles stay excluded.
  if (failure && !values.some(result => result.status !== 'unknown')) throw failure
  if (!values.length) throw new Error('在线查询未返回结果')
  return values
}
