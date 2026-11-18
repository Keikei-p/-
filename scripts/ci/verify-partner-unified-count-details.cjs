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
assert(changed.length<=51,"unexpected scope of feature change: "+changed.join(","));
assert(changed.every(file=>[
 "index.html","ranking/partner-unified-count-team-view.mjs",
 "tests/partner-unified-count-team-view.test.mjs",
 "tests/verified-dual-count-dashboards.test.mjs",
 "scripts/ci/verify-partner-unified-count-details.cjs",
 ".github/workflows/nico-partner-unified-count-details-no-deploy.yml",
 "ranking/verified-dual-count-dashboards.mjs",
 "ranking/same-app-joint-count-projection.mjs",
 "ranking/same-app-joint-count-panel.mjs",
 "tests/same-app-joint-count-wire.test.mjs",
 "functions-ranking-approvals/index.js",
 "functions-ranking-approvals/joint-count-http-adapter.cjs",
 "tests/joint-count-http-adapter.test.cjs",
 "ranking/partner-tab-visibility-policy.mjs",
 "ranking/partner-tab-navigation-gate.mjs",
 "tests/partner-eight-tab-navigation-bridge.test.mjs",
 "functions-partner-tabs/controller.cjs",
 "functions-partner-tabs/index.js",
 "functions-partner-tabs/package.json",
 "functions-partner-tabs/partner-tab-publication-store.mjs",
 "functions-partner-tabs/trusted-token-reader.mjs",
 "tests/partner-tab-publication-callables.test.mjs",
 "tests/partner-tab-publication-firestore.test.mjs",
 "tests/partner-tab-publication-token.test.mjs",
 "tests/partner-tab-visibility-policy.test.mjs",
 "ranking/owner-partner-tab-settings-panel.mjs",
 "tests/owner-partner-eight-tab-settings-panel.test.mjs",
 "ranking/published-partner-tab-server.mjs",
 "ranking/published-partner-tab-client.mjs",
 "ranking/published-partner-optional-client.mjs",
 "tests/partner-optional-client.test.mjs",
 "tests/partner-optional-four-tab-read.test.mjs",
 "firebase.partner-tabs.json",
 "tests/nico-eight-tab-release-preflight.test.mjs",
 "functions-partner-tabs/partner-optional-tab-reader.mjs",
 "tests/published-partner-tab-client.test.mjs",
 "functions-ranking-approvals/ranking/published-partner-tab-server.mjs",
 "ranking/owner-visible-count-atomic-loader.mjs",
 "functions-ranking-approvals/ranking/owner-visible-count-atomic-loader.mjs",
 "ranking/canonical-owner-count-server-factory.mjs",
 "functions-ranking-approvals/ranking/canonical-owner-count-server-factory.mjs",
 "ranking/owner-visible-count-server-handler.mjs",
 "functions-ranking-approvals/ranking/owner-visible-count-server-handler.mjs",
 "tests/published-partner-tab-server.test.mjs",
 "tests/isolated-joint-count-function-package.test.mjs",
 "functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs",
 "functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs",
 "functions-ranking-approvals/ranking/partner-month-readonly-loader.mjs",
 "functions-ranking-approvals/ranking/partner-workspace-count-source.mjs",
 "functions-ranking-approvals/ranking/zero-setup-count-linker.mjs",
 ".github/workflows/nico-same-app-joint-count-wire-no-deploy.yml"
].includes(file)),"unexpected changed source: "+changed.join(","));
// The browser-side projection and the deployed Functions vendor must agree
// on team details and hidden other-company private product names.
assert.equal(
 fs.readFileSync("ranking/verified-dual-count-dashboards.mjs","utf8"),
 fs.readFileSync("functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs","utf8"),
 "Count-only viewer and server copies must remain byte-identical"
);
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
// Standalone #802 settings backend may write ONLY versioned shared policy and
// append-only audit, NEVER input counts, finance ledgers or client Firestore.
const tabStore=fs.readFileSync("functions-partner-tabs/partner-tab-publication-store.mjs","utf8");
assert(tabStore.includes('collection("partnerTabPublication").doc("shared")')&&
       tabStore.includes('collection("partnerTabPublicationAudits").doc()')&&
       tabStore.includes("before.version !== expectedRevision")&&
       tabStore.includes("verifiedHubOwner(tx,actor)"),
 "Owner config CAS, canonical company scope and append-only audit required");
assert(!/\b(?:sales|revenue|recordCorrections|partnerWorkEntries|partnerWorkCountDays)\s*\)/i.test(tabStore),
 "Owner tab store must not query original financial/count documents");
const tabServer=fs.readFileSync("functions-partner-tabs/index.js","utf8");
assert(tabServer.includes('process.env.NICO_PARTNER_TAB_PUBLICATION_ENABLED==="enabled"')&&
       tabServer.includes('process.env.NICO_PARTNER_OPTIONAL_TAB_DATA_VERIFIED==="enabled"')&&
       tabServer.includes("exports.getPartnerPublishedOptionalTab=onCall")&&
       tabServer.includes("exports.setOwnerPartnerTabPublication=onCall")&&
       tabServer.includes("exports.getPartnerPublishedTabs=onCall"),
 "Owner and partner callables require independent server OFF switch");
