import {test} from "node:test";
import assert from "node:assert/strict";
import app,{githubRepositoryFromMessages,groqCandidates} from "../src/index.js";
import {QuotaGuard,PLANS,CODE_WINDOW_MS,quotaVerdict} from "../src/quotas.js";
import {estimateCost,taskLabel} from "../src/complexity.js";
const person="a".repeat(64);
const baseEnv={ALLOWED_ORIGIN:"https://vivab.github.io",QUOTA_SALT:"test-unique-salt-for-quota"};
function mockQuota(){
  const counts={chat:0,code:0};
  return {
    counts,
    idFromName:()=>({}),
    get:()=>({fetch:async(_url,options)=>{
      const {action,lane,units=1}=JSON.parse(options.body);
      if(action==="reserve"&&counts[lane]+units>({chat:60,code:10}[lane]))return Response.json({allowed:false,reason:"user",remaining:{chat:60-counts.chat,code:10-counts.code},limits:{chat:60,code:10}});
      if(action==="reserve")counts[lane]+=units;
      if(action==="refund")counts[lane]=Math.max(0,counts[lane]-units);
      return Response.json({allowed:true,cost:units,limits:{chat:60,code:10},remaining:{chat:60-counts.chat,code:10-counts.code},used:{...counts},resetAt:{chat:"2026-11-10T00:00:00Z",code:null}});
    }})
  };
}
const useEnv=(keys={},quota=mockQuota())=>({...baseEnv,QUOTA_GUARD:quota,...keys});
const request=(messages,extra={})=>new Request("https://jvex-api.example.workers.dev/api/chat",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"203.0.113.8",Origin:"https://vivab.github.io"},body:JSON.stringify({messages,search:"off",...extra})});
const msgs=[{role:"user",content:"Привет JVEX"}];
async function fakeFetch(handler,task){const old=globalThis.fetch;globalThis.fetch=handler;try{return await task()}finally{globalThis.fetch=old}}
test("health does not reveal API keys",async()=>{
  const r=await app.fetch(new Request("https://x/api/health"),useEnv({GROQ_API_KEY:"SECRET"}));
  assert.equal(r.status,200);
  let data=await r.json();assert.equal(data.ok,true);assert.equal(data.configured,true);assert.equal(JSON.stringify(data).includes("SECRET"),false);
});
test("CORS origin is restricted to configured GitHub Pages",async()=>{
  const r=await app.fetch(new Request("https://x/api/chat",{method:"OPTIONS",headers:{Origin:"https://vivab.github.io"}}),useEnv());
  assert.equal(r.status,204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"),"https://vivab.github.io");
});
test("plans are public but only Free is active",async()=>{
  const r=await app.fetch(new Request("https://x/api/plans"),useEnv());
  assert.equal(r.status,200);const data=await r.json();
  assert.deepEqual(data.plans.map(x=>x.id),["free","plus","pro","premium","code"]);
  assert.equal(data.plans.filter(x=>x.active).length,1);
});
test("missing Cloudflare identity fails closed",async()=>{
  const r=await app.fetch(new Request("https://x/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:msgs})}),useEnv({GROQ_API_KEY:"test"}));
  assert.equal(r.status,503);
});
test("unauthenticated usage endpoint works with IP-derived identity",async()=>{
  const q=mockQuota();
  const r=await app.fetch(new Request("https://x/api/usage",{headers:{"CF-Connecting-IP":"203.0.113.8"}}),useEnv({},q));
  assert.equal(r.status,200);
  assert.equal((await r.json()).remaining.code,10);
});
test("no model key fails without consuming quota",async()=>{
  const q=mockQuota(),r=await app.fetch(request(msgs),useEnv({},q));
  assert.equal(r.status,503);assert.equal(q.counts.chat,0);
});
test("Groq responds and receives complete message history",async()=>{
  const q=mockQuota();let sent;
  await fakeFetch(async(url,opts)=>{assert.match(String(url),/groq/);sent=JSON.parse(opts.body);return Response.json({model:"openai/gpt-oss-120b",choices:[{message:{content:"Ответ JVEX"}}]})},async()=>{
    const input=[{role:"user",content:"Hello"},{role:"assistant",content:"Hi"},{role:"user",content:"Continue"}];
    const r=await app.fetch(request(input),useEnv({GROQ_API_KEY:"fake"},q));
    assert.equal(r.status,200);assert.match((await r.json()).answer,/Ответ/);
  });
  assert.equal(sent.messages.filter(m=>m.role==="user").length,2);
  assert.equal(q.counts.chat,1);
});
test("fallback after 429 moves to OpenRouter and preserves quota",async()=>{
  const q=mockQuota();const urls=[];
  await fakeFetch(async url=>{urls.push(String(url));return String(url).includes("groq")?
    Response.json({error:{message:"rate limit"}},{status:429}):
    Response.json({model:"free",choices:[{message:{content:"Готово"}}]});},async()=>{
    const r=await app.fetch(request(msgs),useEnv({GROQ_API_KEY:"fake",OPENROUTER_API_KEY:"fake"},q));
    assert.equal(r.status,200);assert.match((await r.json()).model,/OpenRouter/);
  });
  assert.equal(urls.length,4);assert.equal(q.counts.chat,1);
});
test("photo enters Gemini as inline image",async()=>{
  let payload;
  await fakeFetch(async(url,options)=>{payload=JSON.parse(options.body);return Response.json({candidates:[{content:{parts:[{text:"Фотография"}]}}]})},async()=>{
    const r=await app.fetch(request([{role:"user",content:"Что здесь?",image:"data:image/jpeg;base64,SGVsbG8="}]),useEnv({GEMINI_API_KEY:"fake"}));
    assert.equal(r.status,200);assert.equal((await r.json()).answer,"Фотография");
  });
  assert.equal(payload.contents[0].parts[1].inline_data.mime_type,"image/jpeg");
});
test("Gemini grounding first for time-sensitive search",async()=>{
  let first;
  await fakeFetch(async(url,options)=>{first=String(url);assert.ok(JSON.parse(options.body).tools[0].google_search);return Response.json({candidates:[{content:{parts:[{text:"Новости"}]},groundingMetadata:{groundingChunks:[{web:{uri:"https://example.com",title:"Новости"}}]}}]})},async()=>{
    const r=await app.fetch(request([{role:"user",content:"Новости сегодня"}],{search:"auto"}),useEnv({GEMINI_API_KEY:"fake",GROQ_API_KEY:"fake"}));
    assert.equal(r.status,200);assert.equal((await r.json()).searched,true);
  });
  assert.match(first,/generativelanguage/);
});
test("Code lane uses separate quota",async()=>{
  const q=mockQuota();await fakeFetch(async()=>Response.json({model:"free",choices:[{message:{content:"код"}}]}),async()=>{
    const r=await app.fetch(request(msgs,{mode:"code"}),useEnv({GROQ_API_KEY:"fake"},q));
    assert.equal(r.status,200);
  });assert.equal(q.counts.code,1);assert.equal(q.counts.chat,0);
});
test("Free plan respects 60 chat and 10 code slots",()=>{
  assert.equal(quotaVerdict(60,0,0,"chat",600).reason,"user");
  assert.equal(quotaVerdict(10,0,0,"code",150).reason,"user");
  assert.equal(quotaVerdict(9,0,0,"code",150).allowed,true);
  assert.equal(CODE_WINDOW_MS,18000000);
  assert.equal(PLANS.length,5);
});
class SqlMock {
  constructor(){this.usage=new Map();this.windows=new Map()}
  exec(sql,...args){
    if(sql.startsWith("CREATE TABLE"))return {toArray:()=>[]};
    if(sql.startsWith("SELECT hits FROM usage"))return {toArray:()=>[{hits:this.usage.get(args.join("|"))||0}]};
    if(sql.startsWith("SELECT started_ms,hits FROM code_windows")){
      const w=this.windows.get(args[0]);return {toArray:()=>w?[{started_ms:w.start,hits:w.hits}]:[]};
    }
    if(sql.startsWith("INSERT INTO usage")){
      const k=args.slice(0,3).join("|");this.usage.set(k,(this.usage.get(k)||0)+args[3]);return {toArray:()=>[]};
    }
    if(sql.startsWith("UPDATE usage SET hits=MAX")){
      const k=args.slice(1).join("|");this.usage.set(k,Math.max(0,(this.usage.get(k)||0)-args[0]));return {toArray:()=>[]};
    }
    if(sql.startsWith("INSERT INTO code_windows")){
      this.windows.set(args[0],{start:args[1],hits:args[2]});return {toArray:()=>[]};
    }
    if(sql.startsWith("UPDATE code_windows SET hits=hits+")){
      this.windows.get(args[1]).hits+=args[0];return {toArray:()=>[]};
    }
    if(sql.startsWith("UPDATE code_windows SET hits=MAX")){
      this.windows.get(args[1]).hits=Math.max(0,this.windows.get(args[1]).hits-args[0]);return {toArray:()=>[]};
    }
    if(sql.startsWith("DELETE FROM code_windows WHERE subject=")){
      this.windows.delete(args[0]);return {toArray:()=>[]};
    }
    if(sql.startsWith("DELETE FROM code_windows WHERE started_ms")){
      for(const [id,w] of this.windows)if(w.start<args[0])this.windows.delete(id);
      return {toArray:()=>[]};
    }
    if(sql.startsWith("DELETE FROM usage WHERE day <")){
      for(const key of this.usage.keys())if(key.split("|")[0]<args[0])this.usage.delete(key);
      return {toArray:()=>[]};
    }
    throw Error("Unknown mock SQL: "+sql);
  }
}
const action=(guard,name,lane)=>guard.fetch(new Request("https://quota.internal/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:person,action:name,lane})}));
test("Code reset is exactly five hours after first successful request, not at midnight",async()=>{
  const sql=new SqlMock(),ctx={storage:{sql,transactionSync:fn=>fn()}},guard=new QuotaGuard(ctx,{MAX_GLOBAL_CODE:"30"});
  const original=Date.now,initial=Date.UTC(2026,10,9,22,55);
  try{
    Date.now=()=>initial;
    const first=await (await action(guard,"reserve","code")).json();
    assert.equal(first.used.code,1);
    assert.equal(first.resetAt.code,new Date(initial+CODE_WINDOW_MS).toISOString());
    for(let i=1;i<10;i++){Date.now=()=>initial+i*61000;assert.equal((await (await action(guard,"reserve","code")).json()).allowed,true)}
    assert.equal((await (await action(guard,"reserve","code")).json()).reason,"user");
    Date.now=()=>initial+60*60*1000; // after UTC midnight but not five hours
    assert.equal((await (await action(guard,"reserve","code")).json()).reason,"user");
    Date.now=()=>initial+CODE_WINDOW_MS;
    const refreshed=await (await action(guard,"reserve","code")).json();
    assert.equal(refreshed.allowed,true);assert.equal(refreshed.used.code,1);
    assert.equal(refreshed.remaining.code,9);
  }finally{Date.now=original}
});
test("Chat slots reset at UTC midnight independently of Code",async()=>{
  const sql=new SqlMock(),guard=new QuotaGuard({storage:{sql,transactionSync:fn=>fn()}},{});
  const original=Date.now,start=Date.UTC(2026,10,9,23,59);
  try{
    Date.now=()=>start;
    await action(guard,"reserve","chat");
    await action(guard,"reserve","code");
    Date.now=()=>start+120000;
    const status=await (await action(guard,"status")).json();
    assert.equal(status.used.chat,0);
    assert.equal(status.used.code,1);
  }finally{Date.now=original}
});


test("JVEX Code picks up a direct GitHub URL from chat",()=>{
  assert.equal(githubRepositoryFromMessages([{role:"user",content:"Посмотри https://github.com/vivab/JVEX"}]),"vivab/JVEX");
});
test("JVEX Code accepts GitHub file links, .git URLs, and trailing punctuation",()=>{
  assert.equal(githubRepositoryFromMessages([{role:"user",content:"Исправь https://github.com/vivab/Game1/blob/main/index.html."}]),"vivab/Game1");
  assert.equal(githubRepositoryFromMessages([{role:"user",content:"https://github.com/vivab/JVEX.git"}]),"vivab/JVEX");
});
test("JVEX Code remembers latest repository from earlier user messages",()=>{
  const history=[{role:"user",content:"https://github.com/example/first"},{role:"assistant",content:"Готов изучить"},{role:"user",content:"https://github.com/vivab/JVEX"},{role:"user",content:"А теперь проверь ошибки"}];
  assert.equal(githubRepositoryFromMessages(history),"vivab/JVEX");
});
test("JVEX Code ignores arbitrary URLs and fake github hostnames",()=>{
  assert.equal(githubRepositoryFromMessages([{role:"user",content:"https://notgithub.com/a/b"}]),null);
  assert.equal(githubRepositoryFromMessages([{role:"user",content:"https://example.org/vivab/JVEX"}]),null);
});

test("Groq auto fallback orders text-capable models by task",()=>{
 assert.deepEqual(groqCandidates("chat","auto"),["openai/gpt-oss-20b","qwen/qwen3.8-27b","openai/gpt-oss-120b"]);
 assert.deepEqual(groqCandidates("code","auto"),["qwen/qwen3.8-27b","openai/gpt-oss-120b","openai/gpt-oss-20b"]);
 assert.equal(groqCandidates("chat","qwen/qwen3.8-27b")[0],"qwen/qwen3.8-27b");
 assert.equal(groqCandidates("chat","untrusted-paid-model")[0],"openai/gpt-oss-20b");
});
test("Groq 429 falls back to another Groq model before using other providers",async()=>{
 const tried=[];
 await fakeFetch(async(url,opts)=>{
   const body=JSON.parse(opts.body);tried.push(body.model);
   if(tried.length===1)return Response.json({error:{message:"limited"}},{status:429});
   return Response.json({model:body.model,choices:[{message:{content:"Fallback model working"}}]});
 },async()=>{
   const r=await app.fetch(request(msgs),useEnv({GROQ_API_KEY:"fake"}));
   assert.equal(r.status,200);assert.match((await r.json()).answer,/Fallback model/);
 });
 assert.deepEqual(tried,["openai/gpt-oss-20b","qwen/qwen3.8-27b"]);
});

test("Complexity charges are predictable and task-specific",()=>{
 assert.equal(estimateCost({mode:"chat",text:"Привет"}),1);
 assert.equal(estimateCost({mode:"chat",text:"Что на фото?",image:true}),2);
 assert.equal(estimateCost({mode:"code",text:"Что такое JavaScript?"}),1);
 assert.equal(estimateCost({mode:"code",text:"Исправь ошибку в коде"}),2);
 assert.equal(estimateCost({mode:"code",text:"Создай полноценную игру с нуля"}),3);
 assert.equal(taskLabel({mode:"code",text:"Сделай игру"}),"Пишу код для игры…");
 assert.equal(quotaVerdict(8,0,0,"code",150,4,3).reason,"user");
 assert.equal(quotaVerdict(7,0,0,"code",150,4,3).allowed,true);
});
test("Code task uses server-computed 3 units even if browser asks for 1",async()=>{
 const q=mockQuota();
 await fakeFetch(async()=>Response.json({model:"openai/gpt-oss-120b",choices:[{message:{content:"Готовый код"}}]}),async()=>{
   const r=await app.fetch(request([{role:"user",content:"Создай полноценную игру с нуля"}],{mode:"code",cost:1}),useEnv({GROQ_API_KEY:"fake"},q));
   assert.equal(r.status,200);
   const data=await r.json();
   assert.equal(data.cost,3);
   assert.equal(data.usage.remaining.code,7);
   assert.equal(q.counts.code,3);
 });
});
test("Failed complex Code request refunds all units",async()=>{
 const q=mockQuota();
 await fakeFetch(async()=>Response.json({error:{message:"rate limit"}},{status:429}),async()=>{
   const r=await app.fetch(request([{role:"user",content:"Создай полноценную игру с нуля"}],{mode:"code"}),useEnv({GROQ_API_KEY:"fake"},q));
   assert.equal(r.status,503);
 });
 assert.equal(q.counts.code,0);
});
test("SQLite quota rejects a three-unit task when only two remain",async()=>{
 const sql=new SqlMock(),guard=new QuotaGuard({storage:{sql,transactionSync:fn=>fn()}},{});
 const now=Date.now();const old=Date.now;
 try{
   Date.now=()=>now;
   for(let i=0;i<8;i++){Date.now=()=>now+i*61000;const taken=await guard.fetch(new Request("https://quota.internal/action",{method:"POST",body:JSON.stringify({id:person,action:"reserve",lane:"code",units:1})}));assert.equal((await taken.json()).allowed,true)}
   Date.now=()=>now+8*61000;
   const r=await guard.fetch(new Request("https://quota.internal/action",{method:"POST",body:JSON.stringify({id:person,action:"reserve",lane:"code",units:3})}));
   const data=await r.json();
   assert.equal(data.allowed,false);assert.equal(data.reason,"user");assert.equal(data.remaining.code,2);
   const ok=await guard.fetch(new Request("https://quota.internal/action",{method:"POST",body:JSON.stringify({id:person,action:"reserve",lane:"code",units:2})}));
   assert.equal((await ok.json()).remaining.code,0);
 }finally{Date.now=old}
});


test("Code auto mode sends its first real request to Qwen 3.8",async()=>{
 const seen=[];
 await fakeFetch(async(url,options)=>{
   const data=JSON.parse(options.body);seen.push({url:String(url),model:data.model});
   return Response.json({model:data.model,choices:[{message:{content:"Готовый код для 2D игры"}}]});
 },async()=>{
   const r=await app.fetch(request([{role:"user",content:"Сделай игру танки"}],{mode:"code",groqModel:"auto"}),useEnv({GROQ_API_KEY:"fake"}));
   assert.equal(r.status,200);
   assert.match((await r.json()).answer,/Готовый код/);
 });
 assert.equal(seen[0].model,"qwen/qwen3.8-27b");
});
test("Code Qwen rate limit falls back to GPT-OSS 120B",async()=>{
 const seen=[];
 await fakeFetch(async(url,options)=>{
   const data=JSON.parse(options.body);seen.push(data.model);
   if(seen.length===1)return Response.json({error:{message:"rate limit"}},{status:429});
   return Response.json({model:data.model,choices:[{message:{content:"Файл создан"}}]});
 },async()=>{
   const r=await app.fetch(request([{role:"user",content:"Напиши программу"}],{mode:"code",groqModel:"auto"}),useEnv({GROQ_API_KEY:"fake"}));
   assert.equal(r.status,200);
 });
 assert.deepEqual(seen,["qwen/qwen3.8-27b","openai/gpt-oss-120b"]);
});
test("Gemini is offered only when its secret is configured",async()=>{
 const simple=await app.fetch(new Request("https://example.com/api/health"),useEnv({GROQ_API_KEY:"test"}));
 const data=await simple.json();
 assert.equal(data.providers.groq,true);
 assert.equal(data.providers.gemini,false);
 assert.equal(data.routing.code,"qwen/qwen3.8-27b");
 const enabled=await app.fetch(new Request("https://example.com/api/health"),useEnv({GROQ_API_KEY:"test",GEMINI_API_KEY:"test"}));
 assert.equal((await enabled.json()).providers.gemini,true);
});
test("Gemini preference uses current Flash model and remains server-side",async()=>{
 let url;
 await fakeFetch(async(_url,options)=>{
   url=String(_url);
   return Response.json({candidates:[{content:{parts:[{text:"Ответ Gemini"}}]}]});
 },async()=>{
   const r=await app.fetch(request(msgs,{preference:"gemini"}),useEnv({GEMINI_API_KEY:"fake"}));
   assert.equal(r.status,200);
   assert.equal((await r.json()).answer,"Ответ Gemini");
 });
 assert.match(url,/gemini-3\.8-flash:generateContent/);
});
