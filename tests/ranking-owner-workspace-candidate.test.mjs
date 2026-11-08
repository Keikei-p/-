import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {
 buildRankingOwnerWorkspaceCandidate,buildCandidateFromRepo,
 REVIEWED_PARTNER_HTML_BLOB
} from "../tools/ranking/build-owner-settings-workspace-candidate.mjs";

const root=new URL("../",import.meta.url);
const files={
 original:readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8"),
 panel:readFileSync(new URL("../ranking/owner-ranking-consent-panel.mjs",import.meta.url),"utf8"),
 bridge:readFileSync(new URL("../ranking/owner-ranking-consent-firebase-bridge.mjs",import.meta.url),"utf8"),
 css:readFileSync(new URL("../ranking/owner-ranking-consent-panel.css",import.meta.url),"utf8")
};
const generate=(opts={})=>buildRankingOwnerWorkspaceCandidate({...files,...opts});
const count=(s,k)=>s.split(k).length-1;
test("original partner-workspace source is pinned, immutable and generated copy is deterministic",()=>{
 assert.equal(REVIEWED_PARTNER_HTML_BLOB,"00d6d503f9061dba2b6113e52b99cb9c4ea3aedf");
 const before=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
 const a=buildCandidateFromRepo(),b=generate();
 assert.equal(a,b);
 assert.equal(readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8"),before);
 assert.equal(a.startsWith("<!doctype html>"),true);
 assert(a.length>before.length);
 for(const key of ["submitPartnerWorkspaceCounts","getPartnerWorkspace",
  "managePartnerWorkspace","acceptPartnerWorkspaceInvite","loginPartnerCompanyCode",
  "partnerPanel-individual","partnerPanel-productRanking",
  "privateCountGrid","hubInviteCompanySelect","rankingOwnerContent"])
  assert(a.includes(key),"preserve app or add settings "+key);
 assert.equal(count(a,'id="tabRankingSettings"'),1);
 assert.equal(count(a,'id="rankingOwnerBox"'),1);
 assert.equal(count(a,'id="rankingOwnerContent"'),1);
 assert.equal(count(a,'id="tabMissing"'),1);
 assert.equal(count(a,'id="tabRecords"'),1);
 assert.equal(count(a,'id="tabDashboard"'),1);
 assert.equal(count(a,'id="tabPeople"'),1);
 assert.equal(count(a,'id="tabView"'),1);
});
test("candidate visibly matches existing dashboard and never becomes a second app",()=>{
 const html=generate();
 assert(html.includes('🔐 合同ランキング公開設定'));
 assert(html.includes('class="count-menu"'));
 assert(html.includes('class="dashboard-app-grid"'));
 assert(html.includes('RankingOwnerIntegration.createOwnerRankingConsentPanel'));
 assert(html.includes('RankingOwnerIntegration.createRankingOwnerFirebaseBridge'));
 assert(html.includes('getRankingOwnerConsentStatus'));
 assert(html.includes('setRankingOwnerConsent'));
 assert(html.includes('新APIの本番検証完了まではこの設定は利用できません'));
 assert.equal(count(html,'<script type="module">'),1);
 assert.equal(count(html,'</script>'),1);
 assert(!html.includes('src="./ranking/'));
 assert(!html.includes('src="../../ranking/'));
 assert(!html.includes('firebase-firestore.js'));
 assert(!html.includes('getFirestore('));
 assert(!html.includes('innerHTML='));
});
test("company-code users and cross-company secondary contexts cannot open owner settings",()=>{
 const html=generate(),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 assert(script);
 assert.match(script,/data[.]role==="hub"\|\|data[.]role==="owner"/);
 assert.match(script,/!activeCodeSession&&!workspaceCompanyId/);
 assert.match(script,/auth[.]currentUser[?][.]emailVerified===true/);
 assert.match(script,/sharedCodeSession:[(][)]=>Boolean[(]activeCodeSession\|\|workspaceCompanyId[)]/);
 assert.match(script,/if[(]name==="RankingSettings"&&!rankingOwnerAllowed[(][)][)]/);
 assert.match(script,/["]RankingSettings["]/);
 assert.match(script,/closeRankingOwnerPanel[(][)];\s*data=null/);
 assert.match(script,/onAuthStateChanged[(]auth,async u=>[{]\s*closeRankingOwnerPanel/);
});
test("status or logout never leaves previous company name in the candidate settings panel",()=>{
 const html=generate();
 assert.match(html,/function closeRankingOwnerPanel[(][)][{]/);
 assert.match(html,/rankingOwnerPanel[.]destroy[(][)]/);
 assert.match(html,/box[.]replaceChildren[(][)]/);
 assert.match(html,/if[(]nonce!==currentNonce\|\|auth[.]currentUser!==identity\|\|/);
 assert.match(html,/if[(]rankingOwnerPanel===thisPanel[)]closeRankingOwnerPanel[(][)]/);
 assert.match(html,/if[(]activeWorkspaceTab==="RankingSettings"&&rankingOwnerAllowed[(][)][)]void openRankingOwnerPanel[(][)]/);
});
test("generate fail-closed for unreviewed original, diverged UI JS and unexpected CSS",()=>{
 assert.throws(()=>generate({original:files.original+"\n"}),/STOP_RANKING_UI_ORIGINAL_BLOB_CHANGED/);
 assert.throws(()=>generate({original:files.original.replace("tabMissing","changed")}),
   /STOP_RANKING_UI_ORIGINAL_BLOB_CHANGED/);
 assert.throws(()=>generate({panel:files.panel.replace("export function createOwnerRankingConsentPanel","function changedPanel")}),
   /STOP_RANKING_UI_MODULE_EXPORT/);
 assert.throws(()=>generate({bridge:files.bridge.replace("export function createRankingOwnerFirebaseBridge","function evil")}),
   /STOP_RANKING_UI_MODULE_EXPORT/);
 assert.throws(()=>generate({css:files.css+"@import url('https://evil.example/x.css')"}),
   /STOP_RANKING_UI_UNSAFE_STYLE/);
});
test("one inlined owner settings module passes real Node syntax parse",()=>{
 const html=generate();
 const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert(match,"exact one inline main module");
 const temp=mkdtempSync(path.join(tmpdir(),"nico-owner-staging-"));
 try{
  const file=path.join(temp,"partner-owner-settings.mjs");
  writeFileSync(file,match[1],"utf8");
  assert.doesNotThrow(()=>execFileSync(process.execPath,["--check",file],{
   timeout:15000,stdio:["ignore","pipe","pipe"]
  }));
 }finally{rmSync(temp,{recursive:true,force:true});}
});
