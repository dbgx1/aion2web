import { createFileRoute } from '@tanstack/react-router'
import { AION2_SERVERS, aion2ServerName } from '#/lib/aion2-servers'
import { isAdminRequest } from '#/server/admin-auth.server'
import { jsonError, verifyBearerToken } from '#/server/api-auth.server'
import { listCharacters, uploadToken } from '#/server/characters.server'

function integerParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10)
  const normalized = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(max, Math.max(min, normalized))
}

function textParam(value: string | null, maxLength: number) {
  return (value || '').trim().slice(0, maxLength)
}

export const Route = createFileRoute('/api/servers/$serverId/characters')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authorized = await isAdminRequest(request) || await verifyBearerToken(request, uploadToken())
        if (!authorized) return jsonError('未登录或访问令牌无效', 401)

        const serverId = params.serverId.trim().slice(0, 100)
        if (!serverId) return jsonError('serverId 不能为空', 400)

        const url = new URL(request.url)
        const limit = integerParam(url.searchParams.get('limit'), 200, 1, 500)
        const cursor = integerParam(url.searchParams.get('cursor'), 0, 0, Number.MAX_SAFE_INTEGER)
        const result = await listCharacters({
          serverId,
          legionName: textParam(url.searchParams.get('legionName'), 100),
          withoutLegion: url.searchParams.get('withoutLegion') === '1',
          search: textParam(url.searchParams.get('q'), 100),
          cursor,
          limit,
          includeTotal: url.searchParams.get('includeTotal') === '1',
        })
        const knownServer = AION2_SERVERS.find((server) => server.serverId === serverId)

        return Response.json({
          ok: true,
          server: {
            serverId,
            serverName: aion2ServerName(serverId) || knownServer?.serverName || '',
            known: Boolean(knownServer),
          },
          characters: result.characters,
          page: {
            cursor,
            limit,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
          },
          totalCount: result.totalCount,
        }, {
          headers: { 'Cache-Control': 'private, max-age=30' },
        })
      },
    },
  },
})
