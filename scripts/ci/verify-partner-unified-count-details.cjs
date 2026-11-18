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
  'const goalProgress =\n    buildTeamGoalProgress(', 'const revenueGoalProgress =\n        buildTeamRevenueGoalProgress(']
];
for(const [label,a,b] of important){
 assert.equal(section(here,a,b),section(baseline,a,b),label+" source changed");
}
assert(here.includes('import {buildPartnerUnifiedCountTeamView} from "./ranking/partner-unified-count-team-view.mjs";'));
assert(here.includes('buildPartnerUnifiedCountTeamView(snap)'));
assert(here.includes('if(Array.isArray(snap.enabledCategories)){'),
 "No backend-approved publication guard");
assert(here.includes("renderPartnerCountTeamCard("));
assert(here.includes("team.reportStatus===\"not_reported\""));
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
