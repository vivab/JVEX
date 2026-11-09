import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
const base="https://jvex-api.vivogaga12.workers.dev/api/chat",dir="quality-results";
await fs.mkdir(path.join(dir,"games"),{recursive:true});
const tasks=[
 {id:"tanks",mode:"code",name:"2D Танки",prompt:"Создай полностью работающую 2D браузерную игру Танки в ОДНОМ файле index.html: вид сверху, WASD/стрелки, стрельба пробелом, хотя бы один вражеский танк с ИИ, попадания и здоровье, столкновения, счёт, победа/проигрыш и перезапуск. Для телефона нужны сенсорные кнопки. Без внешних библиотек. Напиши полный HTML + CSS + JS в одном закрытом блоке кода html file=index.html без сокращений."},
 {id:"snake",mode:"code",name:"2D Змейка",prompt:"Создай вторую законченную браузерную игру Змейка в одном файле index.html: клавиши стрелок/WASD, еда и рост, очки, стены и столкновение с собой, конец игры, рестарт и сенсорные кнопки для телефона. Без библиотек. Полный HTML + CSS + JS в единственном закрытом блоке кода html file=index.html."},
 {id:"math",mode:"chat",name:"Математика",prompt:"Реши с понятными короткими вычислениями: 1) x - x/7 = 3; 2) x² - 5x + 6 = 0, все корни; 3) В коробке 5 красных и 3 синих шара, какова вероятность вытащить 2 красных без возвращения? Точная дробь."},
 {id:"grammar",mode:"chat",name:"Русская грамматика",prompt:"Исправь все ошибки и дай исправленный текст целиком, затем объясни 5 важнейших правил: «В течении недели мы не разу не видили друзей. По приезду домой я одел куртку и пошол гулять. Не смотря на дождь, мы все таки пошли в парк.»"}
];
function pause(ms){return new Promise(r=>setTimeout(r,ms))}
async function ask(t){
 const signal=AbortSignal.timeout(165000);
 const res=await fetch(base,{method:"POST",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:t.prompt}],mode:t.mode,search:"off",preference:"groq",groqModel:"auto"})});
 const d=await res.json().catch(()=>({}));
 return {http:res.status,answer:d.answer||"",error:d.error||"",model:d.model||"",cost:d.cost??null};
}
function htmlFromAnswer(answer){
 const fence=String.fromCharCode(96).repeat(3),parts=answer.split(fence);
 const codes=parts.filter((_,i)=>i%2===1).map(s=>s.replace(/^[^\r\n]*\r?\n/,""));
 return codes.find(s=>/<!doctype html|<html/i.test(s))||codes.find(s=>/<script/i.test(s))||"";
}
function gameCheck(html,id){
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
 const checks={html:/<html[\s>]/i.test(html)&&/<\/html>/i.test(html),css:/<style[\s>]/i.test(html),script:scripts.length>0,jsSyntax:false,keyboard:/keydown/i.test(html),touch:/touch|pointer|mobile|ontouch/i.test(html),gameLoop:/requestAnimationFrame|setInterval/i.test(html),restart:/restart|reset|перезапуск/i.test(html),score:/score|очк|счёт/i.test(html)};
 try{for(const code of scripts)new vm.Script(code);checks.jsSyntax=scripts.length>0}catch(e){checks.syntaxError=String(e.message)}
 if(id==="tanks"){checks.enemy=/enemy|enemies|bot|враг|противник/i.test(html);checks.bullets=/bullet|projectile|shoot|стрел|снаряд/i.test(html);checks.health=/health|hp|жизн|здоров/i.test(html)}
 if(id==="snake"){checks.snake=/snake|змейк/i.test(html);checks.food=/food|яблок|еда/i.test(html);checks.collision=/collision|gameOver|gameover|death|проигр/i.test(html)}
 return checks;
}
function mathCheck(s){return {linear:/x\s*=\s*3[.,]5|x\s*=\s*7\/2|x\s*=\s*7\s*\/\s*2/i.test(s),quadratic:/\b2\b/.test(s)&&/\b3\b/.test(s),probability:/5\s*\/\s*14|5\s*⁄\s*14/.test(s)}}
function grammarCheck(s){const x=s.toLowerCase().slice(0,600);return {techenie:x.includes("в течение недели"),ni:x.includes("ни разу"),videli:x.includes("видели друзей"),priezde:x.includes("по приезде домой"),nadel:x.includes("надел куртку"),poshel:/пош[её]л гулять/.test(x),nesmotrya:x.includes("несмотря на дождь"),vsetaki:/всё-таки|все-таки/.test(x)}}
const report=[];
for(let i=0;i<tasks.length;i++){
 const task=tasks[i];if(i)await pause(17000);
 console.log("=== "+task.name+" ===");
 let r;try{r=await ask(task)}catch(e){r={http:0,answer:"",error:String(e),model:"",cost:null}}
 const html=task.mode==="code"?htmlFromAnswer(r.answer):"";
 const checks=task.mode==="code"?gameCheck(html,task.id):task.id==="math"?mathCheck(r.answer):grammarCheck(r.answer);
 await fs.writeFile(path.join(dir,task.id+".json"),JSON.stringify({task,payload:r,checks},null,2));
 if(html)await fs.writeFile(path.join(dir,"games",task.id+".html"),html);
 const row={name:task.name,http:r.http,model:r.model,cost:r.cost,answerLength:r.answer.length,gameLength:html.length,checks};
 report.push(row);console.log(JSON.stringify(row));
 if(task.mode==="chat")console.log("ANSWER\n"+r.answer.slice(0,5000)+"\nEND_ANSWER");
 else console.log("CODE_START\n"+r.answer.slice(0,700)+"\nCODE_END\n"+r.answer.slice(-450));
}
await fs.writeFile(path.join(dir,"summary.json"),JSON.stringify(report,null,2));
console.log("EVALUATION_FINISHED");
