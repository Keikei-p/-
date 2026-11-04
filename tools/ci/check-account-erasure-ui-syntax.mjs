#!/usr/bin/env node
// Never execute the browser JS or Firebase SDK. Parse the shipped HTML
// module syntax only; generated temporary files are removed immediately.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
const temp=mkdtempSync(join(tmpdir(),"nico-erasure-html-"));
try{
 const html=readFileSync(join(root,"index.html"),"utf8");
 const scripts=[...html.matchAll(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/gi)];
 if(!scripts.length)throw Error("NO_BROWSER_MODULE");
 scripts.forEach((m,i)=>{
  const file=join(temp,"module-"+i+".mjs");
  writeFileSync(file,m[1]);
  execFileSync(process.execPath,["--check",file],{stdio:"pipe",timeout:20000});
 });
 console.log("PASS_ERASURE_UI_MODULE_SYNTAX "+scripts.length);
}catch{
 console.error("STOP_ERASURE_INLINE_MODULE_INVALID");
 process.exitCode=1;
}finally{
 rmSync(temp,{recursive:true,force:true});
}
