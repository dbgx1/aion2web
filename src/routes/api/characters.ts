import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { allowedServerIds } from '#/server/server-access.server'
import { jsonError } from '#/server/api-auth.server'
import { listCharacters, listDirectory } from '#/server/characters.server'
import { editCharacter } from '#/server/character-edit.server'
import { addPublicCharacter } from '#/server/public-character.server'

export const Route = createFileRoute('/api/characters')({
  server: {
    handlers: {
      POST: ({ request }) => addPublicCharacter(request),
      PATCH: ({ request }) => editCharacter(request),
      DELETE: ({ request }) => editCharacter(request, true),
      GET: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        const scope = await allowedServerIds(principal)
        const url = new URL(request.url)
        if (url.searchParams.get('directory') === '1') {
          return Response.json({ ok: true, servers: await listDirectory(scope) }, { headers: { 'Cache-Control': 'no-store' } })
        }

        const sort = url.searchParams.get('sort') || 'default'
        const chatStatus = url.searchParams.get('chatStatus') || 'all'
        if (chatStatus !== 'all' && chatStatus !== 'chatted' && chatStatus !== 'unchatted') return jsonError('无效的聊天状态', 400)
        if (sort !== 'default' && sort !== 'power_desc' && sort !== 'power_asc') return jsonError('无效的排序方式', 400)
        const rawCursor = url.searchParams.get('cursor') || '0'
        let cursor: number | string = 0
        if (sort === 'default') {
          cursor = Math.max(0, Number.parseInt(rawCursor, 10) || 0)
        } else if (rawCursor !== '0') {
          const parts = rawCursor.split(':')
          if (parts.length !== 3 || parts[0] !== sort
            || (parts[1] !== 'null' && (!/^\d+$/.test(parts[1]) || !Number.isSafeInteger(Number(parts[1]))))
            || !/^\d+$/.test(parts[2]) || !Number.isSafeInteger(Number(parts[2])) || Number(parts[2]) < 1) return jsonError('无效的排序分页游标', 400)
          cursor = rawCursor
        }
        // Larger pages are reserved for explicit bulk operations; ordinary browsing stays bounded.
        const bulk = url.searchParams.get('bulk') === '1'
        const raceId = url.searchParams.get('raceId') || '0'
        if (!['0', '1', '2'].includes(raceId)) return jsonError('raceId 必须为 0（全部）、1（天族）或 2（魔族）', 400)
        const limit = Math.min(bulk ? 1000 : 100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50))
        const result = await listCharacters({
          allowedServerIds: scope,
          chatStatus,
          sort,
          raceId: Number(raceId),
          serverId: (url.searchParams.get('serverId') || '').trim().slice(0, 100),
          legionName: (url.searchParams.get('legionName') || '').trim().slice(0, 100),
          withoutLegion: url.searchParams.get('withoutLegion') === '1',
          legionLeadersOnly: url.searchParams.get('legionLeadersOnly') === '1',
          search: (url.searchParams.get('q') || '').trim().slice(0, 100),
          characterId: (url.searchParams.get('characterId') || '').trim().slice(0, 100),
          characterName: (url.searchParams.get('characterName') || '').trim().slice(0, 100),
          includeTotal: !bulk && url.searchParams.get('includeTotal') !== '0',
          cursor,
          limit,
        })
        return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
      },
    },
  },
})
