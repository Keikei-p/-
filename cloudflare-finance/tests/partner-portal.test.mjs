import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const html=readFileSync(new URL("../preview/partner.html",import.meta.url),"utf8");
test("Partner UI is OFF by default, has no raw Firestore SDK and uses protected endpoints only",()=>{
  assert.match(html,/const PARTNER_GATEWAY_URL\s*=\s*""/);
  assert.doesNotMatch(html,/firebase-firestore\.js|\bgetFirestore\(|\bonSnapshot\(/);
  assert.match(html,/\/v1\/partner-dashboard/);
  assert.match(html,/\/v1\/count-record/);
  assert.match(html,/\.getIdToken\(/);
  assert.match(html,/product\.cashbackPlans/);
  assert.match(html,/CB /);
  assert.doesNotMatch(html,/option\.revenuePerUnit|option\.totalRevenue/);
  assert.match(html,/\.emailVerified/);
  assert.match(html,/record\.recordVersion/);
  assert.match(html,/\bpartner-dashboard/);
  assert.match(html,/replaceChildren\(/);
  assert.match(html,/document\.createElement/);
  assert.doesNotMatch(html,/\binnerHTML\s*=/);
});
test("Partner standalone module parses with Node 22 without any network calls",()=>{
  const marker='<script type="module">';
  const start=html.indexOf(marker),end=html.indexOf("</script>",start);
  assert.ok(start>=0 && end>start);
  const d=mkdtempSync(join(tmpdir(),"sales-partner-check-"));
  try{
    const file=join(d,"partner.mjs");
    writeFileSync(file,html.slice(start+marker.length,end));
    execFileSync(process.execPath,["--check",file],{stdio:"pipe"});
  }finally{rmSync(d,{recursive:true,force:true});}
});
