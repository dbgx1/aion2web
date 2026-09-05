import { createFileRoute } from '@tanstack/react-router'
import {
  createAdminSession,
  currentAdminPrincipal,
  sessionCookie,
  verifyAdminCredentials,
} from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'

export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        return Response.json({ ok: true, authenticated: true, user: principal }, {
          headers: { 'Cache-Control': 'no-store' },
        })
      },
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return jsonError('请求体必须是合法 JSON', 400)
        }
        const username = typeof body === 'object' && body !== null && 'username' in body
          && typeof body.username === 'string' ? body.username : ''
        const password = typeof body === 'object' && body !== null && 'password' in body
          && typeof body.password === 'string' ? body.password : ''
        const principal = await verifyAdminCredentials(username, password)
        if (!principal) return jsonError('账号或密码错误', 401)
        const session = await createAdminSession(principal)
        return Response.json({ ok: true, authenticated: true, user: principal }, {
          headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': sessionCookie(request, session),
          },
        })
      },
      DELETE: async ({ request }) => Response.json({ ok: true }, {
        headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': sessionCookie(request, '', 0),
        },
      }),
    },
  },
})
