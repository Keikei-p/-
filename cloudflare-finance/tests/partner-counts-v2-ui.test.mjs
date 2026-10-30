import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const html=readFileSync(new URL("../preview/partner-counts-v2.html",import.meta.url),"utf8");

test("smartphone form remains offline until approved release and canonical host",()=>{
 assert.match(html,/const RELEASE_ENABLED=false;/);
 assert.match(html,/const APPROVED_GATEWAY_BASE="";/);
 assert.match(html,/window\.location\.origin==="https:\/\/nico-factory\.web\.app"/);
 assert.match(html,/id="loginButton"[^>]*disabled/);
 assert.match(html,/\bvalidRelease\(\)/);
 assert.match(html,/\bsetPersistence\(auth,inMemoryPersistence\)/);
});
test("smartphone form uses only count-only trusted client and hides all money controls",()=>{
 assert.match(html,/partner-count-browser-client\.mjs/);
 assert.match(html,/client\.readCatalog\(\)/);
 assert.match(html,/client\.readDay\(/);
 assert.match(html,/client\.saveDay\(/);
 assert.match(html,/status:lines\.length\?"submitted":"no_result"/);
 assert.match(html,/state\.invalidHistory/);
 assert.match(html,/入力|件数/);
 assert.doesNotMatch(html,/(?:firebase-firestore\.js|\bonSnapshot\(|\bgetFirestore\(|\bgetDoc\(|\bsetDoc\(|\baddDoc\(|\bdeleteDoc\()/);
 assert.doesNotMatch(html,/\binnerHTML\s*=/);
 assert.doesNotMatch(html,/\blocalStorage\s*[.(]|\bsessionStorage\s*[.(]/);
 assert.doesNotMatch(html,/id="(?:unitPrice|totalRevenue|commission|profit|price)"/i);
});
test("standalone UI module parses under Node and contains no production startup side effect",()=>{
 const start=html.indexOf('<script type="module">');
 const end=html.indexOf("</script>",start);
 assert(start>=0&&end>start);
 const src=html.slice(start+'<script type="module">'.length,end);
 const dir=mkdtempSync(join(tmpdir(),"sales-partner-count-ui-"));
 try{
  const path=join(dir,"ui.mjs");
  writeFileSync(path,src);
  execFileSync(process.execPath,["--check",path],{stdio:"pipe"});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
