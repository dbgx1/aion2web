export type GuildClaim = { serverId: string; legionName: string; ownerName: string; isMine: boolean; version: number; updatedAt: number }
export type GuildMutation = { action: 'claim' | 'release'; serverId: string; legionName: string; version: number }
export function parseGuildMutation(value: unknown): GuildMutation | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!['claim', 'release'].includes(String(v.action)) || typeof v.serverId !== 'string' || !v.serverId.trim() || v.serverId.length > 100
    || typeof v.legionName !== 'string' || !v.legionName.trim() || v.legionName.length > 100
    || typeof v.version !== 'number' || !Number.isSafeInteger(v.version) || v.version < 0) return null
  // Preserve exact guild names to match the character directory's identity.
  return { action: v.action as GuildMutation['action'], serverId: v.serverId, legionName: v.legionName, version: v.version }
}
