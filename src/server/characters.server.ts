import { env } from 'cloudflare:workers'
import type { CharacterUpload } from '#/lib/character-upload'
import type { CharacterSort } from '#/lib/use-directory-filters'
import { AION2_SERVERS, aion2ServerName } from '#/lib/aion2-servers'

const CHARACTER_UPSERT_SQL = `
  INSERT INTO game_characters (
    character_name, character_id, server_id, server_name, legion_name,
    legion_position, level, combat_power, equip_item_level, gender, class_name, faction, avatar_url, metadata_json,
    first_seen_at, last_seen_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(server_id, character_id) DO UPDATE SET
    character_name = excluded.character_name,
    server_name = excluded.server_name,
    legion_name = excluded.legion_name,
    legion_position = CASE WHEN ? THEN excluded.legion_position ELSE game_characters.legion_position END,
    level = excluded.level,
    combat_power = COALESCE(excluded.combat_power, game_characters.combat_power),
    equip_item_level = COALESCE(excluded.equip_item_level, game_characters.equip_item_level),
    gender = COALESCE(excluded.gender, game_characters.gender),
    class_name = excluded.class_name,
    faction = excluded.faction,
    avatar_url = excluded.avatar_url,
    metadata_json = excluded.metadata_json,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
`

export async function upsertCharacters(characters: CharacterUpload[]) {
  const now = Date.now()
  const statement = env.DB.prepare(CHARACTER_UPSERT_SQL)
  const results = await env.DB.batch(characters.map((character) => statement.bind(
    character.characterName,
    character.characterId,
    character.serverId,
    character.serverName || null,
    character.legionName || null,
    character.legionPosition ?? null,
    character.level,
    character.combatPower ?? null,
    character.equipItemLevel ?? null,
    character.gender ?? null,
    character.className || null,
    character.faction || null,
    character.avatarUrl || null,
    character.metadata ? JSON.stringify(character.metadata) : null,
    now,
    now,
    now,
    character.legionPosition === undefined ? 0 : 1,
  )))

  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0)
}

export type CharacterListQuery = {
  chatStatus?: 'all' | 'chatted' | 'unchatted'
  allowedServerIds?: string[] | null
  raceId?: number
  serverId: string
  legionName: string
  withoutLegion: boolean
  legionLeadersOnly?: boolean
  search: string
  cursor: number | string
  sort?: CharacterSort
  limit: number
  includeTotal?: boolean
  characterId?: string
  characterName?: string
}

type CharacterRow = {
  id: number
  character_name: string
  character_id: string
  server_id: string
  server_name: string | null
  legion_name: string | null
  legion_position: number | null
  level: number
  combat_power: number | null
  equip_item_level: number | null
  gender: number | null
  class_name: string | null
  faction: string | null
  avatar_url: string | null
  last_seen_at: number
}

