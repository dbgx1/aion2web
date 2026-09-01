import { createFileRoute } from '@tanstack/react-router'
import {
  createAdminSession,
  isAdminRequest,
  sessionCookie,
  verifyAdminToken,
} from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'

export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!await isAdminRequest(request)) return jsonError('未登录', 401)
        return Response.json({ ok: true, authenticated: true }, {
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
        const token = typeof body === 'object' && body !== null && 'token' in body
          && typeof body.token === 'string' ? body.token : ''
        if (!await verifyAdminToken(token)) return jsonError('登录令牌无效', 401)
        const session = await createAdminSession()
        return Response.json({ ok: true, authenticated: true }, {
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
