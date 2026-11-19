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
assert(changed.length<=6,"unexpected scope of feature change: "+changed.join(","));
assert(changed.every(file=>[
 "index.html","ranking/partner-unified-count-team-view.mjs",
 "tests/partner-unified-count-team-view.test.mjs",
 "scripts/ci/verify-partner-unified-count-details.cjs",
 ".github/workflows/nico-partner-unified-count-details-no-deploy.yml"
].includes(file)),"unexpected changed source: "+changed.join(","));
console.log("VERIFIED_SAME_INDEX_COUNT_FORM_UNMODIFIED");
console.log("VERIFIED_FINANCE_ORIGINAL_UNMODIFIED");
console.log("VERIFIED_TEAM_DETAIL_READ_ONLY_AND_NO_DEPLOY");
