export type CharacterUpload = {
  characterName: string
  characterId: string
  serverId: string
  serverName: string
  legionName: string
  legionPosition?: number | null
  level: number
  combatPower?: number | null
  equipItemLevel?: number | null
  gender?: number | null
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

  // Preserve the game's whole-character equipment level and EGender raw values.
  const rawEquipItemLevel = field(value, 'equipItemLevel', 'equip_item_level')
  const equipItemLevel = rawEquipItemLevel === undefined || rawEquipItemLevel === null ? null
    : typeof rawEquipItemLevel === 'number' ? rawEquipItemLevel
    : typeof rawEquipItemLevel === 'string' && /^\d+$/.test(rawEquipItemLevel) ? Number(rawEquipItemLevel) : NaN
  if (equipItemLevel !== null && (!Number.isInteger(equipItemLevel) || equipItemLevel < 0 || equipItemLevel > 2147483647)) {
    return { ok: false, error: `characters[${index}].equipItemLevel 必须是 0-2147483647 的整数或 null` }
  }
  const rawGender = field(value, 'gender')
  const gender = rawGender === undefined || rawGender === null ? null
    : typeof rawGender === 'number' ? rawGender
    : typeof rawGender === 'string' && /^[0-2]$/.test(rawGender) ? Number(rawGender) : NaN
  if (gender !== null && (!Number.isInteger(gender) || gender < 0 || gender > 2)) {
    return { ok: false, error: `characters[${index}].gender 必须为 0（未指定）、1（男）、2（女）或 null` }
  }

  const metadata = field(value, 'metadata', 'metadata_json')
  const rawPosition = field(value, 'legionPosition', 'legion_position')
  const legionPosition = rawPosition === undefined ? undefined : rawPosition === null ? null
    : typeof rawPosition === 'number' ? rawPosition
    : typeof rawPosition === 'string' && /^[0-3]$/.test(rawPosition) ? Number(rawPosition) : NaN
  if (legionPosition != null && (!Number.isInteger(legionPosition) || legionPosition < 0 || legionPosition > 3)) {
    return { ok: false, error: `characters[${index}].legionPosition 必须是 0-3 的整数或 null` }
  }
  if (rawPosition === undefined && field(value, 'isLegionLeader', 'is_legion_leader') !== undefined) {
    return { ok: false, error: `characters[${index}] 请将 isLegionLeader 更新为 legionPosition（0 军团长、1 军团干部、2 军团成员、3 雇佣兵）` }
  }
  const rawCombatPower = field(value, 'combatPower', 'combat_power')
  const combatPower = rawCombatPower === undefined || rawCombatPower === null || rawCombatPower === ''
    ? null : typeof rawCombatPower === 'number' || (typeof rawCombatPower === 'string' && rawCombatPower.trim())
      ? Number(rawCombatPower) : NaN
  if (combatPower !== null && (!Number.isSafeInteger(combatPower) || combatPower < 0)) {
    return { ok: false, error: `characters[${index}].combatPower 必须是非负安全整数` }
  }
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
      legionPosition,
      level,
      combatPower,
      equipItemLevel,
      gender,
      className: text(field(value, 'className', 'class_name'), 100),
      faction: text(field(value, 'faction'), 50),
      avatarUrl: text(field(value, 'avatarUrl', 'avatar_url'), 500),
      metadata: metadata && isRecord(metadata) ? metadata : null,
    },
  }
}
