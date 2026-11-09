// Ask the REAL deployed JVEX to write 4 games and publish only complete,
// Chromium-tested outputs. Generated programs remain inert JSON and run solely
// in a sandboxed iframe with no same-origin access or network permission.
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import {chromium} from "playwright";
const API="https://jvex-api.vivogaga12.workers.dev/api/chat";
const OUTPUT="game-lab-results";
const DATA="play/data";
const options=[
 {id:"snake",title:"Змейка",model:"qwen/qwen3.8-27b",prompt:"Напиши рабочую 2D браузерную Змейку на Canvas в ОДНОМ index.html. Вся игра в HTML+CSS+JavaScript без библиотек. Змейка движется, собирает еду, растёт, показывает счёт, гибнет о стены/себя, запускается заново кнопкой. WASD и стрелки плюс четыре кнопки на телефоне. Дай очень КОРОТКИЙ, но законченный код, максимум 170 строк. Ответ ТОЛЬКО одним закрытым блоком кода html file=index.html. Все закрывающие теги обязательны."},
 {id:"pong",title:"Пинг-понг",model:"openai/gpt-oss-120b",prompt:"Напиши 2D игру Пинг-понг: пользователь против компьютера, шар отскакивает, противник двигает ракетку к мячу, счёт до 5 и рестарт, мышь/касание управляет ракеткой, также стрелки вверх/вниз. Единственный готовый index.html с Canvas, CSS, JS. Ни библиотек, ни внешних ассетов. Код короткий, максимум 170 строк. Верни ТОЛЬКО один полный закрытый блок html file=index.html. Не обрывай код."},
 {id:"breakout",title:"Арканоид",model:"qwen/qwen3.8-27b",prompt:"Напиши готовую браузерную игру 2D Арканоид: мяч отскакивает от ракетки и блоков, блоки разрушаются, есть очки, 3 жизни, выигрыш и проигрыш, кнопка рестарта. Движение ракетки мышью, касанием и стрелками. ОДИН index.html с Canvas + HTML + CSS + JS, без библиотек. Компактный КОНЕЧНЫЙ код до 180 строк. Ответ ТОЛЬКО в одном полном блоке html file=index.html с закрывающими тегами."},
 {id:"tanks",title:"Танки",model:"openai/gpt-oss-120b",prompt:"Напиши компактную игровую браузерную 2D игру Танки сверху. ОДИН готовый index.html (HTML+CSS+JS Canvas), никаких библиотек. Игрок управляет танком стрелками/WASD, пробелом стреляет, на телефоне 4 кнопки направлений + ОГОНЬ. Минимум 1 враг: сам движется, стреляет в игрока и получает урон от пуль; HP игрока, очки за уничтожение, победа/поражение и РАБОЧИЙ рестарт. Важно: компактный код до 190 строк, чтобы НЕ оборвался. В ответе только ОДИН полный закрытый блок html file=index.html, без пояснений."}
];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const f=String.fromCharCode(96).repeat(3);
async function query(game,repair=false,previous=""){
 const prompt=repair?
  "Предыдущая попытка создать 2D "+game.title+" оборвалась или имела ошибку: "+previous.slice(0,220)+". Перепиши с НУЛЯ сильно более короткий ПОЛНОСТЬЮ завершённый HTML+CSS+JS одним файлом для браузера и телефона. Используй 1 canvas, простое управление, очки и рестарт. Только закрытый блок html file=index.html. Не добавляй объяснений. Максимум 125 строк.":
  game.prompt;
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),100000);
 try{
  const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:prompt}],mode:"code",preference:"groq",groqModel:game.model}),signal:ctrl.signal});
  const d=await r.json().catch(()=>({}));
  return {http:r.status,model:d.model||"",cost:d.cost??null,answer:String(d.answer||""),error:d.error||"",retryAfter:d.retryAfter};
 }catch(e){return {http:0,answer:"",error:String(e.message||e),cost:null,model:""}}
 finally{clearTimeout(timeout)}
}
function extract(answer){
 const blocks=String(answer||"").split(f).filter((_,i)=>i%2===1).map(v=>v.replace(/^[^\r\n]*\r?\n/,"").trim());
 return blocks.find(v=>/<!doctype html|<html(?:\s|>)/i.test(v))||"";
}
function check(html,game){
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
 const rules={
  completeDocument:/<!doctype html|<html(?:\s|>)/i.test(html)&&/<\/html>/i.test(html),
  canvas:/<canvas(?:\s|>)/i.test(html),styles:/<style(?:\s|>)/i.test(html),
  script:scripts.length>0,loops:/requestAnimationFrame|setInterval|setTimeout/i.test(html),
  keyboard:/keydown|onkeydown/i.test(html),
  touch:/touch|pointer|ontouch|onpointer/i.test(html),
  restart:/restart|reset|заново|снова|старт|start/i.test(html),
  noExternalScripts:!/<script[^>]*src=|(?:https?:)?\/\/(?:cdn|unpkg|fonts\.googleapis)/i.test(html),
  noRemoteAPI:!/fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i.test(html),
  notTruncated:html.length>1500&&html.length<95000,
  jsSyntax:false
 };
 try{for(const s of scripts)new vm.Script(s);rules.jsSyntax=scripts.length>0}
 catch(e){rules.syntaxError=String(e.message)}
 if(game.id==="tanks")rules.hasShooting=/bullet|shoot|стрел|выстрел|снаряд/i.test(html)&&/enemy|bot|враг/i.test(html);
 if(game.id==="snake")rules.hasFood=/food|еда|яблок/i.test(html)&&/snake|змей/i.test(html);
 if(game.id==="breakout")rules.hasBricks=/brick|block|кирпич|блок/i.test(html);
 if(game.id==="pong")rules.hasAI=/ai|computer|cpu|bot|враг|противник/i.test(html);
 return {rules,passed:Object.values(rules).every(x=>x===true)};
}
async function browserCheck(browser,html,game){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage(),errors=[];
 page.on("pageerror",e=>errors.push(String(e.message||e).slice(0,180)));
 let r={passed:false,errors};
 try{
  await page.route("**/*",route=>route.abort());
  const csp="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'\">";
  const body=html.replace(/<head(?:\s[^>]*)?>/i,m=>m+csp);
  await page.setContent('<iframe sandbox="allow-scripts" id="test" style="width:390px;height:820px;border:0"></iframe>');
  await page.locator("#test").evaluate((el,src)=>{el.srcdoc=src},body===html?csp+html:body);
  const frame=page.frameLocator("#test");
  await frame.locator("canvas").first().waitFor({state:"attached",timeout:6500});
  const start=frame.getByRole("button",{name:/start|начать|играть|play|старт/i}).first();
  if(await start.count())try{await start.click({timeout:1800})}catch{}
  for(const key of ["ArrowUp","ArrowRight"," ","ArrowLeft"]){await page.keyboard.press(key);await wait(150)}
  await wait(1000);
  r.canvasCount=await frame.locator("canvas").count();
  r.buttonCount=await frame.locator("button").count();
  r.hasVisibleCanvas=await frame.locator("canvas").first().evaluate(el=>el.width>0&&el.height>0);
  r.hasTouchControls=await frame.locator("button").count()>= (["snake","tanks"].includes(game.id)?4:1);
  r.errors=errors.slice(0,8);
  await page.screenshot({path:path.join(OUTPUT,game.id+"-mobile.png"),timeout:12000});
  r.passed=r.hasVisibleCanvas&&r.hasTouchControls&&errors.length===0;
 }catch(e){r.error=String(e.message||e).slice(0,450)}
 await context.close();
 return r;
}
await fs.mkdir(DATA,{recursive:true});
await fs.mkdir(OUTPUT,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const report=[];let repairUsed=false;
try{
 for(let i=0;i<options.length;i++){
  if(i)await wait(18000);
  const game=options[i];
  console.log("JVEX_GAME_START "+game.id);
  let response=await query(game),html=extract(response.answer),validation=check(html,game),browserResult=null;
  if(response.http===200&&validation.passed)browserResult=await browserCheck(browser,html,game);
  if((!validation.passed||!browserResult?.passed)&&!repairUsed&&response.http===200){
   repairUsed=true;await wait(17000);
   const issue=validation.rules.syntaxError||JSON.stringify(validation.rules).slice(0,130)+" "+String(browserResult?.error||"");
   console.log("JVEX_GAME_REPAIR "+game.id+" "+issue);
   const revised=await query(game,true,issue),revisedHtml=extract(revised.answer),revisedChecks=check(revisedHtml,game);
   if(revised.http===200&&revisedChecks.passed){
    const browsed=await browserCheck(browser,revisedHtml,game);
    if(browsed.passed){response=revised;html=revisedHtml;validation=revisedChecks;browserResult=browsed}
   }
  }
  const passed=response.http===200&&validation.passed&&browserResult?.passed;
  const row={id:game.id,title:game.title,model:response.model,cost:response.cost,http:response.http,answerChars:response.answer.length,htmlChars:html.length,static:validation.rules,browser:browserResult,passed,reason:passed?"validated":response.error||validation.rules.syntaxError||browserResult?.error||"Failed static or browser checks"};
  await fs.writeFile(path.join(OUTPUT,game.id+".json"),JSON.stringify({row,prompt:game.prompt,rawAnswer:response.answer},null,2));
  if(passed){
   const document={id:game.id,title:game.title,model:response.model,generatedBy:"JVEX public API",html};
   await fs.writeFile(path.join(DATA,game.id+".json"),JSON.stringify(document));
   console.log("JVEX_GAME_PUBLISHED "+game.id+" "+response.model+" "+html.length);
  }else console.log("JVEX_GAME_REJECTED "+game.id+" "+row.reason);
  report.push(row);
 }
}finally{await browser.close()}
await fs.writeFile(path.join(OUTPUT,"summary.json"),JSON.stringify(report,null,2));
const passing=report.filter(x=>x.passed);
console.log("JVEX_GAME_RESULTS "+JSON.stringify(report.map(({id,passed,http,reason,model})=>({id,passed,http,reason,model}))));
console.log("JVEX_GAME_PASSING "+passing.length);
if(passing.length===0)process.exitCode=2;
