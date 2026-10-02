import { env } from 'cloudflare:workers'
import { currentAdminPrincipal } from './admin-auth.server'
import { allowedServerIds } from './server-access.server'
import { jsonError } from './api-auth.server'

export async function intelligenceResponse(request: Request) {
  const principal = await currentAdminPrincipal(request)
  if (!principal) return jsonError('未登录', 401)
  const url = new URL(request.url), params = url.searchParams
  const view = params.get('view') || 'directory', metric = params.get('metric') || (view === 'players' ? 'power' : 'members')
  if (!['directory', 'players', 'guilds'].includes(view)
    || !(view === 'players' ? ['power', 'level'] : view === 'directory' ? ['members', 'name'] : ['members', 'average']).includes(metric)) return jsonError('无效的榜单类型', 400)
  const rawPage = params.get('page') || '0'
  if (!/^\d{1,6}$/.test(rawPage)) return jsonError('无效的页码', 400)
  const page = Number(rawPage), server = (params.get('server') || '').trim(), q = (params.get('q') || '').trim()
  if (q.length > 100 || server.length > 100) return jsonError('筛选内容过长', 400)
  const scope = await allowedServerIds(principal)
  if (server && scope !== null && !scope.includes(server)) return jsonError('无权查看该区服', 403)
  const filters: string[] = [], args: unknown[] = []
  if (scope !== null) { filters.push(scope.length ? `server_id IN (${scope.map(() => '?').join(',')})` : '0=1'); args.push(...scope) }
  if (server) { filters.push('server_id=?'); args.push(server) }
  if (view !== 'players') filters.push("TRIM(COALESCE(legion_name,'')) != ''")
  const base = `SELECT * FROM game_characters ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}`
  const score = metric === 'power' ? 'combat_power' : 'level'
  const source = view === 'players'
    ? `SELECT id, character_name AS name, character_id, server_id, server_name, legion_name, level, combat_power, class_name, faction, avatar_url, legion_position, last_seen_at, ${score} AS score FROM scoped WHERE ${score} IS NOT NULL`
    : `SELECT server_id, MAX(server_name) AS server_name, legion_name AS name, COUNT(*) AS member_count, COUNT(combat_power) AS known_power_count, ROUND(AVG(combat_power),2) AS average_power, MAX(last_seen_at) AS last_seen_at, ${metric === 'average' ? 'ROUND(AVG(combat_power),2)' : 'COUNT(*)'} AS score FROM scoped GROUP BY server_id, legion_name ${metric === 'average' ? 'HAVING COUNT(combat_power)>0' : ''}`
  // Search follows ranking so searching for a player never makes them rank #1.
  const cte = `WITH scoped AS (${base}), items AS (${source}), ranked AS (SELECT *, RANK() OVER (ORDER BY score DESC) AS rank FROM items)`
  const where = q ? 'WHERE instr(name,?)>0' : ''
  const bindings = [...args, ...(q ? [q] : [])]
  const order = metric === 'name' ? 'name, server_id' : view === 'players' ? 'score DESC, id' : 'score DESC, server_id, name'
  const [rows, count] = await Promise.all([
    env.DB.prepare(`${cte} SELECT * FROM ranked ${where} ORDER BY ${order} LIMIT 50 OFFSET ?`).bind(...bindings, page * 50).all(),
    env.DB.prepare(`${cte} SELECT COUNT(*) AS total FROM ranked ${where}`).bind(...bindings).first<{ total: number }>(),
  ])
  return Response.json({ ok: true, rows: rows.results, total: count?.total || 0, page, pageSize: 50, queriedAt: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
}
