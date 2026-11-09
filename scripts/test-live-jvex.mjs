// Real end-to-end smoke test for the deployed PUBLIC JVEX API.
// This file contains no credentials. It checks Cloudflare quotas + Groq routing.
const base = "https://jvex-api.vivogaga12.workers.dev";
async function verify(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
  try{
    const health=await fetch(base+"/api/health",{signal:controller.signal});
    const h=await health.json();
    if(!health.ok||!h.ok||!h.configured)throw Error("Health check failed (HTTP "+health.status+")");
    console.log("JVEX API health: OK");
    const usage=await fetch(base+"/api/usage",{signal:controller.signal});
    if(!usage.ok)throw Error("Quota service failed (HTTP "+usage.status+")");
    const q=await usage.json();
    if(q.plan!=="free"||q.limits?.chat!==60||q.limits?.code!==10)throw Error("Free quota configuration incorrect");
    console.log("JVEX anonymous quota service: OK");
    const res=await fetch(base+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({messages:[{role:"user",content:"Привет! Ответь одним коротким предложением."}],mode:"chat",search:"off",preference:"groq"})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||typeof data.answer!=="string"||!data.answer.trim())throw Error("Chat failed HTTP "+res.status+": "+String(data.error||"no answer").slice(0,120));
    if(!/^Groq/.test(data.model||""))throw Error("Expected Groq, received "+(data.model||"unknown"));
    console.log("JVEX live chat through Cloudflare + Groq: SUCCESS");
    console.log("Model: "+data.model);
    console.log("Reply: "+data.answer.replace(/\s+/g," ").slice(0,220));
  }finally{clearTimeout(timer)}
}
try{await verify()}catch(e){console.error("JVEX smoke: "+String(e.message||e));process.exitCode=1}
