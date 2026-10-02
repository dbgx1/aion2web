export default {
  async fetch() {
    const urls = [
      'https://api-search.plaync.com/aion2global/search/v2/character?keyword=wangjw98&page=1&size=40&sort=desc&localeInfo=en-US&region=naw&serverId=2201',
      'https://aion2.plaync.com/api/character/info?lang=en-US&characterId=9PO8eUjDa8pGlEbVzGrXcNK-rydJuNEnuILI_u6vDuM%3D&serverId=2201&region=naw',
    ]
    const result = await Promise.all(urls.map(async url => {
      const start = Date.now()
      try {
        const r = await fetch(url, {headers:{Accept:'application/json',Referer:'https://aion2.plaync.com/en-us/','User-Agent':'AION2-Control-Portal/1.0'},redirect:'error',signal:AbortSignal.timeout(8000)})
        const reader = r.body?.getReader()
        const first = await reader?.read()
        await reader?.cancel()
        return {url,status:r.status,type:r.headers.get('content-type'),location:r.headers.get('location'),first:new TextDecoder().decode(first?.value).slice(0,900),ms:Date.now()-start}
      } catch(e) {return {url,error:e.message,name:e.name,stack:e.stack,ms:Date.now()-start}}
    }))
    return Response.json(result)
  }
}
