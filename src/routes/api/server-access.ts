import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { canAccessServer } from '#/server/server-access.server'
import { jsonError } from '#/server/api-auth.server'

export const Route = createFileRoute('/api/server-access')({
  server: { handlers: { GET: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    if (!principal) return jsonError('未登录', 401)
    const serverId = new URL(request.url).searchParams.get('serverId') || ''
    if (!serverId) return jsonError('缺少区服', 400)
    if (!await canAccessServer(principal, serverId)) return jsonError('没有该区服的操作权限', 403)
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } } },
})
