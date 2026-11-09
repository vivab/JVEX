import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import "../../assets/voice.js";
const voice=globalThis.JVEXVoice;
test("JVEX composer has plus photo/file menu, automatic search and a single mic/send button",async()=>{
 const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
 assert.match(html,/id="attachToggle"/);
 assert.match(html,/id="attachMenu"/);
 assert.match(html,/id="pickPhoto"/);
 assert.match(html,/id="pickFile"/);
 assert.match(html,/id="fileInput"/);
 assert.match(html,/id="send" data-action="mic"/);
 assert.ok(!html.includes('id="web"'));
 assert.ok(!html.includes('id="voice"'));
 assert.ok(!html.includes('id="addPhoto"'));
 assert.ok(!html.includes('search:cfg.web'));
 assert.match(html,/button\.type=action==="send"\?"submit":"button"/);
 assert.match(html,/create\(\{[\s\S]*?apiBase:API_BASE/);
});
test("Recorder supports Safari mp4 and Chromium webm as inputs",()=>{
 assert.equal(voice.preferredAudioType({isTypeSupported:t=>t==="audio/mp4"}),"audio/mp4");
 assert.equal(voice.preferredAudioType({isTypeSupported:t=>t==="audio/webm;codecs=opus"}),"audio/webm;codecs=opus");
 assert.equal(voice.preferredAudioType({isTypeSupported:()=>false}),"");
});
test("Hold microphone records until release, uploads speech and handles transcript",async()=>{
 const priorNavigator=Object.getOwnPropertyDescriptor(globalThis,"navigator");
 const priorRecorder=Object.getOwnPropertyDescriptor(globalThis,"MediaRecorder");
 const priorFetch=globalThis.fetch;
 const statuses=[],stopped=[],uploaded=[];
 const stream={getTracks:()=>[{stop:()=>stopped.push("stopped")}]};
 class Recorder {
  static isTypeSupported(type){return type==="audio/webm"}
  constructor(_stream,options){this.mimeType=options?.mimeType||"audio/webm";this.state="inactive"}
  start(){this.state="recording"}
  stop(){
   this.state="inactive";
   this.ondataavailable?.({data:new Blob([new Uint8Array(800)],{type:"audio/webm"})});
   this.onstop?.();
  }
 }
 try{
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}});
  Object.defineProperty(globalThis,"MediaRecorder",{configurable:true,value:Recorder});
  globalThis.fetch=async(url,opts)=>{
   assert.match(url,/\/api\/transcribe$/);
   uploaded.push(opts.body.get("audio"));
   return Response.json({text:"Сделай игру танки",usage:{remaining:{chat:57,code:10}}});
  };
  const result=new Promise((resolve,reject)=>{
   const controller=voice.create({
    apiBase:"https://jvex-api.example.workers.dev",
    isEnabled:()=>true,
    onState:x=>statuses.push(x),
    onText:resolve,
    onError:reject
   });
   controller.begin().then(async()=>{
    await new Promise(r=>setTimeout(r,330));
    controller.end(false);
   }).catch(reject);
  });
  const transcript=await Promise.race([result,new Promise((_,r)=>setTimeout(()=>r(Error("voice test timed out")),3000))]);
  assert.equal(transcript,"Сделай игру танки");
  assert.ok(statuses.includes("recording"));
  assert.ok(statuses.includes("processing"));
  assert.equal(statuses.at(-1),"idle");
  assert.equal(uploaded.length,1);
  assert.ok(uploaded[0].size>=200);
  assert.ok(stopped.length>0);
 }finally{
  if(priorNavigator)Object.defineProperty(globalThis,"navigator",priorNavigator);
  else delete globalThis.navigator;
  if(priorRecorder)Object.defineProperty(globalThis,"MediaRecorder",priorRecorder);
  else delete globalThis.MediaRecorder;
  globalThis.fetch=priorFetch;
 }
});
