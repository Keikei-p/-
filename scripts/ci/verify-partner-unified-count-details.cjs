"use strict";
/**
 * PR ONLY / NO DEPLOY: assert index.html touches ONLY read-only presentation,
 * and the original authenticated count save/finance boundary is unchanged.
 * Parent main is fetched by CI (the script itself has NO network calls).
 */
const fs=require("node:fs");
const cp=require("node:child_process");
const assert=require("node:assert/strict");
const here=fs.readFileSync("index.html","utf8");
const baseline=cp.execFileSync("git",["show","FETCH_HEAD:index.html"],{
 encoding:"utf8",maxBuffer:8*1024*1024
});
const start='pInline("pInlineSave").onclick=()=>partnerInlineRun(async()=>{';
const end='// Hub Owner-only partner count correction.';
const section=(text,a,b)=>{
 const from=text.indexOf(a),to=text.indexOf(b,from);
 assert(from>=0&&to>from,"source anchor changed: "+a);
 return text.slice(from,to);
};
const important=[
 ["partner submission and verified GET readback",start,end],
 ["source count keys and team day classification",
  'const PARTNER_NURO_CB_TIERS=', 'function partnerInlineSelectedCb()'],
 ["self financial member details untouched",
  'const goalProgress =\n    buildTeamGoalProgress(', 'const revenueGoalProgress =\n        buildTeamRevenueGoalProgress('],
 ["original self product catalog query unchanged",
  'async function loadProducts(', 'function clearProductLongPress()']
];
for(const [label,a,b] of important){
 assert.equal(section(here,a,b),section(baseline,a,b),label+" source changed");
}
assert(here.includes('import {buildPartnerUnifiedCountTeamView} from "./ranking/partner-unified-count-team-view.mjs";'));
assert(here.includes('buildPartnerUnifiedCountTeamView(snap)'));
assert(here.includes('if(Array.isArray(snap.categories)){'),
 "Verified server count categories required for shared team view");
assert(here.includes('const enabledKeys=snap.enabledCategories??snap.categories;'),
 "Existing backend allowlist must remain effective when supplied");
assert(here.includes("renderPartnerCountTeamCard("));
assert(here.includes("team.reportStatus===\"not_reported\""));
assert(here.includes('id="pInlineAddPrivateProduct" class="team-action-button" type="button"'),
 "Existing private SKU input must remain until the shared server catalog is ready");
assert(here.includes('partnerUsesVerifiedOwnerCatalog(snap)'),
 "No legacy product edit removal without verified server replacement");
assert(here.includes('const unifiedProductList=partnerUsesVerifiedOwnerCatalog(snap);'),
 "Existing private SKU entry must remain until shared catalog is verified");
assert(here.includes('snap?.sharedCatalogMode==="owner-products-count-only-v1"&&'),
 "Never infer catalogue cutover from browser publication toggles");
assert(here.includes('snap?.sharedCatalogVerified===true;'),
 "Only a verified server reply may switch off legacy editing");
assert(here.includes('const editable=["owner","leader"].includes(snap.role)&&!sharedMode;'),
 "Original partner catalog must remain editable on legacy backend");
assert(here.includes('const enabledKeys=snap.enabledCategories??snap.categories;'),
 "Never override a deployed backend publication restriction");

const script=here.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(script?.[1],"main script not found");
const syntax=cp.spawnSync(process.execPath,["--input-type=module","--check"],{
 input:script[1],encoding:"utf8",maxBuffer:2*1024*1024
});
assert.equal(syntax.status,0,syntax.stderr||syntax.error?.message||"invalid html module");
const changed=cp.execFileSync("git",["diff","--name-only","FETCH_HEAD","--"],{
 encoding:"utf8"
}).trim().split("\n").filter(Boolean);
assert(changed.length<=20,"unexpected scope of feature change: "+changed.join(","));
assert(changed.every(file=>[
 "index.html","ranking/partner-unified-count-team-view.mjs",
 "tests/partner-unified-count-team-view.test.mjs",
 "scripts/ci/verify-partner-unified-count-details.cjs",
 ".github/workflows/nico-partner-unified-count-details-no-deploy.yml",
 "ranking/same-app-joint-count-projection.mjs",
 "ranking/same-app-joint-count-panel.mjs",
 "tests/same-app-joint-count-wire.test.mjs",
 "functions-ranking-approvals/index.js",
 "functions-ranking-approvals/joint-count-http-adapter.cjs",
 "tests/joint-count-http-adapter.test.cjs",
 "ranking/partner-tab-visibility-policy.mjs",
 "ranking/partner-tab-navigation-gate.mjs",
 "tests/partner-eight-tab-navigation-bridge.test.mjs",
 "functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs",
 "functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs",
 "functions-ranking-approvals/ranking/partner-month-readonly-loader.mjs",
 "functions-ranking-approvals/ranking/partner-workspace-count-source.mjs",
 "functions-ranking-approvals/ranking/zero-setup-count-linker.mjs",
 ".github/workflows/nico-same-app-joint-count-wire-no-deploy.yml"
].includes(file)),"unexpected changed source: "+changed.join(","));
// Only the listed trusted count-only readers may change; partner saves,
 // Firebase Rules, finance Functions and source records remain immutable.
