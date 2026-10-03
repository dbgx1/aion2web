import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'
import { Scheduler, emptyState, defaults, nodeKey, sharedPortableClient, type State, type Node, type Result } from './core'

type Env = Cloudflare.Env & { WEBHOOK_TOKEN: string; ADMIN_TOKEN: string; MQTT_PUBLISH_URL: string; MQTT_API_KEY: string; MQTT_API_SECRET: string }
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const serverId = z.string().regex(/^[1-9][0-9]{0,4}$/).refine(value=>Number(value)<=65535)
const stateSchema = z.object({ clientId: id, sessionId: id, gameSessionId: id, serverId: serverId.nullable(), boot: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), ready: z.boolean(), cooldownMs: z.number().min(0).max(60000), batchSize: z.literal(50).optional() }).strict()
const eventSchema = z.object({ taskId: id, attemptId: id, gameSessionId: id, type: z.enum(['accepted','sent','completed','failed','rejected']), status: z.enum(['online','offline','unknown']).optional(), error: z.string().max(500).optional() }).strict()
const batchEventSchema = z.object({ type: z.literal('batch_completed'), batchId: id, gameSessionId: id, results: z.array(eventSchema.extend({ checkedAt: z.number().int().nonnegative().optional() })).min(1).max(50) }).strict()
// The EMQX rule must populate topic/clientid/username from broker metadata, not payload fields.
const webhookSchema = z.object({ topic: z.string().max(300), clientid: z.string().max(200), username: z.string().max(200), payload: z.union([z.string().max(32000), z.record(z.string(),z.unknown())]) })
async function boundedText(input: Request | Response, maximum: number) {
  const reader=input.body?.getReader();if(!reader)return ''
  const chunks:Uint8Array[]=[];let length=0
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maximum){await reader.cancel();throw new RangeError('Body too large')}chunks.push(value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}return new TextDecoder('utf-8',{fatal:true}).decode(bytes)
}
async function authorized(request: Request, secret: string) {
  if (!secret || secret.length < 32) return false
  const supplied = request.headers.get('authorization') ?? ''
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))
  const [a,b] = await Promise.all([hash(supplied),hash(`Bearer ${secret}`)])
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0
}
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname === '/health' && request.method==='GET') return Response.json({ok:true,service:'query-dispatch',configured:!!(env.WEBHOOK_TOKEN&&env.MQTT_PUBLISH_URL&&env.MQTT_API_KEY&&env.MQTT_API_SECRET)})
    const admin=url.pathname==='/status' && request.method==='GET'
    if (!admin && (url.pathname!=='/mqtt/events'||request.method!=='POST'))return new Response('Not found',{status:404})
    if (!await authorized(request,admin?env.ADMIN_TOKEN:env.WEBHOOK_TOKEN))return new Response('Unauthorized',{status:401})
    return env.POOL.getByName('unified-query-pool').fetch(request)
  },
} satisfies ExportedHandler<Env>

