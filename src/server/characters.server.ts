import { env } from 'cloudflare:workers'
import type { CharacterUpload } from '#/lib/character-upload'
import { AION2_SERVERS, aion2ServerName } from '#/lib/aion2-servers'

const CHARACTER_UPSERT_SQL = `
  INSERT INTO game_characters (
    character_name, character_id, server_id, server_name, legion_name,
    level, class_name, faction, avatar_url, metadata_json,
    first_seen_at, last_seen_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(server_id, character_id) DO UPDATE SET
    character_name = excluded.character_name,
    server_name = excluded.server_name,
    legion_name = excluded.legion_name,
    level = excluded.level,
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
    character.level,
    character.className || null,
    character.faction || null,
    character.avatarUrl || null,
    character.metadata ? JSON.stringify(character.metadata) : null,
    now,
    now,
    now,
  )))

  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0)
}

export type CharacterListQuery = {
  serverId: string
  legionName: string
  withoutLegion: boolean
  search: string
  cursor: number
  limit: number
}

type CharacterRow = {
  id: number
  character_name: string
  character_id: string
  server_id: string
  server_name: string | null
  legion_name: string | null
  level: number
  class_name: string | null
  faction: string | null
  avatar_url: string | null
  last_seen_at: number
}

export async function listCharacters(query: CharacterListQuery) {
  const filters = ['id > ?']
  const bindings: unknown[] = [query.cursor]
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

  const result = await env.DB.prepare(`
    SELECT id, character_name, character_id, server_id, server_name,
      legion_name, level, class_name, faction, avatar_url, last_seen_at
    FROM game_characters
    WHERE ${filters.join(' AND ')}
    ORDER BY id
    LIMIT ?
  `).bind(...bindings, query.limit + 1).all<CharacterRow>()

  const hasMore = result.results.length > query.limit
  const rows = result.results.slice(0, query.limit)
  return {
    characters: rows.map((row) => ({
      id: row.id,
      characterName: row.character_name,
      characterId: row.character_id,
      serverId: row.server_id,
      serverName: aion2ServerName(row.server_id) || row.server_name || '',
      legionName: row.legion_name || '',
      level: row.level,
      className: row.class_name || '',
      faction: row.faction || '',
      avatarUrl: row.avatar_url || '',
      lastSeenAt: row.last_seen_at,
    })),
    nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
  }
}

type DirectoryRow = {
  server_id: string
  server_name: string | null
  legion_name: string | null
  character_count: number
}

export async function listDirectory() {
  const result = await env.DB.prepare(`
    SELECT server_id, MAX(server_name) AS server_name, legion_name,
      COUNT(*) AS character_count
    FROM game_characters
    GROUP BY server_id, legion_name
    ORDER BY server_id, legion_name
  `).all<DirectoryRow>()

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
  return [...servers.values()]
}

export function database() {
  return env.DB
}

export function uploadToken() {
  return env.UPLOAD_API_TOKEN
}
