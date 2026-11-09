// Promote two additional games genuinely authored by JVEX's public API.
// Only minor explicitly documented responsive fixes may be applied.
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import {chromium} from "playwright";
const root="/tmp/jvex-lab-source",target="play/data";
const specs=[{id:"snake",newId:"snake-qwen",title:"Змейка • Qwen"},{id:"pong",newId:"pong",title:"Пинг-понг"}];
await fs.mkdir(target,{recursive:true});
await fs.mkdir("game-promo-results",{recursive:true});
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
 for(const spec of specs){
  const qa=JSON.parse(await fs.readFile(path.join(root,spec.id+".json"),"utf8"));
  if(qa.row.http!==200||!qa.rawAnswer)throw Error("Missing JVEX response for "+spec.id);
  const fence=String.fromCharCode(96).repeat(3);
  let html=qa.rawAnswer.split(fence).filter((_,i)=>i%2===1).map(t=>t.replace(/^[^\r\n]*\r?\n/,"").trim()).find(t=>/<html/i.test(t));
  if(!html||!html.includes("</html>")||!/<canvas/i.test(html))throw Error("Incomplete "+spec.id);
  const adaptations=[];
  if(spec.id==="pong"){
    // GPT-OSS 120B produced a fixed 800x600 canvas, too wide for an iPhone.
    // Scale visual canvas and convert pointer's CSS pixels into game coordinates.
    html=html.replace("</style>","canvas{width:min(98vw,800px);height:auto;touch-action:none}</style>");
    html=html.replaceAll("e.clientY-canvasRect.top","(e.clientY-cv.getBoundingClientRect().top)*H/cv.getBoundingClientRect().height");
    html=html.replaceAll("e.touches[0].clientY-canvasRect.top","(e.touches[0].clientY-cv.getBoundingClientRect().top)*H/cv.getBoundingClientRect().height");
    adaptations.push("Responsive canvas and corrected scaled touch coordinates");
  }else{
    html=html.replace("</style>","canvas{max-width:96vw;height:auto}</style>");
    adaptations.push("Responsive canvas width on narrow phones");
  }
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
  if(!scripts.length)throw Error("Missing JS for "+spec.id);
  for(const script of scripts)new vm.Script(script);
  if(/<script[^>]*src=|fetch\s*\(|XMLHttpRequest|WebSocket/i.test(html))throw Error("External dependencies not allowed");
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("dialog",d=>d.dismiss().catch(()=>{}));
  await page.route("**/*",route=>route.abort());
  const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; form-action \'none\'">';
  const patched=html.replace(/<head(?:\s[^>]*)?>/i,m=>m+csp);
  await page.setContent('<iframe id="game" sandbox="allow-scripts" style="width:100%;height:820px;border:0"></iframe>');
  await page.locator("#game").evaluate((el,v)=>el.srcdoc=v,patched);
  const frame=page.frameLocator("#game");
  await frame.locator("canvas").waitFor({state:"attached",timeout:8000});
  await page.waitForTimeout(450);
  const initial=await frame.locator("canvas").evaluate(c=>({w:c.width,h:c.height,rect:c.getBoundingClientRect().width}));
  if(initial.w<100||initial.h<100||initial.rect>410)throw Error("Invalid canvas size "+JSON.stringify(initial));
  if(spec.id==="snake"){
    if(await frame.locator("button").count()<4)throw Error("No touch controls");
    const up=frame.getByText("↑",{exact:true}).first();if(await up.count())await up.click();
    const start=frame.getByText("Пуск",{exact:true}).first();if(await start.count())await start.click();
  }else{
    if(!/touchmove/.test(html))throw Error("Pong lacks mobile pointer handling");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
  }
  await page.waitForTimeout(650);
  await page.screenshot({path:path.join("game-promo-results",spec.newId+".png"),timeout:15000});
  if(errors.length)throw Error("Browser JS errors "+errors.join(";"));
  await context.close();
  const document={id:spec.newId,title:spec.title,model:qa.row.model,generatedBy:"JVEX public API, run 42600545724",adaptations,html};
  await fs.writeFile(path.join(target,spec.newId+".json"),JSON.stringify(document));
  console.log("PROMOTED_JVEX_GAME "+spec.newId+" "+qa.row.model+" CANVAS "+JSON.stringify(initial)+" RESPONSIVE_FIXES "+JSON.stringify(adaptations));
 }
}finally{await browser.close()}
console.log("JVEX_PROMOTION_COMPLETED");
