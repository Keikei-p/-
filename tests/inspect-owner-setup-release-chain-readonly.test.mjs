import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {NEW,EXPECTED_FLAGS} from "../tools/production/owner-setup-six-release-scope.mjs";
import {SOURCES,uploadSha} from "../tools/hosting/owner-setup-additive-guard.mjs";
import {classifyFunctions,classifyHosting,readinessBoard}
 from "../tools/production/inspect-owner-setup-release-chain-readonly.mjs";

const root="projects/sales-management-cc116/locations/asia-northeast1/functions/";
const functionMeta=(name)=>({
 name:root+name,state:"ACTIVE",
 buildConfig:{runtime:"nodejs22",entryPoint:name},
 serviceConfig:{uri:"https://private.a.run.app",environmentVariables:{...EXPECTED_FLAGS}}
});
const funcs=()=>NEW.map(functionMeta);
const sourced=()=>Object.fromEntries(Object.keys(SOURCES).map(name=>[
 name,readFileSync(new URL("../"+name,import.meta.url),"utf8")
]));
const existing=()=>["/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/owner-partner-admin.html"].map((path,i)=>({
 path,hash:String(i+1).repeat(64)
}));
const version="sites/nico-factory/versions/SAFE123";
const release={releases:[{version:{name:version}}]};
const hosted=()=>[
 ...existing(),
 ...Object.keys(SOURCES).map(file=>({path:"/"+file,hash:uploadSha(sourced()[file])}))
];
const pub=(changes={})=>({
 project:"sales-management-cc116",mode:"LIVE_READ_ONLY_NO_DEPLOY",
 activeApprovedPartnerCount:3,mappedPartnerCount:0,
 ownerPublicationCatalogReady:false,allEnabledPartnerSkuMapped:false,
 reciprocalOwnerRankConsentReady:false,
 blockingReasons:["OWNER_PUBLIC_CATALOG_MISSING",
  "PARTNER_SKU_MAPPING_INCOMPLETE","RECIPROCAL_RANK_CONSENT_INCOMPLETE"],
 productionDocumentWrites:0,safeToEnableNewRanking:false,...changes
});
test("missing six Owner Functions: safe read-only board recommends exactly first deployment",()=>{
 const f=classifyFunctions([functionMeta("getPartnerWorkspace")]);
 assert.equal(f.sixOwnerFunctionsDeployed,0);
 assert.equal(f.sixOwnerFunctionsReady,false);
 const h=classifyHosting(release,{name:version,status:"FINALIZED",fileCount:5,
  config:{}},existing(),sourced());
 const b=readinessBoard({functions:f,hosting:h,publication:pub()});
 assert.equal(b.nextStep,"DISPATCH_OWNER_SIX_MANUAL");
 assert.equal(b.partnerCompaniesApprovedForCountSharing,3);
 assert.equal(b.partnerCompaniesWithMappedRankCategories,0);
 assert.equal(b.safeToEnableJointRanking,false);
 assert.equal(b.productionDocumentWrites,0);
 assert(b.blockingReasons.includes("DEPLOY_SIX_OWNER_SETTINGS"));
 assert(b.blockingReasons.includes("PUBLISH_OWNER_SETUP_ELEVEN"));
});
test("Owner Functions must all be present, active, Tokyo, flags ready; joint rank always OFF",()=>{
 const x=classifyFunctions(funcs());
 assert.equal(x.sixOwnerFunctionsDeployed,6);
 assert.equal(x.sixOwnerFunctionsActiveWithReviewedFlags,6);
 assert.equal(x.sixOwnerFunctionsReady,true);
 const wrong=funcs().map((x,i)=>i===0?{
  ...x,serviceConfig:{...x.serviceConfig,environmentVariables:{
   ...EXPECTED_FLAGS,NICO_OWNER_SKU_MAPPING_ENABLED:"disabled"
  }}
 }:x);
 const r=classifyFunctions(wrong);
 assert.equal(r.sixOwnerFunctionsDeployed,6);
 assert.equal(r.sixOwnerFunctionsReady,false);
 assert.throws(()=>classifyFunctions([...funcs(),{
  ...functionMeta("getVerifiedJointCountRanking"),
  serviceConfig:{uri:"https://private.a.run.app",
   environmentVariables:{NICO_JOINT_COUNT_RANKING_ENABLED:"enabled"}}
 }]),/STOP_OWNER_SETUP_CHAIN_JOINT_RANKING_UNEXPECTEDLY_ENABLED/);
 assert.throws(()=>classifyFunctions([...funcs(),funcs()[0]]),
  /STOP_OWNER_SETUP_CHAIN_FUNCTION_METADATA_UNTRUSTED/);
});
test("when six functions are live, next step is publish 11 additional pages",()=>{
 const f=classifyFunctions(funcs());
 const h=classifyHosting(release,{name:version,status:"FINALIZED",fileCount:5,
  config:{}},existing(),sourced());
 assert.equal(readinessBoard({functions:f,hosting:h,publication:pub()}).nextStep,
  "DISPATCH_OWNER_ELEVEN_MANUAL");
});
test("published Hosting must exactly match all 11 reviewed SHA256 gzipped files",()=>{
 const h=classifyHosting(release,{
  name:version,status:"FINALIZED",fileCount:hosted().length,config:{headers:[]}
 },hosted(),sourced());
 assert.equal(h.ownerSetupPageReady,true);
 assert.equal(h.ownerSetupHostingAssetsExactMatch,11);
 const partial=hosted().slice(0,-1);
 const r=classifyHosting(release,{
  name:version,status:"FINALIZED",fileCount:partial.length,config:{headers:[]}
 },partial,sourced());
 assert.equal(r.ownerSetupPageReady,false);
 assert.equal(r.ownerSetupHostingAssetsPresent,10);
 assert.equal(r.ownerSetupHostingAssetsExactMatch,10);
 const compromised=hosted().map((x,i)=>i===5?{...x,hash:"f".repeat(64)}:x);
 assert.equal(classifyHosting(release,{
  name:version,status:"FINALIZED",fileCount:compromised.length,config:{}
 },compromised,sourced()).ownerSetupPageReady,false);
 assert.throws(()=>classifyHosting(release,{
  name:version,status:"FINALIZED",fileCount:hosted().length,config:{}
 },hosted(),{...sourced(),["ranking/owner-ranking-consent-panel.mjs"]:"tampered"}),
 /STOP_OWNER_SETUP_CHAIN_HOSTING_REVIEWED_SOURCE_CHANGED/);
});
test("account finance proof remains explicitly blocked even when all config setup is ready",()=>{
 const f=classifyFunctions(funcs());
 const h=classifyHosting(release,{name:version,status:"FINALIZED",
  fileCount:hosted().length,config:{}},hosted(),sourced());
 let b=readinessBoard({functions:f,hosting:h,publication:pub()});
 assert.equal(b.nextStep,"OWNER_AND_PARTNER_CONFIGURE_EXPLICIT_CONSENT");
 b=readinessBoard({functions:f,hosting:h,publication:pub({
  ownerPublicationCatalogReady:true,allEnabledPartnerSkuMapped:true,
  reciprocalOwnerRankConsentReady:true,blockingReasons:[],mappedPartnerCount:3
 })});
 assert.equal(b.nextStep,"REAL_ACCOUNT_FINANCE_DENY_AND_COUNT_SAVE_TEST");
 assert.equal(b.realPartnerFinanceGetListDeniedVerified,false);
 assert.equal(b.realPartnerCountSaveVerified,false);
 assert.equal(b.safeToEnableJointRanking,false);
});
test("untrusted status, finance or write claims cannot be promoted to readiness",()=>{
 const f=classifyFunctions(funcs());
 const h=classifyHosting(release,{name:version,status:"FINALIZED",
  fileCount:hosted().length,config:{}},hosted(),sourced());
 assert.throws(()=>readinessBoard({functions:f,hosting:h,publication:pub({
  productionDocumentWrites:1
 })}),/STOP_OWNER_SETUP_CHAIN_INPUT_NOT_AUDITED/);
 assert.throws(()=>readinessBoard({functions:f,hosting:h,publication:pub({
  safeToEnableNewRanking:true
 })}),/STOP_OWNER_SETUP_CHAIN_INPUT_NOT_AUDITED/);
 const s=readFileSync(new URL("../tools/production/inspect-owner-setup-release-chain-readonly.mjs",import.meta.url),"utf8");
 assert.match(s,/method:"GET"/);
 assert(!/method:"(?:POST|PUT|PATCH|DELETE)"/.test(s));
 assert(!/firebase deploy|setDoc\(|updateDoc\(|\.delete\(/.test(s));
 assert.match(s,/safeToEnableJointRanking:false/);
});


test("live Hosting finance diagnostic status is HASH-verified but never equated to real account proof",()=>{
 const src=readFileSync(new URL("../finance-boundary-check.html",import.meta.url),"utf8");
 const baseline=hosted();
 const withFinance=[...baseline,{path:"/finance-boundary-check.html",hash:uploadSha(src)}];
 const clean=classifyHosting(release,{name:version,status:"FINALIZED",
   fileCount:withFinance.length,config:{}},withFinance,sourced(),src);
 assert.equal(clean.financeBoundaryDiagnosticInspected,true);
 assert.equal(clean.financeBoundaryDiagnosticPresent,true);
 assert.equal(clean.financeBoundaryDiagnosticExactMatch,true);
 assert.equal(clean.ownerSetupPageReady,true);
 const absent=classifyHosting(release,{name:version,status:"FINALIZED",
   fileCount:baseline.length,config:{}},baseline,sourced(),src);
 assert.equal(absent.financeBoundaryDiagnosticPresent,false);
 assert.equal(absent.financeBoundaryDiagnosticExactMatch,false);
 const changed=classifyHosting(release,{name:version,status:"FINALIZED",
   fileCount:withFinance.length,config:{}},
   withFinance.map(x=>x.path==="/finance-boundary-check.html"?
    {...x,hash:"f".repeat(64)}:x),sourced(),src);
 assert.equal(changed.financeBoundaryDiagnosticPresent,true);
 assert.equal(changed.financeBoundaryDiagnosticExactMatch,false);
 assert.throws(()=>classifyHosting(release,{name:version,status:"FINALIZED",
  fileCount:withFinance.length,config:{}},withFinance,sourced(),"secret"),
  /STOP_OWNER_SETUP_CHAIN_FINANCE_DIAGNOSTIC_SOURCE_INVALID/);
 const board=readinessBoard({functions:classifyFunctions(funcs()),hosting:clean,
  publication:pub()});
 assert.equal(board.financeBoundaryDiagnosticExactMatch,true);
 assert.equal(board.realPartnerFinanceGetListDeniedVerified,false);
 assert.equal(board.safeToEnableJointRanking,false);
});