export async function listCharacters(query: CharacterListQuery) {
  const filters: string[] = []
  const bindings: unknown[] = []
  if (query.allowedServerIds != null) {
    filters.push(query.allowedServerIds.length ? `server_id IN (${query.allowedServerIds.map(() => '?').join(',')})` : '0 = 1')
    bindings.push(...query.allowedServerIds)
  }
  if (query.raceId) {
    // Race follows the existing server directory, rather than free-form uploaded faction labels.
    const serverIds = AION2_SERVERS.filter(server => server.raceId === query.raceId).map(server => server.serverId)
    filters.push(serverIds.length ? `server_id IN (${serverIds.map(() => '?').join(', ')})` : '0 = 1')
    bindings.push(...serverIds)
  }
  if (query.characterId) {
    filters.push('character_id = ?')
    bindings.push(query.characterId)
  } else if (query.characterName) {
    filters.push('character_name = ?')
    bindings.push(query.characterName)
  }
  if (query.serverId) {
    filters.push('server_id = ?')
    bindings.push(query.serverId)
  }
  if (query.withoutLegion) {
    filters.push("COALESCE(legion_name, '') = ''")
  } else if (query.legionName) {
    filters.push('legion_name = ?')
    bindings.push(query.legionName)
  }
  if (query.search) {
    filters.push('(instr(character_name, ?) > 0 OR instr(character_id, ?) > 0)')
    bindings.push(query.search, query.search)
  }
  if (query.legionLeadersOnly) filters.push('legion_position = 0')
  if (query.chatStatus === 'chatted' || query.chatStatus === 'unchatted') {
    filters.push(`${query.chatStatus === 'unchatted' ? 'NOT ' : ''}EXISTS (
      SELECT 1 FROM chat_conversations c JOIN chat_messages m ON m.conversation_id = c.id
      WHERE c.character_ref = game_characters.id AND m.direction IN ('incoming', 'outgoing')
    )`)
  }

  const includeTotal = query.includeTotal !== false
  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
  const totalRow = includeTotal
    ? await env.DB.prepare(`
      SELECT COUNT(*) AS total_count
      FROM game_characters
      ${whereClause}
    `).bind(...bindings).first<{ total_count: number }>()
    : null

  const powerSort = query.sort === 'power_asc' || query.sort === 'power_desc'
  const pageFilters = [...filters]
  const pageBindings = [...bindings]
  let orderBy = 'id'
  if (powerSort) {
    const ascending = query.sort === 'power_asc'
    orderBy = `(combat_power IS NULL), combat_power ${ascending ? 'ASC' : 'DESC'}, id`
    if (typeof query.cursor === 'string') {
      const [, power, id] = query.cursor.split(':')
      if (power === 'null') {
        pageFilters.push('(combat_power IS NULL AND id > ?)')
        pageBindings.push(Number(id))
      } else {
        pageFilters.push(`(combat_power IS NULL OR combat_power ${ascending ? '>' : '<'} ? OR (combat_power = ? AND id > ?))`)
        pageBindings.push(Number(power), Number(power), Number(id))
      }
    }
  } else {
    pageFilters.push('id > ?')
    pageBindings.push(query.cursor)
  }
  const result = await env.DB.prepare(`
    SELECT id, character_name, character_id, server_id, server_name,
      legion_name, legion_position, level, combat_power, equip_item_level, gender, class_name, faction, avatar_url, last_seen_at
    FROM game_characters
    ${pageFilters.length ? `WHERE ${pageFilters.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
    LIMIT ?
  `).bind(...pageBindings, query.limit + 1).all<CharacterRow>()

  const hasMore = result.results.length > query.limit
  const rows = result.results.slice(0, query.limit)
  const lastRow = rows.at(-1)
  return {
    characters: rows.map((row) => ({
      id: row.id,
      characterName: row.character_name,
      characterId: row.character_id,
      serverId: row.server_id,
      serverName: aion2ServerName(row.server_id) || row.server_name || '',
      legionName: row.legion_name || '',
      legionPosition: row.legion_position ?? null,
      level: row.level,
      combatPower: row.combat_power ?? null,
      equipItemLevel: row.equip_item_level ?? null,
      gender: row.gender ?? null,
      className: row.class_name || '',
      faction: row.faction || '',
      avatarUrl: row.avatar_url || '',
      lastSeenAt: row.last_seen_at,
    })),
    nextCursor: hasMore && lastRow ? powerSort ? `${query.sort}:${lastRow.combat_power ?? 'null'}:${lastRow.id}` : lastRow.id : null,
    hasMore,
    totalCount: includeTotal ? Number(totalRow?.total_count || 0) : null,
  }
}

type DirectoryRow = {
  server_id: string
  server_name: string | null
  legion_name: string | null
  character_count: number
}

export async function listDirectory(allowedServerIds: string[] | null = null) {
  const result = await env.DB.prepare(`
    SELECT server_id, MAX(server_name) AS server_name, legion_name,
      COUNT(*) AS character_count
    FROM game_characters
    ${allowedServerIds === null ? '' : allowedServerIds.length ? `WHERE server_id IN (${allowedServerIds.map(() => '?').join(',')})` : 'WHERE 0 = 1'}
    GROUP BY server_id, legion_name
    ORDER BY server_id, legion_name
  `).bind(...(allowedServerIds || [])).all<DirectoryRow>()

  const servers = new Map<string, {
    raceId: number
    serverId: string
    serverName: string
    characterCount: number
    unaffiliatedCount: number
    legions: Array<{ legionName: string; memberCount: number }>
  }>(AION2_SERVERS.map((server) => [server.serverId, {
    raceId: server.raceId,
    serverId: server.serverId,
    serverName: server.serverName,
    characterCount: 0,
    unaffiliatedCount: 0,
    legions: [],
  }]))
  for (const row of result.results) {
    const server = servers.get(row.server_id) || {
      raceId: 0,
      serverId: row.server_id,
      serverName: aion2ServerName(row.server_id) || row.server_name || row.server_id,
      characterCount: 0,
      unaffiliatedCount: 0,
      legions: [],
    }
    server.characterCount += row.character_count
    if (row.legion_name) {
      server.legions.push({ legionName: row.legion_name, memberCount: row.character_count })
    } else {
      server.unaffiliatedCount += row.character_count
    }
    servers.set(row.server_id, server)
  }
  return [...servers.values()].filter(server => allowedServerIds === null || allowedServerIds.includes(server.serverId))
}

export function database() {
  return env.DB
}

export function uploadToken() {
  return env.UPLOAD_API_TOKEN
}
