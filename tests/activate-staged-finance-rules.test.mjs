import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {originalRules,proposeSecondaryFinanceFence}
 from "../security/secondary-finance-read-fence.mjs";
import {switchFinanceRules,PINNED}
 from "../tools/production/activate-staged-finance-rules.mjs";
const backup=()=>({readyBackups:7,latestReadySnapshot:new Date().toISOString()});
function fake({active=PINNED.original,corrupt=null,breakReadback=false}={}){
 const x={active,calls:[],throwReadOnce:false};
 x.request=async(method,path,body)=>{
  x.calls.push({method,path,body});
  if(method==="GET"){
   if(path===PINNED.release){
    if(x.throwReadOnce){x.throwReadOnce=false;return {name:PINNED.release,rulesetName:PINNED.original};}
    return {name:PINNED.release,rulesetName:x.active};
   }
   if(path===PINNED.original)return {source:{files:[{name:"firestore.rules",
    content:corrupt==="old"?"bad":originalRules()}]}};
   if(path===PINNED.staged)return {source:{files:[{name:"firestore.rules",
    content:corrupt==="staged"?"bad":proposeSecondaryFinanceFence()}]}};
   throw Error("unexpected GET path");
  }
  if(method==="PATCH"){
   assert.equal(path,PINNED.release);
   assert.equal(body.updateMask,"rulesetName");
   assert.deepEqual(Object.keys(body.release).sort(),["name","rulesetName"]);
   assert.equal(body.release.name,PINNED.release);
   assert([PINNED.original,PINNED.staged].includes(body.release.rulesetName));
   x.active=body.release.rulesetName;
   if(breakReadback&&x.active===PINNED.staged){x.throwReadOnce=true;}
   return {name:PINNED.release,rulesetName:x.active};
  }
  throw Error("unexpected method");
 };
 return x;
}
const approval={functionsReady:true,backup:backup(),
 ownerBeforeAttested:true,partnerCountsBeforeAttested:true,operatorApproval:true};
