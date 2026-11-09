import {test} from "node:test";
import assert from "node:assert/strict";
import {estimateCost as serverPrice} from "../src/complexity.js";
import "../../assets/progress.js";
const ui=globalThis.JVEXProgress;
test("Frontend and server agree on the complexity quote",()=>{
 const tasks=[
  {mode:"chat",text:"Привет"},
  {mode:"chat",text:"Посмотри фото",image:true},
  {mode:"code",text:"Привет"},
  {mode:"code",text:"Исправь баг"},
  {mode:"code",text:"Сделай игру с нуля"},
  {mode:"code",text:"Создай полноценный проект с несколькими файлами"},
  {mode:"code",text:"Разъясни код на JavaScript"},
  {mode:"chat",text:"Очень длинный текст. ".repeat(250)}
 ];
 for(const task of tasks)assert.equal(ui.estimateCost(task),serverPrice(task),JSON.stringify(task).slice(0,120));
});
test("User-visible statuses show reading, thinking and coding activity",()=>{
 const game=ui.phases({mode:"code",text:"Создай игру"});
 assert.deepEqual(game.map(s=>s.title),["Читаю…","Думаю…","Пишу код для игры…"]);
 assert.match(game[1].note,/модел|контекст|сообщ/i);
 assert.equal(ui.phases({mode:"chat",text:"Что здесь?",image:true})[2].title,"Анализирую фотографию…");
});
test("Reveal frames advance monotonically to complete response",()=>{
 for(const size of [1,10,100,1500,50000]){
   const frames=ui.revealFrames("x".repeat(size));
   assert.ok(frames.length<=110);
   assert.ok(frames[0]>0);
   assert.equal(frames.at(-1),size);
   assert.ok(frames.every((n,i)=>i===0||n>=frames[i-1]));
 }
});
