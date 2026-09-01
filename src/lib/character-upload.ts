export type CharacterUpload = {
  characterName: string
  characterId: string
  serverId: string
  serverName: string
  legionName: string
  level: number
  className: string
  faction: string
  avatarUrl: string
  metadata: Record<string, unknown> | null
}

type ValidationResult =
  | { ok: true; value: CharacterUpload }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim().slice(0, maxLength)
}

function field(record: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    if (record[name] !== undefined) return record[name]
  }
  return undefined
}

export function parseCharacterUpload(value: unknown, index: number): ValidationResult {
  if (!isRecord(value)) return { ok: false, error: `characters[${index}] 必须是对象` }

  const characterName = text(field(value, 'characterName', 'character_name', 'name'), 100)
  const characterId = text(field(value, 'characterId', 'character_id'), 100)
  const serverId = text(field(value, 'serverId', 'server_id', 'serverKey'), 100)
  if (!characterName) return { ok: false, error: `characters[${index}].characterName 不能为空` }
  if (!characterId) return { ok: false, error: `characters[${index}].characterId 不能为空` }
  if (!serverId) return { ok: false, error: `characters[${index}].serverId 不能为空` }

  const rawLevel = field(value, 'level')
  const level = rawLevel === undefined || rawLevel === null || rawLevel === ''
    ? 0
    : Number(rawLevel)
  if (!Number.isInteger(level) || level < 0 || level > 999) {
    return { ok: false, error: `characters[${index}].level 必须是 0-999 的整数` }
  }

  const metadata = field(value, 'metadata', 'metadata_json')
  if (metadata !== undefined && metadata !== null && !isRecord(metadata)) {
    return { ok: false, error: `characters[${index}].metadata 必须是对象` }
  }

  return {
    ok: true,
    value: {
      characterName,
      characterId,
      serverId,
      serverName: text(field(value, 'serverName', 'server_name'), 100),
      legionName: text(field(value, 'legionName', 'legion_name', 'guildName', 'guild_name'), 100),
      level,
      className: text(field(value, 'className', 'class_name'), 100),
      faction: text(field(value, 'faction'), 50),
      avatarUrl: text(field(value, 'avatarUrl', 'avatar_url'), 500),
      metadata: metadata && isRecord(metadata) ? metadata : null,
    },
  }
}
