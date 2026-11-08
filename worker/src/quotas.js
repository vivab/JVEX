/**
 * JVEX anonymous quotas (Cloudflare SQLite Durable Object).
 * Free is the only active plan until account identity and payments exist.
 * All counters use UTC dates and are enforced server-side.
 */
export const PLANS = Object.freeze([
  {id:"free",title:"JVEX Free",chat:20,code:3,active:true},
  {id:"plus",title:"JVEX Plus",chat:100,code:20,active:false},
  {id:"pro",title:"JVEX Pro",chat:300,code:60,active:false},
  {id:"premium",title:"JVEX Premium",chat:1000,code:250,active:false},
  {id:"code",title:"JVEX Code",chat:40,code:200,active:false}
]);
export const FREE_PLAN = PLANS[0];
export const DEFAULT_GLOBAL = Object.freeze({chat:300,code:45});
export const DEFAULT_MINUTE_LIMIT=4;
export function utcDay(date=new Date()){return date.toISOString().slice(0,10)}
export function quotaVerdict(used,globalUsed,minuteUsed,lane,globalMax,minuteMax=DEFAULT_MINUTE_LIMIT){
  const per=FREE_PLAN[lane];
  if(!["chat","code"].includes(lane))return {allowed:false,reason:"invalid"};
  if(used>=per)return {allowed:false,reason:"user",retryAfter:60};
  if(globalUsed>=globalMax)return {allowed:false,reason:"global",retryAfter:300};
  if(minuteUsed>=minuteMax)return {allowed:false,reason:"burst",retryAfter:60};
  return {allowed:true};
}
function integerLimit(v,fallback){const n=Number(v);return Number.isSafeInteger(n)&&n>0&&n<100000? n:fallback}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}})}
/* One named object owns the global and per-IP counters so concurrent requests cannot overspend.
   SQL transactions are synchronous, atomic and persisted in SQLite storage. */
export class QuotaGuard {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;
    this.sql=ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, subject TEXT NOT NULL, lane TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,subject,lane))");
    this.lastCleanup="";
  }
  row(day,subject,lane){return Number(this.sql.exec("SELECT hits FROM usage WHERE day = ? AND subject = ? AND lane = ?",day,subject,lane).toArray()[0]?.hits||0)}
  increment(day,subject,lane){
    this.sql.exec("INSERT INTO usage(day,subject,lane,hits) VALUES(?,?,?,1) ON CONFLICT(day,subject,lane) DO UPDATE SET hits = hits + 1",day,subject,lane);
  }
  refund(day,subject,lane){
    this.sql.exec("UPDATE usage SET hits = MAX(0,hits - 1) WHERE day=? AND subject=? AND lane=?",day,subject,lane);
  }
  snapshot(day,id){
    return {
      plan:"free",
      date:day,
      limits:{chat:FREE_PLAN.chat,code:FREE_PLAN.code},
      used:{chat:this.row(day,id,"chat"),code:this.row(day,id,"code")},
      globalRemaining:{
        chat:Math.max(0,integerLimit(this.env.MAX_GLOBAL_CHAT,DEFAULT_GLOBAL.chat)-this.row(day,"__global__","chat")),
        code:Math.max(0,integerLimit(this.env.MAX_GLOBAL_CODE,DEFAULT_GLOBAL.code)-this.row(day,"__global__","code"))
      },
      resetAt:new Date(Date.parse(day+"T00:00:00Z")+86400000).toISOString()
    };
  }
  async fetch(request){
    if(request.method!=="POST")return response({error:"Not allowed"},405);
    let input;try{input=await request.json()}catch{return response({error:"Invalid input"},400)}
    const {action,id,lane}=input||{},day=utcDay();
    if(!/^[a-f0-9]{64}$/.test(id||""))return response({error:"Invalid identity"},400);
    if(!["status","reserve","refund"].includes(action))return response({error:"Invalid action"},400);
    if(action!=="status"&&!["chat","code"].includes(lane))return response({error:"Invalid lane"},400);
    // Keep at most a short interval of hashed identifiers; no raw IP addresses retained.
    if(this.lastCleanup!==day){
      const oldest=utcDay(new Date(Date.parse(day+"T00:00:00Z")-2*86400000));
      this.sql.exec("DELETE FROM usage WHERE day < ?",oldest);
      this.lastCleanup=day;
    }
    let verdict;
    try{
      verdict=this.ctx.storage.transactionSync(()=>{
        if(action==="status")return {allowed:true};
        if(action==="refund"){
          this.refund(day,id,lane);this.refund(day,"__global__",lane);
          return {allowed:true};
        }
        const minute=new Date().toISOString().slice(0,16);
        const globalMax=integerLimit(lane==="chat"?this.env.MAX_GLOBAL_CHAT:this.env.MAX_GLOBAL_CODE,DEFAULT_GLOBAL[lane]);
        const decision=quotaVerdict(this.row(day,id,lane),this.row(day,"__global__",lane),this.row(day,id,"minute:"+minute),lane,globalMax,integerLimit(this.env.MAX_REQUESTS_PER_MINUTE,DEFAULT_MINUTE_LIMIT));
        if(!decision.allowed)return decision;
        this.increment(day,id,lane);this.increment(day,"__global__",lane);this.increment(day,id,"minute:"+minute);
        return {allowed:true};
      });
    }catch(e){return response({error:"Quota storage failed"},503)}
    return response({...verdict,...this.snapshot(day,id)});
  }
}
