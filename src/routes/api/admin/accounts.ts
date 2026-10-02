import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { registerAdminUser } from '#/server/admin-users.server'
import { jsonError } from '#/server/api-auth.server'

const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), username: z.string(), password: z.string() }),
  z.object({ action: z.literal('status'), userId: z.number().int().positive(), status: z.enum(['active', 'disabled']) }),
])
export const Route = createFileRoute('/api/admin/accounts')({ server: { handlers: {
  GET: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    if (!principal) return jsonError('未登录', 401)
    if (principal.role !== 'admin') return jsonError('仅管理员可管理账号', 403)
    const users = await env.DB.prepare("SELECT id, username, display_name, status FROM admin_users WHERE role = 'agent' ORDER BY id").all()
    return Response.json({ ok: true, users: users.results }, { headers: { 'Cache-Control': 'no-store' } })
  },
  POST: async ({ request }) => {
    const principal = await currentAdminPrincipal(request)
    if (!principal) return jsonError('未登录', 401)
    if (principal.role !== 'admin') return jsonError('仅管理员可管理账号', 403)
    if (request.headers.get('origin') !== new URL(request.url).origin) return jsonError('请求来源无效', 403)
    if (Number(request.headers.get('content-length')) > 8192) return jsonError('请求体过大', 413)
    const body = await request.text()
    if (body.length > 8192) return jsonError('请求体过大', 413)
    let input: unknown
    try { input = JSON.parse(body) } catch { return jsonError('请求格式无效', 400) }
    const parsed = mutation.safeParse(input)
    if (!parsed.success) return jsonError('参数无效', 400)
    const data = parsed.data
    if (data.action === 'create') {
      const result = await registerAdminUser(data.username, data.password)
      return result.ok ? Response.json({ ok: true }) : jsonError(result.error, 400)
    }
    if (data.action === 'status') {
      const result = await env.DB.prepare("UPDATE admin_users SET status = ?, updated_at = ? WHERE id = ? AND role = 'agent'")
        .bind(data.status, Date.now(), data.userId).run()
      return result.meta.changes ? Response.json({ ok: true }) : jsonError('客服不存在', 404)
    }
    return jsonError('参数无效', 400)
  },
} } })
