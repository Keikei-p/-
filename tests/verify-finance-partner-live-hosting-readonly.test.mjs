import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {uploadSha} from "../tools/hosting/owner-setup-additive-guard.mjs";
import {assessManifest} from "../tools/production/verify-finance-partner-live-hosting-readonly.mjs";
const name="/finance-partner-boundary-check.html";
const version="sites/nico-factory/versions/bd2bedba406f133d";
const origin=["/","/index.html","/finance-boundary-check.html",
 "/owner-partner-setup.html","/partner-workspace.html",
 "/partner-counts.html","/partner-invite.html"];
const more=Array.from({length:30-origin.length},(_,i)=>"/safe-file-"+i+".js");
const old=[...origin,...more].map((path,i)=>({path,
 hash:(i+1).toString(16).padStart(64,"0")}));
const source=readFileSync(new URL("../finance-partner-boundary-check.html",import.meta.url),"utf8");
const key=uploadSha(source);
const current=()=>[...old,{path:name,hash:key}];
test("independently confirms only new page with exact approved sha256 plus all 30 old paths",()=>{
 const actual=assessManifest({oldFiles:old,newFiles:current(),
  liveVersion:version,expectedNewHash:key});
 assert.equal(actual.approvedNewAssets,1);
 assert.equal(actual.originalHostingAssetsUnchanged,30);
 assert.equal(actual.originalFinanceDiagnosticUnchanged,true);
 assert.equal(actual.productionFirestoreWrites,0);
});
test("if any old asset changes/disappears or another is added, fail closed",()=>{
 const fail=newFiles=>assert.throws(()=>assessManifest({
  oldFiles:old,newFiles,liveVersion:version,expectedNewHash:key
 }),/STOP_PARTNER_FINANCE_LIVE_READONLY_/);
 fail(current().map((x,i)=>i===5?{...x,hash:"f".repeat(64)}:x));
 fail(current().slice(1));
 fail([...current(),{path:"/extra.html",hash:"a".repeat(64)}]);
 fail([...current().slice(0,-1),old[0]]);
 fail([...old,old[0]]);
 fail(current().map(x=>x.path===name?{...x,hash:"c".repeat(64)}:x));
 assert.throws(()=>assessManifest({
  oldFiles:old,newFiles:current(),liveVersion:"sites/nico-factory/versions/other",
  expectedNewHash:key
 }),/STOP_PARTNER_FINANCE_LIVE_READONLY_/);
});
test("no cloud write API verbs, no live finance reads, only original public page verified",()=>{
 const s=readFileSync(new URL(
  "../tools/production/verify-finance-partner-live-hosting-readonly.mjs",import.meta.url
 ),"utf8");
 assert.match(s,/method:"GET"/);
 assert.match(s,/realPartnerFinanceGetListDeniedVerified:false/);
 assert.match(s,/safeToEnableJointRanking:false/);
 assert.match(s,/liveOriginalFinanceDiagnosticByteMatched:true/);
 assert.doesNotMatch(s,/method:"(?:POST|PATCH|PUT|DELETE)"|firebase deploy|setDoc\(|updateDoc\(|\.delete\(/);
 assert.doesNotMatch(s,/firestore[.]googleapis[.]com|cloudfunctions[.]googleapis[.]com/);
});
