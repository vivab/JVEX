// Real public JVEX API examination. Results are evidence, not simulated model replies.
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import {chromium} from "playwright";

const API="https://jvex-api.vivogaga12.workers.dev/api/chat";
const DIR="quality-results";
const tasks=[
 {id:"math",name:"Математика",mode:"chat",prompt:"Проверка по математике (9 класс). Реши каждое задание и коротко объясни вычисления. 1) Реши x - x/7 = 3. 2) Найди все корни x² - 5x + 6 = 0. 3) В коробке 5 красных и 3 синих шара. Вероятность вытащить подряд два красных БЕЗ возвращения первого шара? Ответ точной дробью. 4) Вычисли 3/4 + 5/6, ответ несократимой дробью."},
 {id:"russian",name:"Русский язык",mode:"chat",prompt:"Контрольная по русскому языку (9 класс). Сначала исправь весь текст без изменения смысла: «В течении недели мы не разу не видили друзей. По приезду домой я одел куртку и пошол гулять. Не смотря на дождь, мы все таки пошли в парк.» Затем ОБЪЯСНИ написание сочетаний «в течение недели», «по приезде домой», «несмотря на дождь», «всё-таки», «ни разу»: пишутся ли слитно, раздельно или через дефис и почему? Не путай правильный текст и объяснения."},
 {id:"informatics",name:"Информатика",mode:"chat",prompt:"Реши три задания по информатике (9 класс) и объясни. 1) Переведи 101101₂ в десятичную систему. 2) Сколько БАЙТ занимает несжатое изображение 800×600 пикселей при глубине цвета 16 бит на пиксель? 3) В JavaScript найди и исправь ошибку в коде вычисления суммы массива: let a=[1,2,3,4], sum=0; for(let i=0;i<=a.length;i++) sum+=a[i]; console.log(sum); Объясни, почему исходный код даёт NaN, и приведи правильный вывод."},
 {id:"physics",name:"Физика",mode:"chat",prompt:"Проверка по физике (9 класс). Реши с формулами, подстановкой и ЕДИНИЦАМИ: 1) Тело начинает двигаться со скоростью 2 м/с и ускорением 3 м/с². Найди скорость и перемещение через 4 с. 2) Резисторы 4 Ом и 6 Ом соединены ПОСЛЕДОВАТЕЛЬНО и подключены к 24 В. Найди общее сопротивление и силу тока. 3) Камень падает без начальной скорости с высоты 45 м, g=10 м/с², сопротивлением воздуха пренебречь. Сколько секунд он падает?"},
 {id:"tanks",name:"Программирование: 2D Танки",mode:"code",prompt:"Создай ПОЛНОЦЕННУЮ рабочую браузерную 2D игру «Танки» в ОДНОМ файле index.html (включая HTML, CSS, JS). Вид сверху, игрок управляется WASD и стрелками, стреляет пробелом; минимум 2 вражеских танка двигаются, стреляют и получают урон; препятствия и столкновения; здоровье, очки за уничтожение врагов, поражение/победа, реальный перезапуск игрового цикла. Управление на телефоне: четыре направления и выстрел. Никаких внешних библиотек. Дай ПОЛНЫЙ готовый файл внутри одного блока кода с пометкой html file=index.html, без пропусков или псевдокода."},
 {id:"snake",name:"Программирование: 2D Змейка",mode:"code",prompt:"Создай ПОЛНОЦЕННУЮ работающую браузерную игру «Змейка» в одном файле index.html (HTML+CSS+JS), без библиотек. Управление стрелками/WASD и видимыми сенсорными кнопками для телефона. Змейка растёт после еды, счёт виден во время игры, столкновение со стенами или своим телом вызывает проигрыш. Нужны кнопки начала и перезапуска, работающие повторно. Сделай адаптацию для узкого экрана телефона. Пришли полный файл в одном блоке кода html file=index.html, без заглушек."},
 {id:"prompts",name:"Промпты для генерации изображений",mode:"chat",prompt:"Ты — промпт-инженер. Напиши ТРИ полноценных и разных промпта для генерации изображений: 1) фотореалистичная фотография мужской руки с коробкой процессора AMD Ryzen на полке компьютерного магазина, снято с телефона; 2) набор 2D-спрайтов танка для игры, вид строго сверху и прозрачный фон; 3) минималистичный рекламный постер AI-проекта JVEX с чистым текстом и зелёными акцентами. Для каждого уточни композицию, свет, стиль, ракурс, формат кадра и что следует исключить. Не генерируй сами картинки и не выдавай их за реальные результаты."},
 {id:"school",name:"Объяснение школьной темы",mode:"chat",prompt:"Объясни ученику 9 класса тему «Закон Ома для участка цепи» так, как объясняет хороший учитель: простыми словами, что обозначают I, U, R, правильная формула, единицы измерения, жизненный пример, разбор расчётной задачи при U=12 В и R=6 Ом, затем придумай одну короткую задачу для самостоятельной проверки с ответом. Избегай фактических ошибок и чрезмерного текста."}
];
await fs.mkdir(path.join(DIR,"games"),{recursive:true});
await fs.mkdir(path.join(DIR,"screenshots"),{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const fence=String.fromCharCode(96).repeat(3);
function extractHtml(answer){
 const pieces=String(answer).split(fence).filter((_,i)=>i%2===1).map(c=>c.replace(/^[^\r\n]*\r?\n/,"").trim());
 return pieces.find(c=>/<!doctype html|<html(?:\s|>)/i.test(c))||pieces.find(c=>/<script(?:\s|>)/i.test(c))||"";
}
function scoreText(id,answer){
 const text=String(answer),small=text.toLowerCase();
 if(id==="math")return {
  linear:/3[.,]\s*5|3\s*\\\{,\}\s*5|\\frac\{7\}\{2\}|7\s*\/\s*2/.test(text),
  quadratic:/\b2\b/.test(text)&&/\b3\b/.test(text),
  probability:/5\s*\/\s*14|\\(?:dfrac|frac)\{5\}\{14\}|0[.,]35714/.test(text),
  fraction:/19\s*\/\s*12|\\(?:dfrac|frac)\{19\}\{12\}|1\s+7\s*\/\s*12/.test(text)
 };
 if(id==="russian"){
   const first=text.slice(0,900).toLowerCase();
   return {v_techenie:first.includes("в течение недели"),ni_razu:first.includes("ни разу"),
    videli:first.includes("видели друзей"),po_priezde:first.includes("по приезде домой"),
    nadel:first.includes("надел куртку"),poshel:/пош[её]л гулять/.test(first),
    nesmotrya:first.includes("несмотря на дождь"),vse_taki:/вс[её]-таки/.test(first)};
 }
 if(id==="informatics")return {binary45:/\b45\b/.test(text),image960000:/960[\s\u00a0]?000|960000|937[.,]5/.test(text),loopFix:/i\s*<\s*a\.length/.test(text),sum10:/\b10\b/.test(text)};
 if(id==="physics")return {speed14:/\b14\b/.test(text),displacement32:/\b32\b/.test(text),resistance10:/\b10\b/.test(text),current2_4:/2[.,]\s*4/.test(text),fall3:/\b3\s*(?:с|сек|s|\\mathrm)/i.test(text)};
 if(id==="prompts")return {threePrompts:/1[.)]|первый/i.test(text)&&/2[.)]|второй/i.test(text)&&/3[.)]|третий/i.test(text),photorealism:/реалист|фотореал|photoreal/.test(small),gameSprite:/спрайт|sprite/.test(small),poster:/постер|баннер|афиш|poster/.test(small),exclusions:/исключ|без|negative|не должно/.test(small)};
 if(id==="school")return {ohmLaw:/U\s*=\s*I\s*[·×*]?\s*R|I\s*=\s*U\s*\/\s*R|I\s*=\s*\\frac\{U\}\{R\}/i.test(text),example2Amps:/\b2\s*(?:А|ампер|A\b)/i.test(text),terms:/напряжен/i.test(text)&&/сопротивлен/i.test(text)&&/сил[аыу]\s+тока/i.test(text),practice:/задач|проверь|самостоятельн/i.test(text)};
 return {};
}
function gameStatic(html,id){
 let scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
 let checks={htmlTag:/<html(?:\s|>)/i.test(html)&&/<\/html>/i.test(html),css:/<style(?:\s|>)/i.test(html),jsScript:scripts.length>0,syntaxOK:false,keyboard:/keydown|onkeydown/i.test(html),touch:/touch|pointer|ontouch|onpointer/i.test(html),loop:/requestAnimationFrame|setInterval|setTimeout/i.test(html),restart:/restart|reset|заново|перезапуск/i.test(html),score:/score|очк|сч[её]т/i.test(html),externalScripts:/<script[^>]+src=/i.test(html)};
 try{for(const script of scripts)new vm.Script(script);checks.syntaxOK=scripts.length>0}catch(e){checks.syntaxError=e.message}
 if(id==="tanks")Object.assign(checks,{enemy:/enemy|enemies|bot|враг|противник/i.test(html),shoot:/bullet|shoot|projectile|снаряд|выстрел/i.test(html),hp:/health|hp|здоров|жизн/i.test(html)});
 else Object.assign(checks,{snake:/snake|змейк/i.test(html),food:/food|еда|яблок/i.test(html),collision:/collision|gameover|gameOver|dead|проигр/i.test(html)});
 return checks;
}
async function ask(task){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),140000);
 try{
  const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:task.prompt}],mode:task.mode,groqModel:"auto",preference:"auto"}),signal:controller.signal});
  const data=await res.json().catch(()=>({}));
  return {http:res.status,answer:String(data.answer||""),error:String(data.error||""),model:data.model||null,cost:data.cost??null,reason:data.reason||null};
 }finally{clearTimeout(timeout)}
}
const report=[];
for(let i=0;i<tasks.length;i++){
 const task=tasks[i];if(i)await wait(17000);
 console.log("\n===== LIVE TEST "+(i+1)+"/"+tasks.length+": "+task.name+" =====");
 let response;try{response=await ask(task)}catch(e){response={http:0,answer:"",error:String(e?.message||e)}}
 const html=task.mode==="code"?extractHtml(response.answer):"";
 const checks=task.mode==="code"?gameStatic(html,task.id):scoreText(task.id,response.answer);
 await fs.writeFile(path.join(DIR,task.id+".json"),JSON.stringify({task,response,checks},null,2));
 if(html)await fs.writeFile(path.join(DIR,"games",task.id+".html"),html);
 report.push({id:task.id,category:task.name,http:response.http,model:response.model,cost:response.cost,answerLength:response.answer.length,fileLength:html.length,checks,error:response.error});
 console.log("RESULT "+JSON.stringify(report.at(-1)));
 if(task.mode==="chat")console.log("FULL_ANSWER_START\n"+response.answer.slice(0,12000)+"\nFULL_ANSWER_END");
 else console.log("GAME_HEAD\n"+response.answer.slice(0,650)+"\nGAME_TAIL\n"+response.answer.slice(-400));
}
let browser;
try{
 browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 for(const id of ["tanks","snake"]){
  const file=path.resolve(DIR,"games",id+".html");
  let exists=true;try{await fs.access(file)}catch{exists=false}
  if(!exists){console.log("GAME_BROWSER "+id+" NO_GENERATED_HTML");continue}
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(String(e.message).slice(0,180)));
  page.on("console",m=>{if(m.type()==="error")errors.push("console: "+m.text().slice(0,180))});
  let result={opened:false,errors:[]};
  try{
   const navigated=await page.goto("file://"+file,{waitUntil:"domcontentloaded",timeout:12000});
   result.opened=!!navigated;
   await page.waitForTimeout(800);
   result.title=await page.title();
   result.canvasCount=await page.locator("canvas").count();
   result.buttonCount=await page.locator("button").count();
   result.bodyText=(await page.locator("body").innerText()).slice(0,220);
   for(const key of ["ArrowUp","ArrowRight"," ","ArrowDown"]){await page.keyboard.press(key);await page.waitForTimeout(250)}
   await page.waitForTimeout(800);
   await page.screenshot({path:path.join(DIR,"screenshots",id+"-mobile.png"),fullPage:true,timeout:15000});
   result.screenshot=true;
  }catch(e){result.browserError=String(e.message||e).slice(0,350)}
  result.errors=errors.slice(0,12);
  await context.close();
  const row=report.find(x=>x.id===id);row.browser=result;
  console.log("GAME_BROWSER "+id+" "+JSON.stringify(result));
 }
}finally{if(browser)await browser.close()}
await fs.writeFile(path.join(DIR,"summary.json"),JSON.stringify(report,null,2));
console.log("=== JVEX QUALITY TEST COMPLETED ===");
