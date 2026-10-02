import type { ManagedTurn } from './managed-chat'
import type { ReceptionDecision, ReceptionLine } from './reception'

export async function receptionRequest<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/ai/reception', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000) })
  const result = await response.json() as T & { ok?: boolean; error?: string }
  if (!response.ok || !result.ok) throw new Error(result.error || 'AI 接待请求失败')
  return result
}
export async function runReceptionTurn(turn: ManagedTurn, history: ReceptionLine[], notice: (value: string) => void) {
  if (turn.reason !== 'reply') return
  const lines = [...new Map([...history, ...turn.history].map(line => [line.id, line])).values()].slice(-30)
  const result = await receptionRequest<{ status: string; turnId?: string; decision?: ReceptionDecision; notice?: string }>({ action: 'plan', input: {
    serverId: turn.recipient.serverKey, characterId: turn.recipient.characterId, characterName: turn.recipient.name,
    characterClass: turn.recipient.className || '', characterLevel: turn.recipient.level || 0,
    instruction: turn.config.instruction, history: lines,
  } }, turn.signal)
  turn.signal.throwIfAborted()
  if (result.notice) notice(result.notice)
  if (result.status !== 'ready' || !result.turnId || !result.decision?.reply) return
  const claim = await receptionRequest<{ claimed: boolean }>({ action: 'claim', turnId: result.turnId }, turn.signal)
  if (!claim.claimed) { notice('本轮已失效或已由其他接待员处理'); return }
  let outcome: 'sent' | 'skipped' | 'uncertain' = 'skipped'
  try {
    turn.signal.throwIfAborted()
    outcome = 'uncertain'
    outcome = await turn.send(result.decision.reply) ? 'sent' : 'skipped'
  } finally {
    // A transport attempt must be recorded even when the running turn is cancelled.
    await receptionRequest({ action: 'receipt', turnId: result.turnId, outcome })
    if (outcome === 'uncertain') notice('发送结果未确认，已转人工核对，避免重复发送')
  }
}
