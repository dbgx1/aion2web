import { createFileRoute } from '@tanstack/react-router'
import { AION2_SERVERS } from '#/lib/aion2-servers'
import { isAdminRequest } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'

const OFFICIAL_ORIGIN = 'https://tw.ncsoft.com'
const PROFILE_IMAGE_ORIGIN = 'https://profileimg.plaync.com'

type OfficialSearchItem = {
  characterId?: unknown
  name?: unknown
  race?: unknown
  pcId?: unknown
  level?: unknown
  serverId?: unknown
  serverName?: unknown
  profileImageUrl?: unknown
  region?: unknown
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function plainCharacterName(value: unknown) {
  return text(value).replace(/<[^>]*>/g, '').trim()
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.flatMap((item) => typeof item === 'string' ? [item] : []) : []
}

async function fetchOfficialData(path: string, params: Record<string, string>) {
  const url = new URL(path, OFFICIAL_ORIGIN)
  url.search = new URLSearchParams(params).toString()
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Referer: `${OFFICIAL_ORIGIN}/aion2/characters/index`,
        'User-Agent': 'Mozilla/5.0 (compatible; AION2-Control-Portal/1.0)',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return {}
    return record(await response.json())
  } catch {
    return {}
  }
}

export const Route = createFileRoute('/api/characters/profile')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!await isAdminRequest(request)) return jsonError('未登录', 401)

        const url = new URL(request.url)
        const characterName = (url.searchParams.get('characterName') || '').trim().slice(0, 100)
        const serverId = (url.searchParams.get('serverId') || '').trim().slice(0, 20)
        if (!characterName || !serverId) return jsonError('缺少角色名或区服 ID', 400)

        const server = AION2_SERVERS.find((item) => item.serverId === serverId)
        if (!server) return jsonError('暂不支持该区服的官网查询', 400)

        const officialUrl = new URL('/aion2/api/search/character', OFFICIAL_ORIGIN)
        officialUrl.search = new URLSearchParams({
          keyword: characterName,
          race: String(server.raceId),
          serverId,
          sort: 'desc',
          page: '1',
          size: '40',
        }).toString()

        let response: Response
        try {
          response = await fetch(officialUrl, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0 (compatible; AION2-Control-Portal/1.0)',
            },
            signal: AbortSignal.timeout(8_000),
          })
        } catch {
          return jsonError('连接 NCSoft 角色查询服务失败', 502)
        }
        if (!response.ok) return jsonError(`NCSoft 角色查询失败 (${response.status})`, 502)

        let body: { list?: OfficialSearchItem[] }
        try {
          body = await response.json() as { list?: OfficialSearchItem[] }
        } catch {
          return jsonError('NCSoft 返回了无法解析的数据', 502)
        }

        const matches = Array.isArray(body.list) ? body.list : []
        const item = matches.find((candidate) => (
          plainCharacterName(candidate.name) === characterName
          && String(number(candidate.serverId)) === serverId
        ))
        if (!item) {
          return Response.json({ ok: true, found: false }, {
            headers: { 'Cache-Control': 'private, max-age=60' },
          })
        }

        const officialCharacterId = text(item.characterId)
        const imagePath = text(item.profileImageUrl)
        let decodedCharacterId = officialCharacterId
        try {
          decodedCharacterId = decodeURIComponent(officialCharacterId)
        } catch {
          // The search API normally returns a percent-encoded trailing padding character.
        }
        const detailParams = {
          lang: 'zh',
          characterId: decodedCharacterId,
          serverId,
        }
        const [detail, equipmentData] = await Promise.all([
          fetchOfficialData('/aion2/api/character/info', detailParams),
          fetchOfficialData('/aion2/api/character/equipment', detailParams),
        ])
        const detailProfile = record(detail.profile)
        const statRows = records(record(detail.stat).statList)
        const titleData = record(detail.title)
        const equipment = record(equipmentData.equipment)
        const petwing = record(equipmentData.petwing)
        const skill = record(equipmentData.skill)
        const detailedImage = text(detailProfile.profileImage)
        return Response.json({
          ok: true,
          found: true,
          profile: {
            characterId: officialCharacterId,
            name: plainCharacterName(item.name),
            race: number(item.race),
            pcId: number(item.pcId),
            level: number(detailProfile.characterLevel) || number(item.level),
            serverId: String(number(item.serverId)),
            serverName: text(item.serverName) || server.serverName,
            profileImageUrl: detailedImage || (imagePath ? new URL(imagePath, PROFILE_IMAGE_ORIGIN).toString() : ''),
            region: text(detailProfile.regionName) || text(item.region),
            profileUrl: `${OFFICIAL_ORIGIN}/aion2/characters/${serverId}/${officialCharacterId}`,
            className: text(detailProfile.className),
            combatPower: number(detailProfile.combatPower),
            genderName: text(detailProfile.genderName),
            raceName: text(detailProfile.raceName),
            titleName: text(detailProfile.titleName),
            itemLevel: number(statRows.find((row) => text(row.type) === 'ItemLevel')?.value),
            stats: statRows.map((row) => ({
              name: text(row.name),
              type: text(row.type),
              value: number(row.value),
              details: stringList(row.statSecondList),
            })),
            titles: {
              ownedCount: number(titleData.ownedCount),
              totalCount: number(titleData.totalCount),
              categories: records(titleData.titleList).map((row) => ({
                category: text(row.equipCategory),
                ownedCount: number(row.ownedCount),
                totalCount: number(row.totalCount),
              })),
            },
            daevanion: records(record(detail.daevanion).boardList).map((row) => ({
              id: number(row.id),
              name: text(row.name),
              icon: text(row.icon),
              open: number(row.open) === 1,
              openNodeCount: number(row.openNodeCount),
              totalNodeCount: number(row.totalNodeCount),
            })),
            equipment: records(equipment.equipmentList).map((row) => ({
              id: number(row.id),
              name: text(row.name),
              icon: text(row.icon),
              grade: text(row.grade),
              enchantLevel: number(row.enchantLevel),
              exceedLevel: number(row.exceedLevel),
              slot: text(row.slotPosName),
            })),
            pet: (() => {
              const value = record(petwing.pet)
              return text(value.name) ? {
                id: number(value.id),
                name: text(value.name),
                icon: text(value.icon),
                level: number(value.level),
              } : null
            })(),
            wing: (() => {
              const value = record(petwing.wing)
              return text(value.name) ? {
                id: number(value.id),
                name: text(value.name),
                icon: text(value.icon),
                grade: text(value.grade),
                enchantLevel: number(value.enchantLevel),
              } : null
            })(),
            skills: records(skill.skillList).map((row) => ({
              id: number(row.id),
              name: text(row.name),
              icon: text(row.icon),
              category: text(row.category),
              acquired: number(row.acquired) === 1,
              equipped: number(row.equip) === 1,
              needLevel: number(row.needLevel),
              skillLevel: number(row.skillLevel),
            })),
          },
        }, {
          headers: { 'Cache-Control': 'private, max-age=300' },
        })
      },
    },
  },
})
