import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { advanceReceptionMemory, receptionSettingsSchema, receptionTurnSchema, simulationMemorySchema } from '#/lib/reception'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { canAccessServer } from '#/server/server-access.server'
import { claimReceptionTurn, completeReceptionTurn, controlReception, emptyReceptionProfile, evaluateReception, findReceptionTurn,
  listReception, planReception, receptionHistory, receptionSettings, saveReceptionSettings } from '#/server/reception.server'

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings'), settings: receptionSettingsSchema }),
  z.object({ action: z.literal('preview'), input: receptionTurnSchema, simulation: simulationMemorySchema.optional() }),
  z.object({ action: z.literal('plan'), input: receptionTurnSchema }),
  z.object({ action: z.literal('claim'), turnId: z.string().uuid() }),
  z.object({ action: z.literal('receipt'), turnId: z.string().uuid(), outcome: z.enum(['sent','skipped','uncertain']) }),
  z.object({ action: z.literal('resolve'), turnId: z.string().uuid(), outcome: z.enum(['sent','skipped']) }),
  z.object({ action: z.literal('control'), serverId: z.string().min(1).max(80), characterId: z.string().min(1).max(160),
    status: z.enum(['ai','human','closed']), version: z.number().int().nonnegative() }),
])
const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } })
export const Route = createFileRoute('/api/ai/reception')({ server: { handlers: {
  GET: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    if (!principal) return jsonError('未登录', 401)
    const url = new URL(request.url), serverId = url.searchParams.get('serverId'), characterId = url.searchParams.get('characterId')
    if (serverId && characterId) {
      if (!await canAccessServer(principal, serverId)) return jsonError('没有该区服权限', 403)
      return json({ ok: true, turns: await receptionHistory(serverId, characterId) })
    }
    return json({ ok: true, settings: await receptionSettings(principal.userKey), profiles: await listReception(principal) })
  },
  POST: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    if (!principal) return jsonError('未登录', 401)
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return jsonError('请求来源不匹配', 403)
    const reader = request.body?.getReader()
    if (!reader) return jsonError('缺少请求内容', 400)
    const chunks: Uint8Array[] = []; let bytes = 0
    try {
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength
        if (bytes > 128 * 1024) { await reader.cancel(); return jsonError('请求体过大', 413) }; chunks.push(part.value) }
    } finally { reader.releaseLock() }
    const buffer = new Uint8Array(bytes); let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    let raw: unknown
    try { raw = JSON.parse(new TextDecoder().decode(buffer)) } catch { return jsonError('请求格式无效', 400) }
    const parsed = inputSchema.safeParse(raw)
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || '参数无效', 400)
    const data = parsed.data
    if (data.action === 'settings') { await saveReceptionSettings(principal.userKey, data.settings); return json({ ok: true }) }
    if (data.action === 'preview') {
      try {
        const profile = { ...emptyReceptionProfile(data.input), ...data.simulation }
        const result = await evaluateReception(principal.userKey, data.input, profile, request.signal)
        return json({ ok: true, ...result, simulation: advanceReceptionMemory(profile, result.decision, Boolean(result.decision.reply), data.input.history.at(-1)?.content || '') })
      }
      catch { return jsonError('AI 预演失败，未发送任何消息。请稍后重试。', 502) }
    }
    if (data.action === 'plan') {
      if (!await canAccessServer(principal, data.input.serverId)) return jsonError('没有该区服权限', 403)
      try { return json(await planReception(principal, data.input, request.signal)) }
      catch { return jsonError('AI 接待生成失败，未发送消息。请在接待台核对。', 502) }
    }
    if (data.action === 'control') {
      if (!await canAccessServer(principal, data.serverId)) return jsonError('没有该区服权限', 403)
      if (!await controlReception(principal, data.serverId, data.characterId, data.status, data.version)) return jsonError('会话已变化或有未核对的发送。请刷新并先核对发送记录。', 409)
      return json({ ok: true })
    }
    const turn = await findReceptionTurn(data.turnId)
    if (!turn || !await canAccessServer(principal, turn.server_id)) return jsonError('无权访问此轮对话', 403)
    if (data.action === 'resolve') {
      if (turn.status !== 'uncertain') return jsonError('仅可核对结果未确认的发送，请刷新', 409)
      await completeReceptionTurn(turn, data.outcome, true)
      return json({ ok: true })
    }
    if (turn.owner_user_key !== principal.userKey) return jsonError('无权访问此轮对话', 403)
    if (data.action === 'claim') return json({ ok: true, claimed: await claimReceptionTurn(turn.id, principal.userKey) })
    await completeReceptionTurn(turn, data.outcome)
    return json({ ok: true })
  },
} } })
