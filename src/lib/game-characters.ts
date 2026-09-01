export type GameCharacter = {
  id: string
  characterId: string
  name: string
  serverKey: string
  serverName: string
  legionName: string
  className: string
  level: number
  avatarColor: string
  avatarUrl: string
  faction: string
}

export type CharacterDirectoryServer = {
  raceId: number
  serverId: string
  serverName: string
  characterCount: number
  unaffiliatedCount: number
  legions: Array<{ legionName: string; memberCount: number }>
}

const avatarColors = ['#0b756b', '#315b91', '#80516d', '#6b5e31', '#536b75', '#246d82']

export function avatarColorFor(characterId: string) {
  let hash = 0
  for (const character of characterId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return avatarColors[Math.abs(hash) % avatarColors.length]
}
