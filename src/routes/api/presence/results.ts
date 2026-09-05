import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { storeMqttPresenceResults, PresenceRequestError } from '#/server/presence.server'
import { presenceEnvelopeSchema } from '#/lib/presence-mqtt'

export const Route = createFileRoute('/api/presence/results')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        let body: unknown
        try { body = await request.json() } catch { return jsonError('请求体必须是合法 JSON', 400) }
        const parsed = presenceEnvelopeSchema.safeParse(body)
        if (!parsed.success) return jsonError('结果格式错误：每批 1-50 条，必须包含角色、查询时间和 status', 400)
        try {
          const saved = await storeMqttPresenceResults(parsed.data, principal)
          return Response.json({ ok: true, saved })
        } catch (cause) {
          return jsonError(cause instanceof Error ? cause.message : '保存在线状态失败', cause instanceof PresenceRequestError ? cause.status : 500)
        }
      },
    },
  },
})
