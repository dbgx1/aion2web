import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { createPresenceRequest, finishPresenceRequest, PresenceRequestError } from '#/server/presence.server'
import { presenceCharacterSchema, PRESENCE_BATCH_SIZE } from '#/lib/presence-mqtt'

const inputSchema = z.object({ characters: z.array(presenceCharacterSchema).min(1).max(PRESENCE_BATCH_SIZE) })
export const Route = createFileRoute('/api/presence/requests')({
  server: { handlers: {
    POST: async ({ request }) => {
      const principal = await currentAdminPrincipal(request)
      if (!principal) return jsonError('未登录', 401)
      const parsed = inputSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return jsonError('每批需要 1-50 个有效角色', 400)
      try {
        return Response.json({ ok: true, query: await createPresenceRequest(parsed.data.characters, principal) })
      } catch (cause) {
        return jsonError(cause instanceof Error ? cause.message : '登记查询失败', cause instanceof PresenceRequestError ? cause.status : 500)
      }
    },
    DELETE: async ({ request }) => {
      const principal = await currentAdminPrincipal(request)
      if (!principal) return jsonError('未登录', 401)
      const parsed = z.object({ requestId: z.string().uuid() }).safeParse(await request.json().catch(() => null))
      if (!parsed.success) return jsonError('请求编号无效', 400)
      await finishPresenceRequest(parsed.data.requestId, principal)
      return Response.json({ ok: true })
    },
  } },
})
