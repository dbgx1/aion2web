import { createFileRoute } from '@tanstack/react-router'
import { registerAdminUser } from '#/server/admin-users.server'
import { createAdminSession, sessionCookie } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'

export const Route = createFileRoute('/api/auth/register')({
  server: {
    handlers: {
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

        const result = await registerAdminUser(username, password)
        if (!result.ok) return jsonError(result.error, 400)

        const session = await createAdminSession(result.principal)
        return Response.json({ ok: true, authenticated: true, user: result.principal }, {
          headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': sessionCookie(request, session),
          },
        })
      },
    },
  },
})
