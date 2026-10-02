import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GuildClaim, GuildMutation } from '#/lib/guild-tracking'
import { aion2ServerName } from '#/lib/aion2-servers'
type State = { claims: GuildClaim[]; canManage: boolean; ready: boolean; busy: boolean; error: string; refresh: () => Promise<void>; mutate: (input: GuildMutation) => Promise<void> }
const Context=createContext<State | null>(null)
export function GuildTrackingProvider({children}:{children:ReactNode}) {
  const [claims,setClaims]=useState<GuildClaim[]>([]),[canManage,setCanManage]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const version=useRef(0),locked=useRef(false)
  async function refresh() {
    const revision=++version.current
    try { const response=await fetch('/api/guild-tracking',{cache:'no-store'}); const data=await response.json() as {ok:boolean;claims:GuildClaim[];canManage:boolean;error?:string}
      if(!response.ok||!data.ok)throw new Error(data.error||'读取军团跟踪失败')
      if(revision!==version.current)return
      setClaims(data.claims);setCanManage(data.canManage);setReady(true)
    }catch(cause){if(revision===version.current){setReady(false);setError(cause instanceof Error?cause.message:'读取军团跟踪失败')}}
  }
  useEffect(()=>{void refresh();const reload=()=>{if(!document.hidden&&!locked.current)void refresh()};const timer=setInterval(reload,15000);window.addEventListener('focus',reload);return()=>{++version.current;clearInterval(timer);window.removeEventListener('focus',reload)}},[])
  async function mutate(input:GuildMutation) {
    if(locked.current)return
    locked.current=true;setBusy(true);setError('');++version.current
    try { const response=await fetch('/api/guild-tracking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json() as {ok:boolean;error?:string}
      if(!response.ok||!data.ok){if(response.status===409)await refresh();throw new Error(data.error||'军团跟踪操作失败')}
      await refresh()
    }catch(cause){setError(cause instanceof Error?cause.message:'军团跟踪操作失败')}finally{locked.current=false;setBusy(false)}
  }
  return <Context.Provider value={{claims,canManage,ready,busy,error,refresh:async()=>{setError('');await refresh()},mutate}}>{children}</Context.Provider>
}
export function GuildClaimLabel({serverId,legionName}:{serverId:string;legionName:string}) {
  const state=useContext(Context),claim=state?.claims.find(c=>c.serverId===serverId&&c.legionName===legionName)
  return <span>{!state?.ready?'归属待刷新':claim?claim.isMine?'我在跟踪':`${claim.ownerName} 跟踪中`:'未被跟踪'}</span>
}
export function GuildTrackingButton({serverId,legionName}:{serverId:string;legionName:string}) {
  const state=useContext(Context),[release,setRelease]=useState<GuildClaim|null>(null)
  if(!state)return null
  const claim=state.claims.find(c=>c.serverId===serverId&&c.legionName===legionName)
  const occupied=!!claim&&!claim.isMine
  return <div className="guild-tracking-actions"><GuildClaimLabel serverId={serverId} legionName={legionName}/>
    <button className="secondary-button" disabled={!state.ready||state.busy||occupied} onClick={()=>claim?setRelease(claim):void state.mutate({action:'claim',serverId,legionName,version:0})}>{claim?occupied?'已由其他客服跟踪':'取消军团跟踪':'跟踪军团'}</button>
    {occupied&&state.canManage&&<button className="secondary-button" disabled={!state.ready||state.busy} onClick={()=>setRelease(claim!)}>管理员释放</button>}
    {release&&<div className="guild-release-confirm"><p>确认释放「{legionName}」的军团跟踪？当前跟踪人：{release.ownerName}。释放后其他客服可以接手，成员个人跟踪不变。</p><button className="secondary-button" disabled={state.busy} onClick={()=>setRelease(null)}>返回</button><button className="secondary-button" disabled={state.busy} onClick={()=>{const expected=release;setRelease(null);void state.mutate({action:'release',serverId,legionName,version:expected.version})}}>确认释放</button></div>}
  </div>
}
export function GuildTrackingSummary({onSelect}:{onSelect:(claim:GuildClaim)=>void}) {
  const state=useContext(Context),[open,setOpen]=useState(false)
  if(!state)return null
  const claims=state.canManage?state.claims:state.claims.filter(c=>c.isMine)
  return <div className="guild-tracking-summary"><div className="intel-controls"><button className="secondary-button" aria-expanded={open} onClick={()=>setOpen(!open)}>{state.canManage?'军团跟踪管理':'我的军团跟踪'}（{state.ready?claims.length:'…'}）</button><span>军团与成员分别跟踪；同一军团仅一名客服负责。</span></div>
    {state.error&&<p role="alert">{state.error}<button className="secondary-button" onClick={()=>void state.refresh()}>刷新归属</button></p>}
    {open&&<div>{!claims.length&&<p>暂无军团跟踪记录。</p>}{claims.map(c=><div className="intel-member" key={JSON.stringify([c.serverId,c.legionName])}><button className="utility-link" onClick={()=>onSelect(c)}>{c.legionName} · {aion2ServerName(c.serverId)||c.serverId}</button><GuildTrackingButton serverId={c.serverId} legionName={c.legionName}/></div>)}</div>}
  </div>
}
