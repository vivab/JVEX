// A deterministic, auditable quote. No user-supplied "price" field is trusted.
// This is a cost in JVEX Free request units, NOT the model provider's billing units.
export function estimateCost({mode="chat",text="",image=false}={}){
  const input=String(text||"").slice(0,16000);
  const code=mode==="code";
  if(!code){
    // Photos and unusually long multi-part chat requests consume extra capacity.
    return image||input.length>=3500 ? 2:1;
  }
  const heavy=/(полноценн|целиком|с нуля|сделай всё|сделай все|всю игру|игру целиком|многопользоват|мультиплеер|нескольк.{0,18}файл|целый проект|весь проект|все файлы|игровой движок|3d[\s-]*игр|3д[\s-]*игр|большой проект|from scratch|full (game|project|app)|complete (game|app|project)|entire (project|game)|multi[- ]file)/i.test(input);
  const medium=/(создай|сделай|напиши|разработай|исправь|пофикси|добавь|перепиши|рефактор|реализуй|программа|скрипт|файл|сайт|код|игр|github\.com|build|create|write|fix|refactor|implement|generate|app)/i.test(input);
  return heavy||input.length>=1800 ? 3 : medium||input.length>=400||image ? 2 : 1;
}
export function taskLabel({mode="chat",text="",image=false}={}){
  const v=String(text||"");
  if(mode==="code"){
    if(/игр|game|arena|шутер|football|футбол|платформер/i.test(v))return "Пишу код для игры…";
    if(/github\.com|репозитор|repository/i.test(v))return "Изучаю проект и пишу код…";
    return "Пишу код…";
  }
  if(image)return "Анализирую фотографию…";
  return "Готовлю ответ…";
}
