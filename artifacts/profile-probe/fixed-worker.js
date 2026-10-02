import { fetchOfficialCharacterJson, officialCharacterSource } from '../../src/server/official-character.server.ts'

// Remote preview only. Fixed public test character, no production bindings or credentials.
export default {
  async fetch() {
    const source = officialCharacterSource('2201', 'GLOBAL')
    const search = new URL(source.searchUrl)
    search.search = new URLSearchParams({ ...source.searchParams, keyword:'wangjw98',serverId:'2201',page:'1',size:'40' }).toString()
    const list = await fetchOfficialCharacterJson(search, source.referer)
    const item = list.list.find(item => item.name.replace(/<[^>]*>/g,'') === 'wangjw98' && item.serverId === 2201)
    const params = new URLSearchParams({...source.detailParams,serverId:'2201',characterId:decodeURIComponent(item.characterId)})
    const results = await Promise.all([source.infoPath,source.equipmentPath].map(path=> {
      const url = new URL(path,source.origin)
      url.search=params.toString()
      return fetchOfficialCharacterJson(url,source.referer)
    }))
    return Response.json({ok:true,source:'ncsoft',runtime:'cloudflare-remote-preview',name:results[0].profile.characterName,serverId:results[0].profile.serverId,level:results[0].profile.characterLevel,combatPower:results[0].profile.combatPower,equipment:results[1].equipment.equipmentList.length,skills:results[1].skill.skillList.length})
  }
}
