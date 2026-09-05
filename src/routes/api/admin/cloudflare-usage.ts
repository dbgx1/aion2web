import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { getCloudflareUsage } from '#/server/cloudflare-usage.server'

export const Route = createFileRoute('/api/admin/cloudflare-usage')({
  server: { handlers: { GET: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    const headers = { 'Cache-Control': 'no-store' }
    if (!principal) return Response.json({ error: '未登录' }, { status: 401, headers })
    if (principal.role !== 'admin') return Response.json({ error: '仅管理员可查看费用统计' }, { status: 403, headers })
    return Response.json(await getCloudflareUsage(), { headers })
  } } },
})
