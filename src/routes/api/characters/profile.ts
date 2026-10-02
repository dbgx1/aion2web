import { canAccessServer } from '#/server/server-access.server'
import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError, verifyBearerToken } from '#/server/api-auth.server'
import { uploadToken } from '#/server/characters.server'
import { fetchOfficialCharacterJson, officialCharacterSource, OfficialCharacterError } from '#/server/official-character.server'

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

export const Route = createFileRoute('/api/characters/profile')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal && !await verifyBearerToken(request, uploadToken())) return jsonError('未登录或访问令牌无效', 401)

        const url = new URL(request.url)
        const characterName = (url.searchParams.get('characterName') || '').trim()
        const serverId = (url.searchParams.get('serverId') || '').trim()
        if (!characterName || characterName.length > 100 || !/^[12]\d{3}$/.test(serverId)) return jsonError('角色名或区服 ID 无效', 400)

        if (principal && !await canAccessServer(principal, serverId)) return jsonError('无权访问该区服', 403)
        const source = officialCharacterSource(serverId, (url.searchParams.get('region') || '').trim())
        if (!source) return jsonError('不支持该地区或区服；region 可选 TW、GLOBAL', 400)

        const officialUrl = new URL(source.searchUrl)
        officialUrl.search = new URLSearchParams({
          ...source.searchParams,
          keyword: characterName,
          serverId,
          sort: 'desc',
          page: '1',
          size: '40',
        }).toString()

        let body: Record<string, unknown>
        try {
          body = await fetchOfficialCharacterJson(officialUrl, source.referer)
        } catch (cause) {
          return jsonError(cause instanceof Error ? cause.message : 'NCSoft 查询失败', cause instanceof OfficialCharacterError ? cause.status : 502)
        }

        if (!Array.isArray(body.list)) return jsonError('NCSoft 搜索响应格式无效', 502)
        const matches: OfficialSearchItem[] = body.list.map(record)
        const item = matches.find((candidate) => (
          plainCharacterName(candidate.name) === characterName
          && String(number(candidate.serverId)) === serverId
        ))
        if (!item) {
          return Response.json({ ok: true, found: false }, {
            headers: { 'Cache-Control': 'no-store' },
          })
        }

        const officialCharacterId = text(item.characterId)
        if (!officialCharacterId) return jsonError('NCSoft 未返回有效角色标识', 502)
        const imagePath = text(item.profileImageUrl)
        let decodedCharacterId = officialCharacterId
        try {
          decodedCharacterId = decodeURIComponent(officialCharacterId)
        } catch {
          // The search API normally returns a percent-encoded trailing padding character.
        }
        const detailParams = {
          ...source.detailParams,
          characterId: decodedCharacterId,
          serverId,
        }
        const detailUrl = new URL(source.infoPath, source.origin)
        const equipmentUrl = new URL(source.equipmentPath, source.origin)
        detailUrl.search = equipmentUrl.search = new URLSearchParams(detailParams).toString()
        const [detailResult, equipmentResult] = await Promise.allSettled([
          fetchOfficialCharacterJson(detailUrl, source.referer),
          fetchOfficialCharacterJson(equipmentUrl, source.referer),
        ])
        if (detailResult.status === 'rejected') {
          const cause = detailResult.reason
          return jsonError('NCSoft 角色详情查询失败', cause instanceof OfficialCharacterError ? cause.status : 502)
        }
        const detail = detailResult.value
        const equipmentData = equipmentResult.status === 'fulfilled' ? equipmentResult.value : {}
        const detailProfile = record(detail.profile)
        if (String(detailProfile.serverId) !== serverId || plainCharacterName(detailProfile.characterName) !== characterName) {
          return jsonError('NCSoft 角色详情与请求不匹配', 502)
        }
        const partial = !Array.isArray(record(equipmentData.equipment).equipmentList) || !Array.isArray(record(equipmentData.skill).skillList)
        const statRows = records(record(detail.stat).statList)
        const titleData = record(detail.title)
        const equipment = record(equipmentData.equipment)
        const petwing = record(equipmentData.petwing)
        const skill = record(equipmentData.skill)
        const detailedImage = text(detailProfile.profileImage)
        return Response.json({
          ok: true,
          found: true,
          source: 'ncsoft',
          region: source.region,
          subRegion: source.subRegion,
          partial,
          warnings: partial ? ['装备或技能资料暂不可用；空列表不代表角色没有装备或技能'] : [],
          profile: {
            characterId: officialCharacterId,
            name: plainCharacterName(item.name),
            race: number(item.race),
            pcId: number(item.pcId),
            level: number(detailProfile.characterLevel) || number(item.level),
            serverId: String(number(item.serverId)),
            serverName: text(item.serverName) || source.serverName,
            profileImageUrl: detailedImage || (imagePath ? new URL(imagePath, PROFILE_IMAGE_ORIGIN).toString() : ''),
            region: text(detailProfile.regionName) || text(item.region) || source.subRegion || source.region,
            profileUrl: source.region === 'TW'
              ? `${source.origin}/aion2/characters/${serverId}/${officialCharacterId}`
              : `https://shugo.gg/character?${new URLSearchParams({ id: decodedCharacterId, server: serverId, region: 'GLOBAL', name: characterName })}`,
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
          headers: { 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
