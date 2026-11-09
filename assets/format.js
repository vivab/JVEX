// Safe JVEX Markdown and downloadable code files; no external dependencies.
(function(root){
"use strict";
const T=String.fromCharCode(96),F=T+T+T;
const EXT={javascript:"js",js:"js",typescript:"ts",ts:"ts",python:"py",py:"py",html:"html",css:"css",json:"json",bash:"sh",shell:"sh",sql:"sql",markdown:"md",md:"md",yaml:"yml",yml:"yml",java:"java",kotlin:"kt",cpp:"cpp",rust:"rs",go:"go",jsx:"jsx",tsx:"tsx"};
function safePath(raw,fallback){
 const p=String(raw||"").trim().replace(/^["']|["']$/g,"").replace(/\\/g,"/");
 if(!p||p.startsWith("/")||/(^|\/)\.\.(\/|$)/.test(p)||/^[a-z]:/i.test(p))return fallback;
 return p.replace(/^\.\//,"").replace(/[^a-zA-Z0-9_\-./@]/g,"_").slice(0,140)||fallback;
}
function fileName(header,n,preceding){
 const lang=header.trim().split(/\s+/)[0].toLowerCase();
 let match=header.match(/(?:filename?|path)\s*[:=]\s*(\S+)/i);
 if(!match)match=header.match(/^(?:[\w+#-]+)\s+((?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]{1,10})$/i);
 if(!match&&/^(?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]{1,10}$/i.test(header.trim()))match=[header,header.trim()];
 if(!match)match=String(preceding||"").split("\n").slice(-2).join("\n").match(/(?:^|\n)(?:#+\s*|файл:\s*|file:\s*)([\w.-]+(?:\/[\w.-]+)*\.[a-z0-9]{1,10})\s*$/i);
 return safePath(match?.[1],"snippet-"+n+"."+(EXT[lang]||"txt"));
}
function blocks(raw){
 const parts=String(raw||"").split(F),out=[];let preceding="";
 for(let i=0;i<parts.length;i++){
   if(i%2===0){preceding+=parts[i];continue}
   const lines=parts[i].replace(/\r\n/g,"\n").split("\n");
   const header=lines.shift().trim();
   if(!lines.length)continue;
   const body=lines.join("\n").replace(/^\n/,"").replace(/\n$/,"");
   if(out.length>=20)break;
   out.push({filename:fileName(header,out.length+1,preceding),content:body.slice(0,200000),header});
 }
 return out;
}
function inline(parent,text){
 const rg=new RegExp("(\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\*[^*\\n]+\\*|"+T+"[^"+T+"\\n]+"+T+")","g");
 let last=0,m;
 while((m=rg.exec(text))!==null){
   if(m.index>last)parent.append(document.createTextNode(text.slice(last,m.index)));
   const token=m[0];
   let el;
   if(token.startsWith("**")||token.startsWith("__")){el=document.createElement("strong");el.textContent=token.slice(2,-2)}
   else if(token.startsWith("*")){el=document.createElement("em");el.textContent=token.slice(1,-1)}
   else{el=document.createElement("code");el.textContent=token.slice(1,-1)}
   parent.append(el);last=rg.lastIndex;
 }
 if(last<text.length)parent.append(document.createTextNode(text.slice(last)));
}
function markdown(target,raw){
 let pending=[],list=null,kind="";
 const flush=()=>{if(pending.length){const p=document.createElement("p");inline(p,pending.join("\n"));target.append(p);pending=[]}};
 for(const line of String(raw||"").replace(/\r\n/g,"\n").split("\n")){
  const trimmed=line.trim();
  if(!trimmed){flush();list=null;kind="";continue}
  const heading=line.match(/^(#{1,4})\s+(.+)$/);
  if(heading){flush();list=null;const h=document.createElement(heading[1].length<=2?"h3":"h4");inline(h,heading[2]);target.append(h);continue}
  const item=line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
  if(item){
    flush();const next=item[2]?"ol":"ul";if(!list||kind!==next){list=document.createElement(next);target.append(list);kind=next}
    const li=document.createElement("li");inline(li,item[3]);list.append(li);continue;
  }
  list=null;kind="";
  if(trimmed.startsWith("> ")){flush();const b=document.createElement("blockquote");inline(b,trimmed.slice(2));target.append(b);continue}
  if(/^---+$/.test(trimmed)){flush();target.append(document.createElement("hr"));continue}
  pending.push(line);
 }
 flush();
}
function download(name,body,mime="text/plain;charset=utf-8"){
 const blob=body instanceof Blob?body:new Blob([body],{type:mime});
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
const enc=new TextEncoder();
function crc32(bytes){let x=0xffffffff;for(const b of bytes){x^=b;for(let i=0;i<8;i++)x=(x>>>1)^((x&1)?0xedb88320:0)}return (x^0xffffffff)>>>0}
function zipBlob(files){
 const local=[],central=[];let offset=0,size=0;
 for(const f of files.slice(0,20)){
  const name=enc.encode(safePath(f.filename,"file.txt")),data=enc.encode(f.content);
  const crc=crc32(data),a=new Uint8Array(30+name.length),v=new DataView(a.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);
  v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);a.set(name,30);local.push(a,data);
  const b=new Uint8Array(46+name.length),w=new DataView(b.buffer);
  w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x0800,true);
  w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);
  w.setUint32(42,offset,true);b.set(name,46);central.push(b);
  offset+=a.length+data.length;size+=b.length;
 }
 const end=new Uint8Array(22),v=new DataView(end.buffer);
 v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);
 v.setUint32(12,size,true);v.setUint32(16,offset,true);
 return new Blob([...local,...central,end],{type:"application/zip"});
}
function button(label,fn){const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=fn;return b}
function render(target,text){
 const parts=String(text||"").split(F),files=blocks(text);
 if(parts.length===1){markdown(target,text);return}
 let n=0;
 for(let i=0;i<parts.length;i++){
  if(i%2===0){markdown(target,parts[i]);continue}
  const f=files[n++];if(!f)continue;
  const holder=document.createElement("div");holder.className="code-file";
  const toolbar=document.createElement("div");toolbar.className="code-toolbar";
  const name=document.createElement("span");name.textContent=f.filename;name.className="code-name";
  toolbar.append(name,button("Копировать",()=>navigator.clipboard?.writeText(f.content).catch(()=>{})),button("↓ Файл",()=>download(f.filename,f.content)));
  const pre=document.createElement("pre"),code=document.createElement("code");code.textContent=f.content;
  pre.append(code);holder.append(toolbar,pre);target.append(holder);
 }
 const controls=document.createElement("div");controls.className="file-actions";
 if(files.length>1)controls.append(button("↓ Скачать проект ZIP ("+files.length+" файлов)",()=>download("JVEX-project.zip",zipBlob(files),"application/zip")));
 controls.append(button("↓ Скачать ответ TXT",()=>download("JVEX-answer.txt",text)));
 target.append(controls);
}
root.JVEXFiles={render,blocks,safePath,zipBlob,crc32};
})(typeof window!=="undefined"?window:globalThis);
