import { canAccessServers } from '#/server/server-access.server'
import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { listPresenceStatus } from '#/server/presence.server'

export const Route = createFileRoute('/api/presence/status')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return jsonError('请求体必须是合法 JSON', 400)
        }
        const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
        if (!Array.isArray(record.characters)) return jsonError('characters 必须是数组', 400)
        if (record.characters.length > 500) return jsonError('每次最多查询 500 个角色在线状态', 400)
        if (!await canAccessServers(principal, record.characters.map((item: any) => String(item?.serverId || '')))) return jsonError('无权访问该区服', 403)
        const maxAgeMs = typeof record.maxAgeMs === 'number' ? record.maxAgeMs : undefined
        try {
          const statuses = await listPresenceStatus(record.characters as Array<{ serverId: string; characterId: string }>, maxAgeMs)
          return Response.json({ ok: true, statuses })
        } catch (cause) {
          if (cause instanceof Error && cause.message.includes('no such table')) {
            return Response.json({ ok: true, statuses: [] })
          }
          return jsonError(cause instanceof Error ? cause.message : '读取在线状态失败', 500)
        }
      },
    },
  },
})
