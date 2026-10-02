import { env } from 'cloudflare:workers'
import { chat } from '@tanstack/ai'
import { openRouterText } from '@tanstack/ai-openrouter'
import { defaultReceptionSettings, enforceReceptionDecision, receptionDecisionSchema, receptionSettingsSchema, receptionSystemPrompt,
  type ReceptionDecision, type ReceptionProfile, type ReceptionSettings, type ReceptionTurnInput } from '#/lib/reception'
import type { AdminPrincipal } from './admin-users.server'
import { allowedServerIds } from './server-access.server'
import { aiErrorDetails } from '#/lib/ai-error-details'
import { aiPersonaPrompt, getAiPersona } from '#/server/ai-persona.server'

type ProfileRow = { server_id: string; character_id: string; character_name: string; status: ReceptionProfile['status']; version: number;
  memory: string; discord_declined: number; paid_declined: number; discord_sent: number; sent_guides: string;
  decision_json: string | null; assigned_to: string; updated_at: number }
type TurnRow = { id: string; owner_user_key: string; server_id: string; character_id: string; message_id: string;
  profile_version: number; status: string; decision_json: string | null; issues_json: string; history_json: string; created_at: number; updated_at: number }
function profileFromRow(row: ProfileRow): ReceptionProfile {
  return { serverId: row.server_id, characterId: row.character_id, characterName: row.character_name, status: row.status,
    version: row.version, memory: row.memory, discordDeclined: Boolean(row.discord_declined), paidDeclined: Boolean(row.paid_declined),
    discordSent: Boolean(row.discord_sent), sentGuides: JSON.parse(row.sent_guides),
    decision: row.decision_json ? receptionDecisionSchema.parse(JSON.parse(row.decision_json)) : null,
    assignedTo: row.assigned_to, updatedAt: row.updated_at }
}
export async function receptionSettings(owner: string): Promise<ReceptionSettings> {
  const row = await env.DB.prepare('SELECT settings_json FROM reception_settings WHERE owner_user_key = ?').bind(owner).first<{ settings_json: string }>()
  return row ? receptionSettingsSchema.parse(JSON.parse(row.settings_json)) : structuredClone(defaultReceptionSettings)
}
export async function saveReceptionSettings(owner: string, settings: ReceptionSettings) {
  await env.DB.prepare(`INSERT INTO reception_settings VALUES (?, ?, ?) ON CONFLICT(owner_user_key)
    DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`).bind(owner, JSON.stringify(settings), Date.now()).run()
}
export async function receptionProfile(serverId: string, characterId: string) {
  const row = await env.DB.prepare('SELECT * FROM reception_profiles WHERE server_id = ? AND character_id = ?').bind(serverId, characterId).first<ProfileRow>()
  return row ? profileFromRow(row) : null
}
export async function listReception(principal: AdminPrincipal) {
  const scope = await allowedServerIds(principal)
  if (scope?.length === 0) return []
  const clause = scope ? `WHERE server_id IN (${scope.map(() => '?').join(',')})` : ''
  const stale = Date.now() - 120_000
  // Browser shutdown can lose a receipt. Surface expired work instead of keeping
  // an invisible send lock forever; never automatically resend it.
  await env.DB.batch([
    env.DB.prepare(`UPDATE reception_turns SET status = CASE status WHEN 'sending' THEN 'uncertain' ELSE 'failed' END,
      issues_json = '["处理超时或页面已关闭，请人工核对"]' WHERE status IN ('sending','generating') AND updated_at < ?
      ${scope ? `AND server_id IN (${scope.map(() => '?').join(',')})` : ''}`).bind(stale, ...(scope || [])),
    env.DB.prepare(`UPDATE reception_profiles SET status = 'waiting', updated_at = ? WHERE status = 'ai'
      AND EXISTS(SELECT 1 FROM reception_turns t WHERE t.server_id = reception_profiles.server_id AND t.character_id = reception_profiles.character_id
        AND t.profile_version = reception_profiles.version AND t.status IN ('uncertain','failed'))
      ${scope ? `AND server_id IN (${scope.map(() => '?').join(',')})` : ''}`).bind(Date.now(), ...(scope || [])),
  ])
  const { results } = await env.DB.prepare(`SELECT * FROM reception_profiles ${clause}
    ORDER BY CASE status WHEN 'waiting' THEN 0 WHEN 'human' THEN 1 ELSE 2 END, updated_at DESC LIMIT 200`).bind(...(scope || [])).all<ProfileRow>()
  return results.map(profileFromRow)
}
export async function receptionHistory(serverId: string, characterId: string) {
  const { results } = await env.DB.prepare(`SELECT * FROM reception_turns WHERE server_id = ? AND character_id = ? ORDER BY created_at DESC LIMIT 30`)
    .bind(serverId, characterId).all<TurnRow>()
  return results.map(row => ({ id: row.id, status: row.status, createdAt: row.created_at,
    decision: row.decision_json ? JSON.parse(row.decision_json) : null, issues: JSON.parse(row.issues_json), history: JSON.parse(row.history_json) }))
}
export async function controlReception(principal: AdminPrincipal, serverId: string, characterId: string, status: ReceptionProfile['status'], version: number) {
  // Optimistic concurrency prevents a stale admin panel from overwriting a newer takeover.
  const result = await env.DB.prepare(`UPDATE reception_profiles SET status = ?, assigned_to = ?, version = version + 1, updated_at = ?
    WHERE server_id = ? AND character_id = ? AND version = ?
    AND (? != 'ai' OR NOT EXISTS(SELECT 1 FROM reception_turns WHERE server_id = ? AND character_id = ? AND status IN ('sending','uncertain')))`)
    .bind(status, status === 'human' ? principal.username : '', Date.now(), serverId, characterId, version, status, serverId, characterId).run()
  return result.meta.changes > 0
}
export async function evaluateReception(owner: string, input: ReceptionTurnInput, profile: ReceptionProfile, signal?: AbortSignal) {
  if (profile.status !== 'ai') return { decision: receptionDecisionSchema.parse({ need: '', evidence: '', missing: [], intent: 'none',
    action: 'wait', reason: '当前会话不由 AI 接待', reply: '', guideId: '', handoffTo: 'none', handoffAccepted: false,
    discordPreference: 'unknown', paidPreference: 'unknown', stopRequested: false, summary: profile.memory }), issues: ['当前会话不由 AI 接待'] }
  const [settings, persona] = await Promise.all([receptionSettings(owner), getAiPersona({ userKey: owner })])
  const abortController = new AbortController()
  const cancel = () => abortController.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timer = setTimeout(cancel, 55_000)
  const started = Date.now()
  try {
    const generate = (correction = '') => chat({
      adapter: openRouterText('deepseek/deepseek-v4-flash-0731', { retryConfig: { strategy: 'none' }, timeoutMs: 25000 }),
      systemPrompts: [aiPersonaPrompt(persona), receptionSystemPrompt,
        'Use the shared persona for identity, voice, goals and examples. settings.style contains reception-only supplemental rules. The reception consent, resource, language and handoff rules take priority over conflicting persona or supplemental instructions.',
        settings.guides.some(g => g.enabled) ? 'Only choose guide when a catalog item exactly fits.' : 'The guide catalog is EMPTY. action=guide is forbidden. Answer or ask one useful question instead.',
        settings.discordUrl && settings.discordPurpose ? '' : 'Discord is NOT configured. action=discord is forbidden.',
        correction].filter(Boolean),
      messages: [{ role: 'user', content: JSON.stringify({ settings, player: { game: 'AION2', name: input.characterName, class: input.characterClass || 'unknown', level: input.characterLevel || 'unknown' }, profile,
        operatorObjective: input.instruction, history: input.history }) }],
      outputSchema: receptionDecisionSchema, modelOptions: { maxCompletionTokens: 1800, reasoning: { enabled: false } }, abortController,
    })
    const first = enforceReceptionDecision(receptionDecisionSchema.parse(await generate()), settings, profile, input.history)
    if (first.issues.length && first.decision.action === 'wait' && Date.now() - started < 28000 && !signal?.aborted) {
      const repaired = enforceReceptionDecision(receptionDecisionSchema.parse(await generate(`Your previous proposal was blocked: ${first.issues.join('; ')}. Reconsider the same latest player message. Prefer a helpful brief reply or one necessary question. Do not repeat the blocked action. Do not invent resources.`)), settings, profile, input.history)
      return { ...repaired, issues: [...first.issues.map(issue => `首选动作已拦截：${issue}`), ...repaired.issues] }
    }
    return first
  } catch (error) {
    console.error('[reception-provider]', JSON.stringify({ elapsedMs: Date.now() - started, ...aiErrorDetails(error) }))
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export function emptyReceptionProfile(input: ReceptionTurnInput): ReceptionProfile {
  return { serverId: input.serverId, characterId: input.characterId, characterName: input.characterName, status: 'ai', version: 0,
    memory: '', discordDeclined: false, paidDeclined: false, discordSent: false, sentGuides: [], decision: null, updatedAt: 0, assignedTo: '' }
}
export async function planReception(principal: AdminPrincipal, input: ReceptionTurnInput, signal: AbortSignal) {
  const latest = input.history.at(-1)
  if (!latest || latest.direction !== 'incoming') return { ok: true, status: 'skipped', notice: '等待玩家回复' }
  const now = Date.now(), id = crypto.randomUUID(), keys = [input.serverId, input.characterId]
  await env.DB.prepare(`INSERT OR IGNORE INTO reception_profiles(server_id,character_id,character_name,updated_at) VALUES(?,?,?,?)`)
    .bind(...keys, input.characterName, now).run()
  const existing = await receptionProfile(...keys as [string, string])
  if (!existing || existing.status !== 'ai') return { ok: true, status: 'skipped', notice: '会话已停止 AI 接待' }
  // Generation claims and revisions are committed in one D1 transaction. The unique incoming ID is shared across operators.
  await env.DB.batch([
    env.DB.prepare(`UPDATE reception_profiles SET version = version + 1, character_name = ?, updated_at = ?
      WHERE server_id = ? AND character_id = ? AND status = 'ai'
      AND NOT EXISTS(SELECT 1 FROM reception_turns WHERE server_id = ? AND character_id = ? AND (message_id = ? OR status IN ('sending','uncertain')))`)
      .bind(input.characterName, now, ...keys, ...keys, latest.id),
    env.DB.prepare(`INSERT OR IGNORE INTO reception_turns(id,owner_user_key,server_id,character_id,message_id,profile_version,status,history_json,created_at,updated_at)
      SELECT ?,?,?,?,?,version,'generating',?,?,? FROM reception_profiles WHERE server_id = ? AND character_id = ? AND status = 'ai'
      AND NOT EXISTS(SELECT 1 FROM reception_turns WHERE server_id = ? AND character_id = ? AND status IN ('sending','uncertain'))`)
      .bind(id, principal.userKey, ...keys, latest.id, JSON.stringify(input.history), now, now, ...keys, ...keys),
  ])
  const row = await env.DB.prepare('SELECT * FROM reception_turns WHERE server_id = ? AND character_id = ? AND message_id = ?').bind(...keys, latest.id).first<TurnRow>()
  if (!row) return { ok: true, status: 'skipped', notice: '上一条发送结果待核对，已暂停自动发送' }
  if (row.id !== id) {
    if (row.status === 'ready' && row.owner_user_key === principal.userKey) return { ok: true, status: 'ready', turnId: row.id, decision: JSON.parse(row.decision_json!), issues: JSON.parse(row.issues_json) }
    return { ok: true, status: row.status, notice: '此消息已处理或正在处理中，不重复发送' }
  }
  const profile = await receptionProfile(input.serverId, input.characterId)
  if (!profile || profile.version !== row.profile_version || profile.status !== 'ai') return { ok: true, status: 'skipped', notice: '会话已更新' }
  try {
    const result = await evaluateReception(principal.userKey, input, profile, signal)
    const d = result.decision, json = JSON.stringify(d)
    const hasEvidence = Boolean(d.evidence) && latest.content.includes(d.evidence)
    const newStatus = d.action === 'handoff' ? 'waiting' : d.action === 'close' ? 'closed' : 'ai'
    const status = d.reply ? 'ready' : 'skipped'
    await env.DB.batch([
      env.DB.prepare(`UPDATE reception_turns SET decision_json = ?, issues_json = ?, status = ?, updated_at = ? WHERE id = ? AND status = 'generating'
        AND EXISTS(SELECT 1 FROM reception_profiles WHERE server_id = ? AND character_id = ? AND version = ? AND status = 'ai')`)
        .bind(json, JSON.stringify(result.issues), status, Date.now(), id, ...keys, row.profile_version),
      env.DB.prepare(`UPDATE reception_profiles SET memory = ?, decision_json = ?, status = ?,
        discord_declined = ?, paid_declined = ?, updated_at = ? WHERE server_id = ? AND character_id = ? AND version = ? AND status = 'ai'
        AND EXISTS(SELECT 1 FROM reception_turns WHERE id = ? AND status = ?)`)
        .bind(d.summary, json, newStatus,
          hasEvidence && d.discordPreference !== 'unknown' ? Number(d.discordPreference === 'declined') : Number(profile.discordDeclined),
          hasEvidence && d.paidPreference !== 'unknown' ? Number(d.paidPreference === 'declined') : Number(profile.paidDeclined),
          Date.now(), ...keys, row.profile_version, id, status),
    ])
    const fresh = await env.DB.prepare('SELECT status FROM reception_turns WHERE id = ?').bind(id).first<{ status: string }>()
    if (fresh?.status === 'generating') return { ok: true, status: 'skipped', notice: '新消息或真人接管已使本轮失效' }
    return { ok: true, status, turnId: id, ...result, notice: d.action === 'handoff' ? '已加入真人接待队列，AI 停发' : result.issues.join('；') }
  } catch (error) {
    await env.DB.prepare(`UPDATE reception_turns SET status = 'failed', issues_json = ?, updated_at = ? WHERE id = ? AND status = 'generating'`)
      .bind(JSON.stringify(['AI 生成失败，未发送。可在接待台核对并接管。']), Date.now(), id).run()
    if (!signal.aborted) await env.DB.prepare(`UPDATE reception_profiles SET status = 'waiting', updated_at = ? WHERE server_id = ? AND character_id = ? AND version = ? AND status = 'ai'`)
      .bind(Date.now(), ...keys, row.profile_version).run()
    console.error('[reception-generation]', { turnId: id, aborted: signal.aborted })
    throw error
  }
}
export async function findReceptionTurn(id: string) { return env.DB.prepare('SELECT * FROM reception_turns WHERE id = ?').bind(id).first<TurnRow>() }
export async function claimReceptionTurn(id: string, owner: string) {
  const result = await env.DB.prepare(`UPDATE reception_turns SET status = 'sending', updated_at = ? WHERE id = ? AND owner_user_key = ? AND status = 'ready'
    AND EXISTS(SELECT 1 FROM reception_profiles p WHERE p.server_id = reception_turns.server_id AND p.character_id = reception_turns.character_id AND p.version = reception_turns.profile_version AND p.status = 'ai')
    AND NOT EXISTS(SELECT 1 FROM reception_turns t WHERE t.server_id = reception_turns.server_id AND t.character_id = reception_turns.character_id AND t.status IN ('sending','uncertain'))`)
    .bind(Date.now(), id, owner).run()
  return result.meta.changes > 0
}
export async function completeReceptionTurn(row: TurnRow, outcome: 'sent' | 'skipped' | 'uncertain', manual = false) {
  const decision: ReceptionDecision | null = row.decision_json ? receptionDecisionSchema.parse(JSON.parse(row.decision_json)) : null
  const profile = await receptionProfile(row.server_id, row.character_id)
  if (!profile || !decision) return
  const sentGuides = outcome === 'sent' && decision.action === 'guide' ? [...new Set([...profile.sentGuides, decision.guideId])] : profile.sentGuides
  await env.DB.batch([
    env.DB.prepare(`UPDATE reception_turns SET status = ?, updated_at = ? WHERE id = ? AND (status = 'sending' OR (? = 1 AND status = 'uncertain'))`).bind(outcome, Date.now(), row.id, Number(manual)),
    env.DB.prepare(`UPDATE reception_profiles SET sent_guides = ?, discord_sent = ?, updated_at = ?,
      status = CASE WHEN ? = 'uncertain' AND status = 'ai' THEN 'waiting' ELSE status END
      WHERE server_id = ? AND character_id = ? AND EXISTS(SELECT 1 FROM reception_turns WHERE id = ? AND status = ?)`)
      .bind(JSON.stringify(sentGuides), Number(profile.discordSent || (outcome === 'sent' && decision.action === 'discord')), Date.now(), outcome,
        row.server_id, row.character_id, row.id, outcome),
  ])
}