const ownerUI=fs.readFileSync("ranking/owner-partner-tab-settings-panel.mjs","utf8");
assert(ownerUI.includes("readVerifiedPartnerTabPolicy") &&
       ownerUI.includes("prepareOwnerTabPublication") &&
       !/\b(?:setDoc|updateDoc|deleteDoc|addDoc|runTransaction)\s*\(/.test(ownerUI),
 "Owner UI must use server-authenticated CAS callable, never direct datastore writes");
const codePrincipal=fs.readFileSync(
 "functions-partner-tabs/partner-tab-publication-store.mjs","utf8");
assert(codePrincipal.includes('col("partnerCodeCredentials").doc(partner)')&&
       codePrincipal.includes('credential.active!==true')&&
       codePrincipal.includes('credential.principalUid!==actor.uid'),
 "Code principal must recheck active credentials before partner data reads");
const optionalManifest=JSON.parse(fs.readFileSync(
 "firebase.partner-tabs.json","utf8"));
assert(optionalManifest.functions?.source==="functions-partner-tabs"&&
       optionalManifest.functions?.codebase==="partner-shared-tabs"&&
       !("functions" in JSON.parse(fs.readFileSync("firebase.json","utf8"))),
 "Optional functions must be separately deployable but not auto-deployed");
const optionalStore=fs.readFileSync(
 "functions-partner-tabs/partner-tab-publication-store.mjs","utf8");
assert(optionalStore.includes("async function readPublishedOptional(")&&
       optionalStore.includes("verifiedPartnerViewer(tx,actor,workspaceCompanyId,true)")&&
       optionalStore.includes("}, {readOnly:true}")===false&&
       optionalStore.includes("},{readOnly:true});"),
 "Optional reads require fresh scope+Owner policy within ONE read-only tx");
const optionalReader=fs.readFileSync(
 "functions-partner-tabs/partner-optional-tab-reader.mjs","utf8");
assert(optionalReader.includes('collection("partnerWorkEntries").where("date","==",date)')&&
       optionalReader.includes('collection("partnerWorkAudits")')&&
       !/\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|tx\.create|tx\.update|tx\.set|tx\.delete)\s*\(/.test(optionalReader),
 "Optional report/daily/history/goal data reader must not write originals");
const optionalClient=fs.readFileSync(
 "ranking/published-partner-optional-client.mjs","utf8");
assert(optionalClient.includes("createPartnerPublishedOptionalTabClient")&&
       optionalClient.includes("verifyPartnerOptionalTabData")&&
       !/\b(?:getDocs|setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(optionalClient),
 "Client must never read or write Firestore directly for optional data");
assert(here.includes('loadPartnerPublishedOptionalPanel(name)')&&
       here.includes('getPartnerPublishedOptionalTab')===false&&
       here.includes('partnerOptionalPublicationProtectionActive()'),
 "Optional tabs must use strictly verified data and leave original count input intact");
const publishedClient=fs.readFileSync(
 "ranking/published-partner-tab-client.mjs","utf8");
assert(publishedClient.includes('verifyPublishedPartnerCountResponse')&&
       publishedClient.includes('createPublishedPartnerCountBridge')&&
       publishedClient.includes('getWorkspaceCompanyId')&&
       publishedClient.includes('PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED'),
 "No unverified or mixed-tab browser rank projection");
assert(!/\b(?:getDocs|setDoc|addDoc|updateDoc|deleteDoc|runTransaction|localStorage|httpsCallable)\s*\(/.test(publishedClient),
 "Client tab bridge must never read Firestore or mutate originals");
assert(here.includes('import("./ranking/published-partner-tab-client.mjs")')&&
       here.includes('await bridge.load({tab,day:date})'),
 "The partner's shared dashboard must use published-only rank GET");
const serverTab=fs.readFileSync("ranking/published-partner-tab-server.mjs","utf8");
const vendorTab=fs.readFileSync(
 "functions-ranking-approvals/ranking/published-partner-tab-server.mjs","utf8");
assert.equal(serverTab,vendorTab,"Published tab server vendored source mismatch");
for(const path of [
 "ranking/published-partner-tab-server.mjs",
 "ranking/owner-visible-count-atomic-loader.mjs",
 "ranking/canonical-owner-count-server-factory.mjs",
 "ranking/owner-visible-count-server-handler.mjs",
 "functions-ranking-approvals/ranking/published-partner-tab-server.mjs",
 "functions-ranking-approvals/ranking/owner-visible-count-atomic-loader.mjs",
 "functions-ranking-approvals/ranking/canonical-owner-count-server-factory.mjs",
 "functions-ranking-approvals/ranking/owner-visible-count-server-handler.mjs"
]){
 const src=fs.readFileSync(path,"utf8");
 assert(!/\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|tx\.create|tx\.update|tx\.set|tx\.delete)\s*\(/.test(src),
  "Read-only count publication guard must never write originals: "+path);
}
assert(serverTab.includes('projectPublishedPartnerCountTab')&&
       serverTab.includes('createPartnerPublishedTabPolicyReader')&&
       serverTab.includes('PARTNER_PUBLISHED_TAB_ACCESS_DENIED'),
 "The read-only server fence must use authoritative Owner publication");
const privateReader=fs.readFileSync(
 "functions-ranking-approvals/ranking/partner-month-readonly-loader.mjs","utf8");
assert(privateReader.includes('partner.collection("partnerPrivateProducts").limit(MAX_PRIVATE+1)'),
 "Private product catalogue must be bounded");
assert(privateReader.includes('...(includePrivateCounts?[tx.get(privateQuery)]:[])'),
 "Private catalogue must be read in the existing verified transaction");
assert(privateReader.includes('readOnly:true'),
 "Standalone private history reader can only run a read-only transaction");
const joint=fs.readFileSync("functions-ranking-approvals/index.js","utf8");
assert(joint.includes('enabled:()=>process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"&&\n  process.env.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled"&&\n  process.env.NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED==="enabled"'),
 "All three flags are required to enable the direct joint HTTP route");
assert(joint.includes('enabled:()=>process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"'),
 "Outer production GET gate must remain OFF by default");
assert(joint.includes('publishedOnly:true')&&
       joint.includes('enforcePartnerTabPublication:true'),
 "Partner ranking must not return unrestricted combined HTTP data");
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
