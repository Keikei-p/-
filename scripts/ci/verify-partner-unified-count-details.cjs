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
assert(changed.length<=12,"unexpected scope of feature change: "+changed.join(","));
assert(changed.every(file=>[
 "index.html","ranking/partner-unified-count-team-view.mjs",
 "tests/partner-unified-count-team-view.test.mjs",
 "scripts/ci/verify-partner-unified-count-details.cjs",
 ".github/workflows/nico-partner-unified-count-details-no-deploy.yml",
 "ranking/same-app-joint-count-projection.mjs",
 "ranking/same-app-joint-count-panel.mjs",
 "tests/same-app-joint-count-wire.test.mjs",
 "functions-ranking-approvals/index.js",
 ".github/workflows/nico-same-app-joint-count-wire-no-deploy.yml"
].includes(file)),"unexpected changed source: "+changed.join(","));
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