for(const path of [
 "functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs",
 "functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs",
 "functions-ranking-approvals/ranking/partner-month-readonly-loader.mjs",
 "functions-ranking-approvals/ranking/partner-workspace-count-source.mjs",
 "functions-ranking-approvals/ranking/zero-setup-count-linker.mjs"
]){
 const src=fs.readFileSync(path,"utf8");
 assert(!/\b(?:tx|db)\.(?:set|create|update|delete|add)\s*\(/.test(src),
  "Readonly source must never write to Firestore: "+path);
 assert(!/\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch)\s*\(/.test(src),
  "No client datastore writes: "+path);
}
// Permit only the explicitly reviewed read-only HTTP adapter update, without
// relaxing the original count-save or finance source protections above.
const http=fs.readFileSync(
 "functions-ranking-approvals/joint-count-http-adapter.cjs","utf8");
assert(http.includes('const PARTNER_OWN_FIELDS=new Set([') &&
       http.includes('function safeOwnDetails(ownData)') &&
       http.includes('function partnerTeamRankingSafe(ownData,rows)') &&
       http.includes('const PARTNER_ENVELOPE=['),
 "Partner own-team fields need an independently guarded HTTP envelope");
assert(!/\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(http),
 "HTTP adapter must never write to Firestore");
assert(!/\b(?:firebase-admin|finance|revenue|cashback)\s*\(.*\)/.test(http),
 "HTTP adapter must not initialize financial data reads");
const tabGate=fs.readFileSync("ranking/partner-tab-navigation-gate.mjs","utf8");
assert(tabGate.includes('readVerifiedPartnerTabPolicy(policy)') &&
       tabGate.includes('const allowed=new Set(approved.tabs)') &&
       tabGate.includes('if(!active)details.hidden=true'),
 "Owner's server-issued selection must guard optional visible tabs");
assert(!/\b(?:firebase|Firestore|httpsCallable|fetch|setDoc|addDoc|updateDoc|deleteDoc)\s*\(/.test(tabGate),
 "Pure tab renderer must not query or mutate data stores");
assert(here.includes("const NICO_PARTNER_TAB_UI_ENABLED = false;") &&
       here.includes("const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;"),
 "Both independent publication rollout switches must default OFF");
const privateReader=fs.readFileSync(
 "functions-ranking-approvals/ranking/partner-month-readonly-loader.mjs","utf8");
assert(privateReader.includes('partner.collection("partnerPrivateProducts").limit(MAX_PRIVATE+1)'),
 "Private product catalogue must be bounded");
assert(privateReader.includes('...(includePrivateCounts?[tx.get(privateQuery)]:[])'),
 "Private catalogue must be read in the existing verified transaction");
assert(privateReader.includes('readOnly:true'),
 "Standalone private history reader can only run a read-only transaction");
const joint=fs.readFileSync("functions-ranking-approvals/index.js","utf8");
assert(joint.includes('enabled:()=>process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"&&\n  process.env.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled"'),
 "Both flags are required to enable the direct joint HTTP route");
assert(joint.includes('enabled:()=>process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"'),
 "Outer production GET gate must remain OFF by default");
assert(joint.includes('zeroSetupLink:process.env.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled"'),
 "Unreviewed published counts must remain OFF by default");
assert(here.includes('tryLoadVerifiedSameAppJointCount({'),
 "Both company views must actually use the canonical count GET");
assert(here.includes('const NICO_SAME_APP_JOINT_HTTP_ENABLED = false;'),
 "The new HTTP route must be explicitly OFF in this unreviewed UI");
assert(here.includes('if(NICO_SAME_APP_JOINT_HTTP_ENABLED!==true)'),
 "The client must refuse a disabled cross-origin endpoint before fetch");
assert(here.includes('throw Error("SAME_APP_JOINT_AUTH_OR_DATA_UNVERIFIED");'),
 "Any error once enabled must refuse bad data, not show stale counts");
assert(!here.includes("httpStatus===503?"),
 "403/503 and malformed backend responses must not trigger a stale fallback");
assert(here.includes('getWorkspaceCompanyId:()=>partner?partnerInlineWorkspaceCompany:""'),
 "Partner-secondary company context must stay server verified");
assert(here.includes('if(await tryLoadVerifiedSameAppJointCount({'),
 "Preserve the existing count-only fallback while GET is OFF");
console.log("VERIFIED_JOINT_COUNT_HTTP_GATED_AND_LEGACY_FALLBACK");
console.log("VERIFIED_SAME_INDEX_COUNT_FORM_UNMODIFIED");
console.log("VERIFIED_FINANCE_ORIGINAL_UNMODIFIED");
console.log("VERIFIED_TEAM_DETAIL_READ_ONLY_AND_NO_DEPLOY");
