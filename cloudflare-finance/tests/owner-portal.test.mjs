import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
const html=readFileSync(new URL("../preview/owner.html",import.meta.url),"utf8");
test("Owner preview is disabled, displays ranking and activates only via secure gateway",()=>{
  assert.match(html,/const OWNER_GATEWAY_URL=""/);
  assert.match(html,/\/v1\/owner-count-overview/);
  assert.match(html,/\/v1\/partner-activate/);
  assert.match(html,/\.emailVerified/);
  assert.match(html,/getIdToken\(/);
  assert.doesNotMatch(html,/firebase-firestore\.js|\bgetFirestore\(|\bonSnapshot\(/);
  assert.doesNotMatch(html,/\.innerHTML\s*=/);
});
test("Owner preview module parses independently on Node",()=>{
 const marker='<script type="module">',start=html.indexOf(marker),end=html.indexOf("</script>",start);
 assert.ok(start>=0&&end>start);
 const folder=mkdtempSync(join(tmpdir(),"sales-owner-check-"));
 try{
  const file=join(folder,"owner.mjs");
  writeFileSync(file,html.slice(start+marker.length,end));
  execFileSync(process.execPath,["--check",file],{stdio:"pipe"});
 }finally{rmSync(folder,{recursive:true,force:true});}
});
