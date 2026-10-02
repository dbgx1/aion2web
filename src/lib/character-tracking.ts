import type { GameCharacter } from './game-characters'

export const trackingPriorities = { high: '高', medium: '中', low: '低' } as const
export const trackingStatuses = { pending: '待联系', contacting: '沟通中', waiting: '待回复', closed: '已结束' } as const
export type TrackingDetails = {
  priority: keyof typeof trackingPriorities
  status: keyof typeof trackingStatuses
  notes: string
  nextFollowUp: number | null
}
export type TrackingEntry = TrackingDetails & { character: GameCharacter; updatedAt: number }
export type TrackingClaim = { characterId: string; ownerName: string; isMine: boolean }
export type TrackingMutation = { characterId: number } & (
  { action: 'add' } | { action: 'remove' } | ({ action: 'update' } & TrackingDetails)
)

export function parseTrackingMutation(value: unknown): TrackingMutation | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!Number.isSafeInteger(v.characterId) || (v.characterId as number) <= 0) return null
  const characterId = v.characterId as number
  if (v.action === 'add' || v.action === 'remove') return { characterId, action: v.action }
  if (v.action !== 'update' || typeof v.priority !== 'string' || !Object.hasOwn(trackingPriorities, v.priority)
    || typeof v.status !== 'string' || !Object.hasOwn(trackingStatuses, v.status)
    || typeof v.notes !== 'string' || v.notes.length > 4000
    || (v.nextFollowUp !== null && (!Number.isSafeInteger(v.nextFollowUp) || (v.nextFollowUp as number) < 0 || (v.nextFollowUp as number) > 8640000000000000))) return null
  return { characterId, action: 'update', priority: v.priority as TrackingDetails['priority'],
    status: v.status as TrackingDetails['status'], notes: v.notes.trim(), nextFollowUp: v.nextFollowUp as number | null }
}
