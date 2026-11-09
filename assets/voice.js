// JVEX hold-to-talk controller. A real audio clip is uploaded to the server;
// no provider secret or recognition credentials ever reach the browser.
(function(root){
"use strict";
function preferredAudioType(Recorder){
 const types=["audio/mp4","audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
 return types.find(type=>typeof Recorder?.isTypeSupported==="function"&&Recorder.isTypeSupported(type))||"";
}
function create(options){
 const {onState,onText,onUsage,onError,isEnabled,apiBase}=options;
 let session=null,sequence=0;
 const signal=(name)=>{try{onState?.(name)}catch{}};
 function clear(s){
  if(s.timer)clearTimeout(s.timer);
  if(s.stream)for(const track of s.stream.getTracks())track.stop();
  if(session===s)session=null;
 }
 function failure(s,err){
  clear(s);signal("idle");
  onError?.(err instanceof Error?err:new Error(String(err)));
 }
 async function finish(s){
  if(s.cancelled||s.data.length===0){clear(s);signal("idle");return}
  if(Date.now()-s.started<280){clear(s);signal("idle");return}
  const type=String(s.recorder?.mimeType||s.data[0]?.type||"audio/webm");
  const body=new Blob(s.data,{type});
  if(body.size<200){clear(s);signal("idle");onError?.(new Error("Запись слишком короткая. Удерживай микрофон чуть дольше."));return}
  clear(s);signal("processing");
  try{
   const form=new FormData();
   form.append("audio",body,"recording."+(type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm"));
   const response=await fetch(apiBase+"/api/transcribe",{method:"POST",body:form,signal:AbortSignal.timeout(38000)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||"Голос не распознан");
   if(typeof data.text!=="string"||!data.text.trim())throw new Error("Речь не распознана");
   onUsage?.(data.usage);
   signal("idle");
   onText?.(data.text.trim());
  }catch(err){signal("idle");onError?.(err)}
 }
 async function begin(){
  if(session||isEnabled?.()===false)return;
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){
   onError?.(new Error("Этот браузер не разрешает запись микрофона. Попробуй открыть JVEX в Safari или Chrome по HTTPS."));return;
  }
  const s={id:++sequence,pressed:true,stream:null,recorder:null,data:[],started:0,cancelled:false,timer:null};
  session=s;signal("permission");
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
   s.stream=stream;
   if(session!==s||!s.pressed){clear(s);signal("idle");return}
   const mime=preferredAudioType(MediaRecorder);
   const recorder=mime?new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000}):new MediaRecorder(stream);
   s.recorder=recorder;
   recorder.ondataavailable=e=>{if(e.data?.size)s.data.push(e.data)};
   recorder.onerror=()=>failure(s,new Error("Не удалось записать звук"));
   recorder.onstop=()=>{finish(s)};
   recorder.start();s.started=Date.now();signal("recording");
   s.timer=setTimeout(()=>end(false),45000);
  }catch(err){failure(s,new Error("Нет доступа к микрофону или запись не поддерживается"))}
 }
 function end(cancel=false){
  const s=session;if(!s)return;
  s.pressed=false;s.cancelled=!!cancel;
  if(!s.recorder)return; // User released while the microphone permission dialog was open.
  if(s.recorder.state==="recording")s.recorder.stop();
 }
 function dispose(){end(true)}
 return {begin,end,dispose,get active(){return !!session}};
}
root.JVEXVoice={create,preferredAudioType};
})(typeof window!=="undefined"?window:globalThis);
