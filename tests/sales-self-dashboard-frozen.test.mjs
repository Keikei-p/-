/**
 * User-approved production preservation contract (2026-11-21).
 *
 * The original internal NICO SALES app is already complete. Partner users
 * may enter count-only records in the SAME index.html, but absolutely no
 * internal owner/dashboard/record form/finance/ranking UI may be redesigned.
 *
 * Compare original source sections to the exact reviewed production main
 * commit. Any modification is a hard CI failure requiring a separate,
 * explicit owner-approved internal app change. NEVER alter business data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const APPROVED_INTERNAL_MAIN="ff3c024a18c48a0f0b95fa672b860c8dfe98805e";
const current=readFileSync(join(root,"index.html"),"utf8");
const original=execFileSync("git",[
 "show",APPROVED_INTERNAL_MAIN+":index.html"
],{cwd:root,encoding:"utf8",maxBuffer:4*1024*1024,timeout:15000});

function exactlyBetween(source,start,end){
 const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
 assert(i>=0&&j>i,"missing reviewed original sales region: "+start);
 assert.equal(source.indexOf(start,i+1),-1,"duplicate original boundary: "+start);
 return source.slice(i,j);
}
test("the ENTIRE original internal record form and dashboard markup is identical to production",()=>{
 const begin='id="recordManagement"',end='<script type="module">';
 assert.equal(exactlyBetween(current,begin,end),exactlyBetween(original,begin,end),
  "Do not change even the position or appearance of the complete internal sales UI");
});
test("the original internal finance, dashboard and all ranking renderers are byte-identical",()=>{
 const regions=[
  ["function applyRevenueVisibility() {","function renderDashboard() {"],
  ["function renderDashboard() {","</script>"]
 ];
 for(const [start,end] of regions){
  assert.equal(exactlyBetween(current,start,end),exactlyBetween(original,start,end),
   "Original main app renderer/finance must remain unchanged: "+start);
 }
});
test("partners use a separate count-only backend under the SAME main app, not the internal finance writer",()=>{
 assert.match(current,/<main id="appScreen">/);
 assert.match(current,/id="partnerInlineWorkspace"/);
 assert.match(current,/appScreen\.dataset\.partnerCountOnly="true"/);
 assert.match(current,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(current,/const snap=\(await partnerMainCountRead\(payload\)\)\.data/);
 assert.match(current,/partnerMainCountSubmit\(partnerInlinePayload\(\{/);
 assert.doesNotMatch(exactlyBetween(current,
  "async function openSameAppCompanyCodeWorkspace(){",
  "// Existing Firebase email partner behavior remains untouched."),
  /\b(?:setDoc|updateDoc|deleteDoc|addDoc)\(/,
  "company-code routing is only a read-only count UI bootstrap");
});
