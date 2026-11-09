import {test} from "node:test";
import assert from "node:assert/strict";
import "../../assets/format.js";
const f=globalThis.JVEXFiles,mark=String.fromCharCode(96).repeat(3);
test("Code response creates real named .html and .js files",()=>{
 const input="Вот проект:\n"+mark+"html file=index.html\n<h1>JVEX</h1>\n"+mark+"\n"+mark+"javascript file=src/app.js\nalert('ok');\n"+mark;
 const files=f.blocks(input);
 assert.deepEqual(files.map(x=>x.filename),["index.html","src/app.js"]);
 assert.equal(files[0].content,"<h1>JVEX</h1>");
 assert.equal(files[1].content,"alert('ok');");
});
test("Code response can detect filename headings",()=>{
 const files=f.blocks("### app.py\n"+mark+"python\nprint('JVEX')\n"+mark);
 assert.equal(files[0].filename,"app.py");
});
test("Archive names are sanitized and cannot traverse directories",()=>{
 assert.equal(f.safePath("../../secret.txt","safe.txt"),"safe.txt");
 assert.equal(f.safePath("/etc/passwd","safe.txt"),"safe.txt");
 assert.equal(f.safePath("src/main.py","safe.txt"),"src/main.py");
});
test("ZIP output contains valid PK headers, central directory and two files",async()=>{
 const blob=f.zipBlob([{filename:"index.html",content:"<html></html>"},{filename:"src/main.js",content:"console.log('x')"}]);
 const b=new Uint8Array(await blob.arrayBuffer());
 const d=new DataView(b.buffer);
 assert.equal(d.getUint32(0,true),0x04034b50);
 assert.equal(d.getUint32(b.length-22,true),0x06054b50);
 assert.equal(d.getUint16(b.length-22+10,true),2);
 assert.ok(blob.size>100);
});
class Node {
 constructor(tag){this.tag=tag;this.children=[];this._text=""}
 append(...nodes){this.children.push(...nodes)}
 set textContent(value){this._text=value;this.children=[]}
 get textContent(){return this._text+this.children.map(x=>x.textContent||"").join("")}
}
test("Markdown emphasis and numbered items create text nodes without raw HTML",()=>{
 const prior=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>{const n=new Node("#text");n.textContent=text;return n}};
 try{
  const target=new Node("root");
  f.render(target,"**Заголовок**\n\n1. Первый\n2. Второй");
  assert.equal(target.children[0].tag,"p");
  assert.equal(target.children[0].children[0].tag,"strong");
  assert.equal(target.children[0].textContent,"Заголовок");
  assert.equal(target.children[1].tag,"ol");
  assert.equal(target.children[1].children.length,2);
 }finally{globalThis.document=prior}
});

test("Partial animated code cannot be downloaded until complete",()=>{
 const previous=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>{let n=new Node("#text");n.textContent=text;return n}};
 const traverse=(n)=>[n,...(n.children||[]).flatMap(traverse)];
 try{
  const code="Файл:\n"+mark+"html file=index.html\n<html><body>JVEX</body></html>\n"+mark;
  const partial=new Node("root");f.render(partial,code,{partial:true});
  assert.equal(traverse(partial).filter(x=>x.tag==="button").length,0);
  const full=new Node("root");f.render(full,code,{partial:false});
  assert.ok(traverse(full).filter(x=>x.tag==="button").length>=2);
 }finally{globalThis.document=previous}
});
