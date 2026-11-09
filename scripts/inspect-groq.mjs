// JVEX model inventory: lists available Groq model IDs with no secrets in logs.
// Makes ONE small completion request to 20B to inspect provider rate-limit headers.
const key=process.env.GROQ_API_KEY;
if(!key){console.error("GROQ_API_KEY is missing");process.exit(1)}
const fetchWithTimeout=async(url,opts={})=>fetch(url,{...opts,signal:AbortSignal.timeout(30000)});
const headers={Authorization:"Bearer "+key,"Content-Type":"application/json"};
const inv=await fetchWithTimeout("https://api.groq.com/openai/v1/models",{headers});
const body=await inv.json().catch(()=>({}));
if(!inv.ok){console.error("Model catalog HTTP "+inv.status+" "+String(body?.error?.message||"").slice(0,140));process.exit(1)}
const models=(body.data||[]).map(m=>({id:m.id,owned_by:m.owned_by||"",context_window:m.context_window||null,active:m.active!==false})).sort((a,b)=>a.id.localeCompare(b.id));
console.log("=== JVEX GROQ MODEL INVENTORY ===");
console.log(JSON.stringify(models,null,2));
console.log("AVAILABLE_MODEL_COUNT="+models.length);
const preferred=["openai/gpt-oss-20b","openai/gpt-oss-120b","qwen/qwen3.8-27b"];
const id=preferred.find(id=>models.some(m=>m.id===id&&m.active));
if(id){
 try{
   const response=await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers,body:JSON.stringify({model:id,messages:[{role:"user",content:"Reply OK"}],max_completion_tokens:40})});
   console.log("=== GROQ HTTP RATE LIMIT HEADERS (model "+id+") ===");
   for(const name of ["x-ratelimit-limit-requests","x-ratelimit-remaining-requests","x-ratelimit-reset-requests","x-ratelimit-limit-tokens","x-ratelimit-remaining-tokens","retry-after"]){
      const val=response.headers.get(name);if(val)console.log(name+": "+val);
   }
   console.log("PROBE_STATUS="+response.status);
   if(!response.ok){const err=await response.json().catch(()=>({}));console.log("PROBE_REASON="+String(err?.error?.message||"Unavailable").slice(0,180))}
 }catch(e){console.log("PROBE_ERROR="+String(e?.name||"Error"))}
}
