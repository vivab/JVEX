// JVEX UI-only activity indicators and gentle reveal animation.
// These are concise operation labels; they do NOT reveal or fabricate hidden model reasoning.
(function(root){
"use strict";
function estimateCost({mode="chat",text="",image=false}={}){
 const input=String(text||"").slice(0,16000);
 if(mode!=="code")return image||input.length>=3500?2:1;
 const heavy=/(полноценн|целиком|с нуля|сделай всё|сделай все|всю игру|игру целиком|многопользоват|мультиплеер|нескольк.{0,18}файл|целый проект|весь проект|все файлы|игровой движок|3d[\s-]*игр|3д[\s-]*игр|большой проект|from scratch|full (game|project|app)|complete (game|app|project)|entire (project|game)|multi[- ]file)/i.test(input);
 const medium=/(создай|сделай|напиши|разработай|исправь|пофикси|добавь|перепиши|рефактор|реализуй|программа|скрипт|файл|сайт|код|игр|github\.com|build|create|write|fix|refactor|implement|generate|app)/i.test(input);
 return heavy||input.length>=1800?3:medium||input.length>=400||image?2:1;
}
function phaseLabel({mode="chat",text="",image=false}={}){
 const v=String(text||"");
 if(mode==="code"){
  if(/игр|game|arena|шутер|football|футбол|платформер/i.test(v))return "Пишу код для игры…";
  if(/github\.com|репозитор|repository/i.test(v))return "Изучаю проект и пишу код…";
  return "Пишу код…";
 }
 if(image)return "Анализирую фотографию…";
 return "Готовлю ответ…";
}
function phases(task){
 return [
  {title:"Читаю…",note:"Получен запрос; определяю тип задачи."},
  {title:"Думаю…",note:"Учитываю предыдущие сообщения и доступные материалы."},
  {title:phaseLabel(task),note:task.mode==="code"?"Генерирую ответ с кодом и файлами.":"Ожидаю результат от ИИ-модели."}
 ];
}
function revealFrames(text,maxFrames=110){
 const length=String(text||"").length;
 if(!length)return [0];
 const count=Math.min(maxFrames,Math.max(15,Math.ceil(length/30)));
 const out=[];
 for(let i=1;i<=count;i++)out.push(Math.min(length,Math.ceil(length*i/count)));
 return out;
}
root.JVEXProgress={estimateCost,phaseLabel,phases,revealFrames};
})(typeof window!=="undefined"?window:globalThis);
