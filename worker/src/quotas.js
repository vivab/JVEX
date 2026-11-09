/**
 * JVEX public anonymous Free quotas, enforced atomically in a SQLite Durable Object.
 * Chat: UTC day. Code: five hours from first code request in that session.
 * The global provider-safety quota is separate and continues to reset daily.
 */
export const CODE_WINDOW_MS = 5 * 60 * 60 * 1000;
export const PLANS = Object.freeze([
  {id:"free",title:"JVEX Free",chat:60,code:10,active:true},
  {id:"plus",title:"JVEX Plus",chat:100,code:20,active:false},
  {id:"pro",title:"JVEX Pro",chat:300,code:60,active:false},
  {id:"premium",title:"JVEX Premium",chat:1000,code:250,active:false},
  {id:"code",title:"JVEX Code",chat:40,code:200,active:false}
]);
export const FREE_PLAN = PLANS[0];
export const DEFAULT_GLOBAL = Object.freeze({chat:600,code:150});
export const DEFAULT_MINUTE_LIMIT = 4;
export function utcDay(date=new Date()){return date.toISOString().slice(0,10)}
export function nextUtcMidnight(date=new Date()){
  const time=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1);
  return new Date(time).toISOString();
}
export function quotaVerdict(used,globalUsed,minuteUsed,lane,globalMax,minuteMax=DEFAULT_MINUTE_LIMIT){
  if(!["chat","code"].includes(lane))return {allowed:false,reason:"invalid"};
  if(used>=FREE_PLAN[lane])return {allowed:false,reason:"user"};
  if(globalUsed>=globalMax)return {allowed:false,reason:"global"};
  if(minuteUsed>=minuteMax)return {allowed:false,reason:"burst"};
  return {allowed:true};
}
function limit(input,fallback){const n=Number(input);return Number.isSafeInteger(n)&&n>0&&n<=100000?n:fallback}
function reply(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{"Content-Type":"application/json"}})}
export class QuotaGuard {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;this.sql=ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, subject TEXT NOT NULL, lane TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,subject,lane))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS code_windows (subject TEXT PRIMARY KEY, started_ms INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0)");
    this.cleanupDay="";
  }
  count(day,subject,lane){
    return Number(this.sql.exec("SELECT hits FROM usage WHERE day=? AND subject=? AND lane=?",day,subject,lane).toArray()[0]?.hits||0);
  }
  bump(day,subject,lane){
    this.sql.exec("INSERT INTO usage(day,subject,lane,hits) VALUES(?,?,?,1) ON CONFLICT(day,subject,lane) DO UPDATE SET hits=hits+1",day,subject,lane);
  }
  subtract(day,subject,lane){
    this.sql.exec("UPDATE usage SET hits=MAX(0,hits-1) WHERE day=? AND subject=? AND lane=?",day,subject,lane);
  }
  codeWindow(subject,now){
    const row=this.sql.exec("SELECT started_ms,hits FROM code_windows WHERE subject=?",subject).toArray()[0];
    if(!row||now>=Number(row.started_ms)+CODE_WINDOW_MS)return null;
    return {started:Number(row.started_ms),hits:Number(row.hits)};
  }
  rollover(subject,now){
    this.sql.exec("INSERT INTO code_windows(subject,started_ms,hits) VALUES(?,?,1) ON CONFLICT(subject) DO UPDATE SET started_ms=excluded.started_ms,hits=1",subject,now);
  }
  incrementCode(subject){
    this.sql.exec("UPDATE code_windows SET hits=hits+1 WHERE subject=?",subject);
  }
  refundCode(subject,now){
    const window=this.codeWindow(subject,now);
    if(window){
      if(window.hits<=1)this.sql.exec("DELETE FROM code_windows WHERE subject=?",subject);
      else this.sql.exec("UPDATE code_windows SET hits=hits-1 WHERE subject=?",subject);
    }
  }
  snapshot(day,id,now){
    const code=this.codeWindow(id,now),chatUsed=this.count(day,id,"chat"),codeUsed=code?.hits||0;
    return {
      plan:"free",date:day,limits:{chat:FREE_PLAN.chat,code:FREE_PLAN.code},
      periods:{chat:"day",code:"5h"},
      used:{chat:chatUsed,code:codeUsed},
      remaining:{chat:Math.max(0,FREE_PLAN.chat-chatUsed),code:Math.max(0,FREE_PLAN.code-codeUsed)},
      resetAt:{chat:nextUtcMidnight(new Date(now)),code:code?new Date(code.started+CODE_WINDOW_MS).toISOString():null},
      globalRemaining:{
        chat:Math.max(0,limit(this.env.MAX_GLOBAL_CHAT,DEFAULT_GLOBAL.chat)-this.count(day,"__global__","chat")),
        code:Math.max(0,limit(this.env.MAX_GLOBAL_CODE,DEFAULT_GLOBAL.code)-this.count(day,"__global__","code"))
      }
    };
  }
  async fetch(request){
    if(request.method!=="POST")return reply({error:"Method not allowed"},405);
    let input;try{input=await request.json()}catch{return reply({error:"Invalid JSON"},400)}
    const {action,id,lane}=input||{};
    if(!/^[0-9a-f]{64}$/.test(id||""))return reply({error:"Invalid identity"},400);
    if(!["status","reserve","refund"].includes(action))return reply({error:"Invalid action"},400);
    if(action!=="status"&&!["chat","code"].includes(lane))return reply({error:"Invalid lane"},400);
    const now=Date.now(),day=utcDay(new Date(now)),minute=new Date(now).toISOString().slice(0,16);
    if(this.cleanupDay!==day){
      try{
        const earliest=utcDay(new Date(now-2*86400000));
        this.sql.exec("DELETE FROM usage WHERE day < ?",earliest);
        this.sql.exec("DELETE FROM code_windows WHERE started_ms < ?",now-2*CODE_WINDOW_MS);
        this.cleanupDay=day;
      }catch{return reply({error:"Quota cleanup failed"},503)}
    }
    let decision;
    try{
      decision=this.ctx.storage.transactionSync(()=>{
        if(action==="status")return {allowed:true};
        if(action==="refund"){
          if(lane==="code")this.refundCode(id,now);
          else this.subtract(day,id,"chat");
          this.subtract(day,"__global__",lane);
          return {allowed:true};
        }
        const window=lane==="code"?this.codeWindow(id,now):null;
        const used=lane==="code"?(window?.hits||0):this.count(day,id,"chat");
        const globalLimit=limit(lane==="code"?this.env.MAX_GLOBAL_CODE:this.env.MAX_GLOBAL_CHAT,DEFAULT_GLOBAL[lane]);
        const minLimit=limit(this.env.MAX_REQUESTS_PER_MINUTE,DEFAULT_MINUTE_LIMIT);
        const verdict=quotaVerdict(used,this.count(day,"__global__",lane),this.count(day,id,"minute:"+minute),lane,globalLimit,minLimit);
        if(!verdict.allowed){
          const wait=verdict.reason==="user"&&lane==="code"&&window?window.started+CODE_WINDOW_MS-now:
            verdict.reason==="burst"?60000:Date.parse(nextUtcMidnight(new Date(now)))-now;
          return {...verdict,retryAfter:Math.max(1,Math.ceil(wait/1000))};
        }
        if(lane==="code"){
          if(window)this.incrementCode(id);else this.rollover(id,now);
        }else this.bump(day,id,"chat");
        this.bump(day,"__global__",lane);
        this.bump(day,id,"minute:"+minute);
        return {allowed:true};
      });
    }catch{return reply({error:"Quota transaction failed"},503)}
    return reply({...decision,...this.snapshot(day,id,now)});
  }
}