export class QueryPool extends DurableObject<Env> {
  private sequence: Promise<unknown> = Promise.resolve()
  private delivering = new Set<string>()
  constructor(ctx: DurableObjectState,env: Env) {
    super(ctx,env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS scheduler_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS device_fences (client_id TEXT PRIMARY KEY, boot INTEGER NOT NULL, session_id TEXT NOT NULL, seq INTEGER NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS portable_session_fences (identity TEXT PRIMARY KEY, boot INTEGER NOT NULL, session_id TEXT NOT NULL, seq INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
  }
  private serial<T>(action:()=>Promise<T>):Promise<T> {const run=this.sequence.then(action);this.sequence=run.catch(()=>{});return run}
  private load() {
    const row=this.ctx.storage.sql.exec<{payload:string}>('SELECT payload FROM scheduler_state WHERE id=1').toArray()[0]
    const state:State=row?JSON.parse(row.payload):emptyState()
    const configured=Number(this.env.DAILY_QUERY_LIMIT)
    return new Scheduler(state,{...defaults,dailyLimit:Number.isSafeInteger(configured)&&configured>0?Math.min(configured,1000000):defaults.dailyLimit})
  }
  private save(s:Scheduler) {
    const payload=JSON.stringify(s.state)
    if(new TextEncoder().encode(payload).length>1500000)throw new Error('Scheduler storage capacity reached')
    this.ctx.storage.sql.exec('INSERT INTO scheduler_state(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',payload)
  }
  private async reconcileCancelled(s:Scheduler) {
    const active=Object.values(s.state.requests).filter(r=>Object.keys(r.results).length<r.characters.length).map(r=>r.requestId)
    for(let offset=0;offset<active.length;offset+=80){
      const ids=active.slice(offset,offset+80)
      const rows=await this.env.DB.prepare(`SELECT id FROM presence_requests WHERE finished=1 AND id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<{id:string}>()
      for(const row of rows.results)s.cancel(row.id)
    }
  }
  async fetch(request:Request) {const response=await this.serial(async()=>{
    const scheduler=this.load()
    if(request.method==='GET')return Response.json({nodes:Object.values(scheduler.state.nodes).map(({clientId,serverId=null,ready,seenAt,attemptId})=>({clientId,serverId,ready:ready&&!!serverId&&Date.now()-seenAt<scheduler.limits.nodeStaleMs,seenAt,busy:!!attemptId})),queued:Object.keys(scheduler.state.jobs).length,deliveries:scheduler.state.outbox.length,dispatchedToday:scheduler.state.dispatched,dailyLimit:scheduler.limits.dailyLimit})
    if(Number(request.headers.get('content-length')??0)>40000)return new Response('Too large',{status:413})
    try {
      const text=await boundedText(request,40000)
      const hook=webhookSchema.parse(JSON.parse(text));const data=typeof hook.payload==='string'?JSON.parse(hook.payload):hook.payload
      const now=Date.now()
      let fence: {clientId:string;boot:number;sessionId:string;seq:number}|undefined
      if(hook.topic===`aion2/presence/${this.env.SERVICE_ID}/requests`){
        const requestId=id.parse(data.requestId)
        await this.reconcileCancelled(scheduler)
        const row=await this.env.DB.prepare('SELECT id,user_key,service_id,characters_json,expires_at,finished FROM presence_requests WHERE id=? AND service_id=?').bind(requestId,this.env.SERVICE_ID).first<{id:string;user_key:string;service_id:string;characters_json:string;expires_at:number;finished:number}>()
        const known=scheduler.state.requests[requestId]
        const completed=known && Object.keys(known.results).length===known.characters.length
        if(!row || row.expires_at<=now || (row.finished&&!completed)){this.save(scheduler);await this.schedule(scheduler);return new Response('Unknown, stopped or expired query',{status:410})}
        scheduler.submit({requestId:row.id,userKey:row.user_key,serviceId:row.service_id,expiresAt:row.expires_at,characters:JSON.parse(row.characters_json).map((p:{serverId:string;characterId:string})=>({serverId:p.serverId,characterId:p.characterId}))},now)
      }else{
        const match=/^aion2\/query-workers\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})\/(state|events)$/.exec(hook.topic)
        if(!match)return new Response('Unexpected topic',{status:400})
        const [,clientId,sessionId,kind]=match
        // Broker credentials and exact session topics remain authenticated.
        if(hook.username!==`query-${clientId}` || hook.clientid!==`query-${clientId}-${sessionId}`)return new Response('Device identity mismatch',{status:403})
        if(kind==='state'){
          const state=stateSchema.parse(data);if(state.clientId!==clientId||state.sessionId!==sessionId)return new Response('State identity mismatch',{status:403})
          const previous=clientId===sharedPortableClient
            ? this.ctx.storage.sql.exec<{boot:number;session_id:string;seq:number}>('SELECT boot,session_id,seq FROM portable_session_fences WHERE identity=?',nodeKey(clientId,sessionId)).toArray()[0]
            : this.ctx.storage.sql.exec<{boot:number;session_id:string;seq:number}>('SELECT boot,session_id,seq FROM device_fences WHERE client_id=?',clientId).toArray()[0]
          if(previous && (state.boot<previous.boot || (state.boot===previous.boot && (state.sessionId!==previous.session_id || state.seq<=previous.seq))))return Response.json({ok:true,ignored:true})
          scheduler.stateUpdate(state,now)
          fence=state
        }else if(data.type==='batch_completed') {
          const report=batchEventSchema.parse(data)
          scheduler.batchEvent(clientId,sessionId,report,now)
          scheduler.acknowledgeBatch(clientId,sessionId,report.batchId,now)
        }
        else scheduler.event(clientId,sessionId,eventSchema.parse(data),now)
      }
      scheduler.tick(now)
      this.ctx.storage.transactionSync(()=>{
        this.save(scheduler) // Persist lease and publish intent BEFORE network I/O.
        if(fence?.clientId===sharedPortableClient){
          this.ctx.storage.sql.exec('DELETE FROM portable_session_fences WHERE updated_at<?',now-86400000)
          this.ctx.storage.sql.exec('INSERT INTO portable_session_fences(identity,boot,session_id,seq,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET boot=excluded.boot,session_id=excluded.session_id,seq=excluded.seq,updated_at=excluded.updated_at',nodeKey(fence.clientId,fence.sessionId),fence.boot,fence.sessionId,fence.seq,now)
        }else if(fence)this.ctx.storage.sql.exec('INSERT INTO device_fences(client_id,boot,session_id,seq) VALUES(?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET boot=excluded.boot,session_id=excluded.session_id,seq=excluded.seq',fence.clientId,fence.boot,fence.sessionId,fence.seq)
      })
      await this.schedule(scheduler)
      return Response.json({ok:true})
    }catch(error){
      if(error instanceof RangeError)return new Response('Too large',{status:413})
      if(error instanceof SyntaxError || error instanceof z.ZodError || error instanceof TypeError)return new Response('Invalid event',{status:400})
      // Do not log credentials, player data, or untrusted payloads.
      console.error('query_dispatch_event_failed',error instanceof Error?error.name:'Error')
      return Response.json({ok:false,error:'Event rejected or dispatch unavailable'},{status:503})
    }
  });
    // External publication and result writes must not hold the scheduler lock:
    // a newer ready/completed event can arrive while the prior HTTP call waits.
    if(response.ok && request.method!=='GET')await this.deliver()
    return response
  }
  private async deliver() {
    let url:URL;try{url=new URL(this.env.MQTT_PUBLISH_URL)}catch{return}
    if(url.protocol!=='https:'||url.username||url.password||!this.env.MQTT_API_KEY||!this.env.MQTT_API_SECRET)return
    const batch=await this.serial(async()=>{
      const s=this.load()
      // Reserve separate capacity for tasks so slow result publication cannot
      // occupy every send slot. Reservation is process-local; the durable outbox
      // remains the recovery source after eviction/restart.
      const selected=[]
      for(const task of [true,false]){
        const matches=(d:typeof s.state.outbox[number])=>(['query_player_online','query_players_online','cancel_query_tasks'].includes(String(d.payload.type)))===task
        const busy=s.state.outbox.filter(d=>matches(d)&&this.delivering.has(d.id)).length
        selected.push(...s.state.outbox.filter(d=>matches(d)&&!this.delivering.has(d.id)).slice(0,Math.max(0,8-busy)))
      }
      for(const d of selected)this.delivering.add(d.id)
      return selected
    })
    if(!batch.length)return
    try {
    const delivered=await Promise.all(batch.map(async delivery=>{
      if(delivery.expiresAt<=Date.now())return delivery.id
      try{
        if(delivery.payload.type==='presence_result' && !delivery.resultsSaved){
          // Commit broker-authenticated evidence before browsers can receive it.
          // Retrying publication is safe: the first terminal result is immutable.
          const statements=(delivery.payload.results as Result[]).map(result=>this.env.DB.prepare(
            'INSERT OR IGNORE INTO presence_verified_results(request_id,server_id,character_id,status,checked_at) VALUES(?,?,?,?,?)'
          ).bind(delivery.payload.requestId,result.serverId,result.characterId,result.status,result.checkedAt))
          for(const result of delivery.payload.results as Result[]){
            statements.push(this.env.DB.prepare(`
              INSERT INTO character_presence(server_id,character_id,character_name,is_online,checked_at,updated_at,source_id)
              SELECT v.server_id,v.character_id,COALESCE(NULLIF(json_extract(p.value,'$.name'),''),v.character_id),
                CASE v.status WHEN 'online' THEN 1 WHEN 'offline' THEN 0 ELSE -1 END,v.checked_at,?,r.service_id
              FROM presence_verified_results v JOIN presence_requests r ON r.id=v.request_id,
                json_each(r.characters_json) p
              WHERE v.request_id=? AND v.server_id=? AND v.character_id=?
                AND CAST(json_extract(p.value,'$.serverId') AS TEXT)=v.server_id
                AND CAST(json_extract(p.value,'$.characterId') AS TEXT)=v.character_id
              ON CONFLICT(server_id,character_id) DO UPDATE SET
                character_name=excluded.character_name,is_online=excluded.is_online,
                checked_at=excluded.checked_at,updated_at=excluded.updated_at,source_id=excluded.source_id
              WHERE excluded.checked_at>character_presence.checked_at
                AND (excluded.is_online!=-1 OR character_presence.is_online=-1)
            `).bind(Date.now(),delivery.payload.requestId,result.serverId,result.characterId))
            statements.push(this.env.DB.prepare(`INSERT OR IGNORE INTO presence_request_results(request_id,server_id,character_id)
              SELECT request_id,server_id,character_id FROM presence_verified_results WHERE request_id=? AND server_id=? AND character_id=?`
            ).bind(delivery.payload.requestId,result.serverId,result.characterId))
          }
          statements.push(this.env.DB.prepare(`UPDATE presence_requests SET finished=1 WHERE id=? AND finished=0
            AND (SELECT COUNT(*) FROM presence_request_results WHERE request_id=?)>=json_array_length(characters_json)`
          ).bind(delivery.payload.requestId,delivery.payload.requestId))
          await this.env.DB.batch(statements)
          delivery.resultsSaved=true
        }
        const response=await fetch(url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(3000),headers:{'content-type':'application/json',authorization:`Basic ${btoa(`${this.env.MQTT_API_KEY}:${this.env.MQTT_API_SECRET}`)}`},body:JSON.stringify({topic:delivery.topic,payload:JSON.stringify(delivery.payload),qos:1,retain:false})})
        // EMQX returns 202 when there is NO matching subscriber. Keep that
        // delivery for bounded retry instead of silently losing the task/result.
        if(response.status!==200){await response.body?.cancel();return undefined}
        const body=JSON.parse(await boundedText(response,4096))
        if(typeof body.id==='string' && body.id.length>0)return delivery.id
      }catch{}
      return undefined
    }))
    await this.serial(async()=>{
      // Merge only delivery acknowledgements into the latest state. Never save
      // an old snapshot over tasks created while network I/O was in flight.
      const s=this.load()
      for(const d of batch)if(d.resultsSaved){const current=s.state.outbox.find(x=>x.id===d.id);if(current)current.resultsSaved=true}
      for(const id of delivered)if(id)s.acknowledgeDelivery(id)
      this.save(s)
      await this.schedule(s)
    })
    } finally {for(const d of batch)this.delivering.delete(d.id)}
  }
  private async schedule(s:Scheduler) {
    const now=Date.now();const times:number[]=[]
    if(s.state.outbox.length)times.push(now+5000)
    // Browser cancellation is persisted in D1. Poll only while requests remain
    // incomplete, including when no MQTT events arrive to wake this object.
    if(Object.values(s.state.requests).some(r=>Object.keys(r.results).length<r.characters.length))times.push(now+5000)
    for(const job of Object.values(s.state.jobs))if(job.attempt)times.push(job.attempt.leaseUntil)
    for(const r of Object.values(s.state.requests))times.push(r.expiresAt+(r.expiresAt<=now?10000:0))
    if(Object.values(s.state.jobs).some(j=>!j.attempt)&&s.state.dispatched<s.limits.dailyLimit){
      for(const n of Object.values(s.state.nodes) as Node[])if(n.ready&&n.serverId&&!n.attemptId&&n.nextAt>now&&now-n.seenAt<s.limits.nodeStaleMs)times.push(n.nextAt)
    }
    if(times.length){const at=Math.max(now+1000,Math.min(...times));const current=await this.ctx.storage.getAlarm();if(current===null||current<=now||current>at)await this.ctx.storage.setAlarm(at)}
    else await this.ctx.storage.deleteAlarm()
  }
  async alarm(){await this.serial(async()=>{const s=this.load();await this.reconcileCancelled(s);s.tick(Date.now());this.save(s);await this.schedule(s)});await this.deliver()}
}
