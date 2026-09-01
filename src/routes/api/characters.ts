import { createFileRoute } from '@tanstack/react-router'
import { isAdminRequest } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { listCharacters, listDirectory } from '#/server/characters.server'

export const Route = createFileRoute('/api/characters')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!await isAdminRequest(request)) return jsonError('未登录', 401)
        const url = new URL(request.url)
        if (url.searchParams.get('directory') === '1') {
          return Response.json({ ok: true, servers: await listDirectory() })
        }

        const cursor = Math.max(0, Number.parseInt(url.searchParams.get('cursor') || '0', 10) || 0)
        const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50))
        const result = await listCharacters({
          serverId: (url.searchParams.get('serverId') || '').trim().slice(0, 100),
          legionName: (url.searchParams.get('legionName') || '').trim().slice(0, 100),
          withoutLegion: url.searchParams.get('withoutLegion') === '1',
          search: (url.searchParams.get('q') || '').trim().slice(0, 100),
          cursor,
          limit,
        })
        return Response.json({ ok: true, ...result })
      },
    },
  },
})
