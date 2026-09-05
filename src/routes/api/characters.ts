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
        // Larger pages are reserved for explicit bulk operations; ordinary browsing stays bounded.
        const bulk = url.searchParams.get('bulk') === '1'
        const raceId = url.searchParams.get('raceId') || '0'
        if (!['0', '1', '2'].includes(raceId)) return jsonError('raceId 必须为 0（全部）、1（天族）或 2（魔族）', 400)
        const limit = Math.min(bulk ? 1000 : 100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50))
        const result = await listCharacters({
          raceId: Number(raceId),
          serverId: (url.searchParams.get('serverId') || '').trim().slice(0, 100),
          legionName: (url.searchParams.get('legionName') || '').trim().slice(0, 100),
          withoutLegion: url.searchParams.get('withoutLegion') === '1',
          search: (url.searchParams.get('q') || '').trim().slice(0, 100),
          characterId: (url.searchParams.get('characterId') || '').trim().slice(0, 100),
          characterName: (url.searchParams.get('characterName') || '').trim().slice(0, 100),
          includeTotal: !bulk && url.searchParams.get('includeTotal') !== '0',
          cursor,
          limit,
        })
        return Response.json({ ok: true, ...result })
      },
    },
  },
})
