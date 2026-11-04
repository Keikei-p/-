#!/usr/bin/env node
/**
 * Syntax-only HTML module extraction. Never executes app code, imports
 * Firebase modules, uses a browser, or accesses production data.
 */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const targets=['index.html','partner-workspace.html'];
const tmp=mkdtempSync(join(tmpdir(),'nico-syntax-'));
let count=0;
try{
 for(const file of targets){
  const content=readFileSync(join(root,file),'utf8');
  const modules=[...content.matchAll(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/gi)];
  if(!modules.length)throw Error('NO_INLINE_MODULE_'+file);
  for(let i=0;i<modules.length;i++){
   const target=join(tmp,'inline-'+(count++)+'.mjs');
   writeFileSync(target,modules[i][1]);
   try{execFileSync(process.execPath,['--check',target],{stdio:'pipe',timeout:20000});}
   catch{throw Error('INVALID_INLINE_MODULE_'+file+'_'+i);}
  }
 }
 console.log('PASS_INLINE_MODULE_SYNTAX '+count);
}catch(e){
 console.error('STOP_INLINE_HTML_MODULE_PARSE_'+String(e?.message||'unknown'));
 process.exitCode=1;
}finally{rmSync(tmp,{recursive:true,force:true});}