test("inspect reads exactly reviewed old/staged Rules and NEVER sends PATCH",async()=>{
 const x=fake(),out=await switchFinanceRules({request:x.request});
 assert.equal(out.inspected,true);
 assert.equal(out.activeIsOriginal,true);
 assert.equal(out.releaseUpdated,false);
 assert.equal(out.realAccountFinanceProof,false);
 assert.deepEqual([...new Set(x.calls.map(c=>c.method))],["GET"]);
 assert.equal(x.calls.length,3);
});
test("apply switches only the registered exact candidate, never edits any original",async()=>{
 const x=fake(),out=await switchFinanceRules({mode:"apply",request:x.request,...approval});
 assert.equal(x.active,PINNED.staged);
 assert.equal(out.stagedRulesNowLive,true);
 assert.equal(out.productionDocumentWrites,0);
 assert.equal(out.userRealPartnerDeniedProved,false);
 assert.equal(out.furtherLiveUserVerificationRequired,true);
 assert.equal(x.calls.filter(c=>c.method==="PATCH").length,1);
 const status=await switchFinanceRules({request:x.request});
 assert.equal(status.activeIsStaged,true);
 assert.equal(status.activeIsOriginal,false);
});
test("single reviewed rollback returns to old Rules and refuses unrelated release",async()=>{
 const x=fake({active:PINNED.staged});
 const back=await switchFinanceRules({mode:"rollback",request:x.request,operatorApproval:true});
 assert.equal(back.returnedToOriginal,true);
 assert.equal(x.active,PINNED.original);
 assert.equal((await switchFinanceRules({mode:"rollback",request:x.request,operatorApproval:true})).alreadyOriginal,true);
 assert.equal(x.calls.filter(c=>c.method==="PATCH").length,1);
});
test("apply cannot happen without real operator attestation, count access, and fresh backup",async()=>{
 for(const changes of [
  {operatorApproval:false},{functionsReady:false},{ownerBeforeAttested:false},
  {partnerCountsBeforeAttested:false},{backup:null},
  {backup:{readyBackups:0,latestReadySnapshot:new Date().toISOString()}},
  {backup:{readyBackups:1,latestReadySnapshot:new Date(Date.now()-49*3600000).toISOString()}},
  {backup:{readyBackups:1,latestReadySnapshot:new Date(Date.now()+60000).toISOString()}}
 ]){
  const x=fake();
  await assert.rejects(switchFinanceRules({
   mode:"apply",request:x.request,...approval,...changes
  }),/STOP_FINANCE_RULES_CUTOVER/);
  assert.equal(x.calls.filter(c=>c.method==="PATCH").length,0);
 }
});
test("unknown live rules or a changed Ruleset source blocks both deploy and rollback",async()=>{
 for(const corrupt of ["old","staged"]){
  const x=fake({corrupt});
  await assert.rejects(switchFinanceRules({
   mode:"apply",request:x.request,...approval
  }),/LIVE_SOURCE_DRIFT/);
  assert.equal(x.calls.filter(c=>c.method==="PATCH").length,0);
 }
 const x=fake({active:"projects/sales-management-cc116/rulesets/foreign"});
 await assert.rejects(switchFinanceRules({mode:"rollback",request:x.request,
  operatorApproval:true}),/LIVE_RELEASE_UNKNOWN/);
 assert.equal(x.calls.filter(c=>c.method==="PATCH").length,0);
});
test("post-write readback mismatch triggers exact original Rules rollback",async()=>{
 const x=fake({breakReadback:true});
 await assert.rejects(switchFinanceRules({mode:"apply",request:x.request,...approval}),
  /STAGED_RELEASE_NOT_READ_BACK/);
 assert.equal(x.active,PINNED.original);
 assert.deepEqual(x.calls.filter(c=>c.method==="PATCH").map(c=>c.body.release.rulesetName),
  [PINNED.staged,PINNED.original]);
});
test("cannot impersonate release approval or invent an unreviewed mode",async()=>{
 const x=fake();
 for(const mode of ["publish","force","delete","default",""]){
  await assert.rejects(switchFinanceRules({mode,request:x.request,operatorApproval:true}),
   /INVALID_MODE/);
 }
 await assert.rejects(switchFinanceRules({mode:"rollback",request:x.request}),
  /EXPLICIT_OPERATOR_APPROVAL_REQUIRED/);
});
test("live bridge is GitHub main-only, allowlisted Rules API and never touches Firestore documents",()=>{
 const cli=readFileSync(new URL("../tools/production/finance-rule-switch-cli.mjs",import.meta.url),"utf8");
 const m=readFileSync(new URL("../tools/production/activate-staged-finance-rules.mjs",import.meta.url),"utf8");
 assert.match(cli,/GITHUB_EVENT_NAME!=="workflow_dispatch"/);
 assert.match(cli,/GITHUB_REF!=="refs\/heads\/main"/);
 assert.match(cli,/FIREBASE_PROJECT_ID!==PROJECT/);
 assert.match(cli,/INSPECT_ONLY/);
 assert.match(cli,/OWNER_FINANCE_LOGIN_READ_VERIFIED/);
 assert.match(cli,/PARTNER_COUNTS_SAVE_CORRECT_VERIFIED/);
 assert.match(m,/updateMask:"rulesetName"/);
 assert.doesNotMatch(m+cli,/method:"DELETE"|method:"POST"|firestore\/(?:delete|documents)|firebase deploy|writeBatch|setDoc[(]|updateDoc[(]/);
 assert.equal(PINNED.project,"sales-management-cc116");
 assert.equal(PINNED.candidateSha256,
  "25fd2c0257e92beb5ba9e3b2f8b3a5801d2fa010188675c685c05051eafb12a8");
});


test("main SHA revalidation uses real GitHub Actions token, not a placeholder",()=>{
 const workflow=readFileSync(new URL(
  "../.github/workflows/nico-staged-finance-rules-manual.yml",import.meta.url),"utf8");
 const actualToken="GH_TOKEN: "+"$"+"{{ github.token }}";
 assert.match(workflow,/workflow_dispatch:/);
 assert.equal(workflow.split(actualToken).length,3,
  "both main revalidation steps require real GitHub Actions token");
 assert.doesNotMatch(workflow,/__GH_TOKEN__|__FIREBASE_SECRET__|__GATED_RELEASE__/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/inputs\.reviewed_main_sha == github\.sha/);
 assert.match(workflow,/test "\$GITHUB_SHA" = "\$\(gh api repos\/Keikei-p\/-\/branches\/main/);
 assert.match(workflow,/type: choice/);
 assert.match(workflow,/options: \[inspect, apply, rollback\]/);
 assert.doesNotMatch(workflow,/firebase deploy|firebase firestore:delete/);
});

test("emergency rollback skips emulator and Functions CLI while apply stays gated",()=>{
 const workflow=readFileSync(new URL(
  "../.github/workflows/nico-staged-finance-rules-manual.yml",import.meta.url),"utf8");
 const cli=readFileSync(new URL(
  "../tools/production/finance-rule-switch-cli.mjs",import.meta.url),"utf8");
 assert.match(workflow,/name: Prove count save\/correction plus raw finance deny[^]*?if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.mode != 'rollback' \}\}/);
 assert.match(workflow,/name: Install pinned Firebase CLI for inspect\/apply only\n\s+if: \$\{\{ inputs\.mode != 'rollback' \}\}/);
 assert.match(workflow,/name: GET-only confirm 4 ACTIVE count Functions[^]*?if: \$\{\{ inputs\.mode != 'rollback' \}\}/);
 assert.match(cli,/let ready=false;\s*if\(mode!=="rollback"\)\{/);
 assert.match(cli,/if\(!scope\|\|path\.dirname/);
 assert.match(cli,/switchFinanceRules\(\{[\s\S]*functionsReady:ready/);
});
