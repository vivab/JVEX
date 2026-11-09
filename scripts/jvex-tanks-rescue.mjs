// Second chance for JVEX to generate mobile-ready Tanks, tested in Chromium.
import fs from "node:fs/promises";
import vm from "node:vm";
import {chromium} from "playwright";
const endpoint="https://jvex-api.vivogaga12.workers.dev/api/chat";
await fs.mkdir("tank-results",{recursive:true});
await fs.mkdir("play/data",{recursive:true});
const prompts=[
 "Напиши готовую ПРОСТУЮ 2D браузерную игру ТАНКИ в ОДНОМ файле index.html: canvas, два танка сверху (зелёный игрок и красный враг), игрок ездит стрелками/WASD и стреляет пробелом. Враг сам двигается, периодически стреляет в игрока и получает урон от попаданий, по 3 жизни. Счёт за победу, проигрыш и рестарт. На телефоне нужно ровно 5 заметных кнопок (<button>): вверх, вниз, влево, вправо и ОГОНЬ. Только встроенные HTML+CSS+JS, никаких внешних файлов. Пиши КОМПАКТНЫЙ код максимум 130 строк, полностью закрытый HTML. Ответ ТОЛЬКО в одном закрытом блоке кода html file=index.html без объяснений.",
 "Перепиши сверхкоротко рабочую игру танки (1 HTML файл) на canvas: WASD/стрелки, Space выстрел, 5 touch-кнопок, 1 вражеский танк с автоматическим движением, выстрелами, HP, победой/поражением и рестартом. Предыдущий файл был неполным. Обязательно закончи весь скрипт и HTML, не оставляй TODO. Суммарно максимум 110 строк, один полный блок html file=index.html."
];
const fence=String.fromCharCode(96).repeat(3);
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
let success=false,lastProblem="";
try{
 for(let i=0;i<prompts.length;i++){
  if(i)await new Promise(r=>setTimeout(r,21000));
  let data={};
  try{
   const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"code",groqModel:i===0?"openai/gpt-oss-120b":"qwen/qwen3.8-27b",preference:"groq",messages:[{role:"user",content:prompts[i]}]}),signal:AbortSignal.timeout(90000)});
   data={...await res.json().catch(()=>({})),http:res.status};
   console.log("TANK_JVEX_RESPONSE "+JSON.stringify({http:data.http,model:data.model,cost:data.cost,chars:data.answer?.length,error:data.error}));
  }catch(e){data={http:0,error:String(e.message||e)}}
  if(data.http!==200){lastProblem=data.error||"HTTP "+data.http;if(data.http===429)break;continue}
  const blocks=String(data.answer||"").split(fence).filter((_,i)=>i%2===1).map(v=>v.replace(/^[^\r\n]*\r?\n/,"").trim());
  const html=blocks.find(t=>/<html(?:\s|>)/i.test(t))||"";
  if(html.length<1500||!/<\/html>/i.test(html)||!/<\/script>/i.test(html)||!/<canvas/i.test(html)){lastProblem="HTML truncated";continue}
  if(/<script[^>]*src=|fetch\s*\(|XMLHttpRequest|WebSocket/i.test(html)){lastProblem="External dependencies";continue}
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  try{for(const m of scripts)new vm.Script(m[1])}catch(e){lastProblem="JS syntax "+e.message;continue}
  if(!/keydown/i.test(html)||!/bullet|shoot|стрел|выстрел/i.test(html)||!/enemy|враг|bot/i.test(html)){lastProblem="Missing movement, shooting or enemy";continue}
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(String(e.message).slice(0,160)));
  page.on("dialog",d=>d.dismiss().catch(()=>{}));
  try{
   await page.route("**/*",r=>r.abort());
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><iframe id="test" sandbox="allow-scripts" style="width:100%;height:810px;border:0"></iframe>');
   const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\';script-src \'unsafe-inline\';style-src \'unsafe-inline\';img-src data: blob:;connect-src \'none\';form-action \'none\'">';
   const source=html.replace(/<head(?:\s[^>]*)?>/i,m=>m+csp);
   await page.locator("#test").evaluate((el,v)=>el.srcdoc=v,source);
   const frame=page.frameLocator("#test");
   await frame.locator("canvas").first().waitFor({state:"attached",timeout:7500});
   const btnCount=await frame.locator("button:visible").count();
   if(btnCount<5)throw Error("No five touch buttons: "+btnCount);
   const labels=await frame.locator("button:visible").allTextContents();
   const canvas=await frame.locator("canvas").first().evaluate(c=>({w:c.width,h:c.height,rect:c.getBoundingClientRect().width}));
   if(canvas.w<100||canvas.h<100||canvas.rect>430)throw Error("Canvas oversized: "+JSON.stringify(canvas));
   const start=frame.getByRole("button",{name:/start|играть|начать|старт/i}).first();if(await start.count())try{await start.click({timeout:2000})}catch{}
   await page.keyboard.press("ArrowUp");await page.keyboard.press(" ");
   const fire=frame.getByRole("button",{name:/огонь|fire|стрел|shoot|🔫|💥/i}).first();if(await fire.count())try{await fire.click({timeout:2000})}catch{}
   await page.waitForTimeout(700);
   if(errors.length)throw Error("Runtime error: "+errors.join(";"));
   await page.screenshot({path:"tank-results/tanks-mobile.png",timeout:15000});
   await fs.writeFile("play/data/tanks.json",JSON.stringify({id:"tanks",title:"Танки",generatedBy:"JVEX public API",model:data.model||"Groq",html}));
   await fs.writeFile("tank-results/success.json",JSON.stringify({http:data.http,model:data.model,length:html.length,canvas,buttons:labels,passed:true},null,2));
   console.log("JVEX_TANKS_VERIFIED "+JSON.stringify({model:data.model,length:html.length,buttons:labels,canvas}));
   success=true;break;
  }catch(e){lastProblem=String(e.message||e).slice(0,500);console.log("TANK_TEST_FAILED "+lastProblem)}
  finally{await context.close()}
 }
}finally{await browser.close()}
if(!success){console.error("JVEX_TANKS_UNAVAILABLE "+lastProblem);process.exitCode=2}
