const GLOBAL_REGIONS: Record<string, string> = { '1': 'nae', '2': 'naw', '3': 'eu', '4': 'la', '5': 'as' }

export function officialCharacterSource(serverId: string, requestedRegion: string) {
  const globalRegion = /^[12][1-5]0[1-9]$/.test(serverId) ? GLOBAL_REGIONS[serverId[1]] : undefined
  const region = requestedRegion.toUpperCase() || (globalRegion ? 'GLOBAL' : 'TW')
  if (region === 'GLOBAL' && globalRegion) {
    return {
      region, subRegion: globalRegion, origin: 'https://aion2.plaync.com',
      searchUrl: 'https://api-search.plaync.com/aion2global/search/v2/character',
      infoPath: '/api/character/info', equipmentPath: '/api/character/equipment',
      referer: 'https://aion2.plaync.com/en-us/',
      searchParams: { localeInfo: 'en-US', region: globalRegion } as Record<string, string>,
      detailParams: { lang: 'en-US', region: globalRegion } as Record<string, string>,
      serverName: '',
    }
  }
  // Keep explicit legacy API lookups compatible without adding their names to
  // the international console directory. The upstream supplies the actual name.
  const twServer = /^([12])0(0[1-9]|1[0-8])$/.exec(serverId)
  if (region !== 'TW' || !twServer) return null
  return {
    region, subRegion: '', origin: 'https://tw.ncsoft.com',
    searchUrl: 'https://tw.ncsoft.com/aion2/api/search/character',
    infoPath: '/aion2/api/character/info', equipmentPath: '/aion2/api/character/equipment',
    referer: 'https://tw.ncsoft.com/aion2/characters/index',
    searchParams: { race: twServer[1] } as Record<string, string>,
    detailParams: { lang: 'zh' } as Record<string, string>,
    serverName: '',
  }
}

export class OfficialCharacterError extends Error {
  constructor(message: string, public status = 502) { super(message) }
}

// Fixed upstream origins only; never forward the caller's Cookie or Bearer token.
export async function fetchOfficialCharacterJson(url: URL, referer: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Referer: referer, 'User-Agent': 'AION2-Control-Portal/1.0' },
      // Workers supports only follow/manual; reject redirects through the !ok check below.
      signal: AbortSignal.timeout(8_000), redirect: 'manual',
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new OfficialCharacterError(`NCSoft 角色查询失败 (${response.status})`, response.status === 429 ? 503 : 502)
    }
    if (!response.body) throw new Error('Empty response')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    let body = ''
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 2_000_000) {
          await reader.cancel()
          throw new Error('Response too large')
        }
        body += decoder.decode(part.value, { stream: true })
      }
      body += decoder.decode()
    } finally { reader.releaseLock() }
    const value: unknown = JSON.parse(body)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response')
    return value as Record<string, unknown>
  } catch (cause) {
    if (cause instanceof OfficialCharacterError) throw cause
    throw new OfficialCharacterError('连接 NCSoft 角色查询服务失败或返回数据无效')
  }
}
