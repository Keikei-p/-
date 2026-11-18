import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=path=>fs.readFileSync(new URL("../"+path,import.meta.url),"utf8");
const json=path=>JSON.parse(read(path));
test("shared partner eight-tab Functions have an isolated deploy manifest, never replace existing sources",()=>{
 const cfg=json("firebase.partner-tabs.json");
 const ranking=json("firebase.ranking-approvals.json");
 const workspace=json("firebase.partner-workspace.json");
 const root=json("firebase.json");
 assert.deepEqual(Object.keys(cfg),["functions"]);
 assert.deepEqual(cfg.functions,{
  source:"functions-partner-tabs",
  codebase:"partner-shared-tabs",
  ignore:["node_modules",".git","firebase-debug.log"]
 });
 assert.equal(ranking.functions.source,"functions-ranking-approvals");
 assert.equal(workspace.functions.source,"functions-partner-workspace");
 assert.equal(root.functions,undefined,"Default Firebase config must not deploy optional codebases automatically");
 assert.equal(json(".firebaserc").projects.default,"sales-management-cc116");
});
test("even if packaged, all tab release flags are OFF and do not expose financial originals",()=>{
 const server=read("functions-partner-tabs/index.js");
 const ranking=read("functions-ranking-approvals/index.js");
 const ui=read("index.html");
 assert(server.includes('process.env.NICO_PARTNER_TAB_PUBLICATION_ENABLED==="enabled"'));
 assert(server.includes('process.env.NICO_PARTNER_OPTIONAL_TAB_DATA_VERIFIED==="enabled"'));
 assert(server.includes("exports.getPartnerPublishedOptionalTab=onCall"));
 assert(server.includes("exports.getPartnerPublishedTabs=onCall"));
 assert(server.includes("exports.getOwnerPartnerTabPublication=onCall"));
 assert(ranking.includes('process.env.NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED==="enabled"'));
 assert(ranking.includes("enforcePartnerTabPublication:true"));
 assert(ranking.includes("publishedOnly:true"));
 assert(ui.includes("const NICO_SAME_APP_JOINT_HTTP_ENABLED = false;"));
 assert(ui.includes("const NICO_PARTNER_TAB_UI_ENABLED = false;"));
 assert(ui.includes("const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;"));
 const code=read("functions-partner-tabs/partner-optional-tab-reader.mjs");
 assert(code.includes('collection("partnerWorkAudits")'));
 assert(code.includes('collection("partnerWorkEntries")'));
 for(const term of ["revenueGoals","recordCorrections","products/","records/",
  "getUnitPrice","getRevenue"]){
  assert(!code.includes(term),"Forbidden finance original reference: "+term);
 }
 assert(!/\b(?:tx|db)\.(?:create|update|set|delete)\s*\(/.test(code));
});
test("code-principal revocation must be checked in each server read transaction",()=>{
 const store=read("functions-partner-tabs/partner-tab-publication-store.mjs");
 assert(store.includes('user.authKind==="partner_code_shared"'));
 assert(store.includes('col("partnerCodeCredentials").doc(partner)'));
 assert(store.includes("credential.active!==true"));
 assert(store.includes("credential.principalUid!==actor.uid"));
 assert(store.includes("credential.companyId!==partner"));
 assert(store.includes('verifiedPartnerViewer(tx,actor,workspaceCompanyId,true)'));
 assert(store.includes("{readOnly:true}"));
});
test("this gate does NOT count CI green as real-account E2E or backup restore proof",()=>{
 const rules=read("firestore.rules");
 assert(rules.includes("rules_version"));
 const s=read(".github/workflows/nico-managed-backup-restore-preflight-readonly.yml");
 const login=read(".github/workflows/nico-login-account-readiness-readonly.yml");
 assert(s.includes("READ ONLY")||s.includes("GET ONLY"));
 assert(s.includes("NO RESTORE"));
 assert(login.includes("LIVE READ ONLY"));
 // The live metadata/anonymous workflows cannot establish authenticated
 // financial GET/LIST denial or prove a restored isolated backup.
 assert(s.includes("REAL_PARTNER_ACCOUNT_FINANCE_GET_LIST_UNPROVEN=YES"));
 assert(!read("firebase.partner-tabs.json").includes("deploy"));
});
