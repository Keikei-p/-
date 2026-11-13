#!/usr/bin/env node
/**
 * READ-ONLY preflight: no Firebase SDK, no credential access, no network,
 * no data writes and no deployment. The static inventory is NOT a release
 * approval, and never relaxes the historic manual release workflows.
 */
import {existsSync,readFileSync,readdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {inspectProductionCutover} from "../../scripts/nico-production-cutover-preflight.mjs";

const OWNERS=Object.freeze(["listHubPartnerCounts","correctHubPartnerCounts"]);
const LEGACY=Object.freeze(["getPartnerWorkspace","managePartnerWorkspace",
 "acceptPartnerWorkspaceInvite","submitPartnerWorkspaceCounts"]);
const PROD="sales-management-cc116";
const repoRoot=resolve(fileURLToPath(new URL("../../",import.meta.url)));
const file=(root,p)=>readFileSync(join(root,p),"utf8");
const fail=(code)=>{throw Error("OWNER_CORRECTION_INVENTORY_"+code)};
const cleanFile=(name)=>/^[A-Za-z0-9_.-]+$/.test(name);
export function exportedNames(source){
 if(typeof source!=="string")fail("SOURCE");
 const found=[...source.matchAll(/\bexports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g)]
  .map(m=>m[1]);
 if(new Set(found).size!==found.length)fail("DUPLICATE_EXPORT_IN_FILE");
 return found;
}
export function inspectOwnerCorrectionRelease(root=repoRoot){
 if(typeof root!=="string"||!root)fail("ROOT");
 const violations=[];
 const configs=readdirSync(root).filter(x=>cleanFile(x)&&/^firebase(?:\..+)?\.json$/.test(x)).sort();
 const scopes=new Map();
 for(const configFile of configs){
  let parsed;
  try{parsed=JSON.parse(file(root,configFile))}catch{fail("INVALID_CONFIG_"+configFile)}
  const entries=Array.isArray(parsed.functions)?parsed.functions:parsed.functions?[parsed.functions]:[];
  for(const entry of entries){
   if(!entry||typeof entry.source!=="string"||
      !/^[A-Za-z0-9_-]+$/.test(entry.source))fail("UNTRUSTED_FUNCTION_SOURCE");
   const codebase=entry.codebase??"default";
   if(typeof codebase!=="string"||!/^[A-Za-z0-9_-]+$/.test(codebase))
    fail("UNTRUSTED_CODEBASE");
   const indexPath=join(entry.source,"index.js");
   if(!existsSync(join(root,indexPath)))fail("MISSING_ENTRY_"+entry.source);
   const key=codebase+"|"+entry.source,source=file(root,indexPath);
   const found=exportedNames(source);
   if(!found.length)fail("NO_EXPORTS_"+entry.source);
   const existing=scopes.get(key);
   if(!existing)scopes.set(key,{codebase,source:entry.source,configs:[configFile],exports:found});
   else existing.configs.push(configFile);
  }
 }
 const workspace=[...scopes.values()].filter(x=>
  x.codebase==="partner-workspace"&&x.source==="functions-partner-workspace");
 if(workspace.length!==1)violations.push("MISSING_PARTNER_WORKSPACE_CODEBASE");
 const scoped=workspace[0]?.exports||[];
 for(const name of [...LEGACY,...OWNERS]){
  if(!scoped.includes(name))violations.push("WORKSPACE_EXPORT_MISSING_"+name);
 }
 const seen=new Map();
 for(const row of scopes.values()){
  for(const id of row.exports){
   const other=seen.get(id);
   if(other&&other!==row.source)
    violations.push("DUPLICATE_FUNCTION_NAME_"+id);
   seen.set(id,row.source);
  }
 }
 for(const name of OWNERS){
  const sources=[...scopes.values()].filter(x=>x.exports.includes(name));
  if(sources.length!==1||sources[0].source!=="functions-partner-workspace")
   violations.push("OWNER_ENDPOINT_COLLISION_"+name);
 }
 const api=file(root,"functions-partner-workspace/index.js");
 const service=file(root,"functions-partner-workspace/service.cjs");
 const ownerPage=file(root,"index.html");
 if(!api.includes('NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED==="enabled"')||
    !api.includes('NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED==="enabled"')||
    !service.includes('ownerCorrectionReadEnabled=()=>false')||
    !service.includes('ownerCorrectionWriteEnabled=()=>false')||
    !ownerPage.includes('NICO_SAME_APP_OWNER_CORRECTION_V3_RELEASED=false'))
  violations.push("OWNER_DEFAULT_OFF_GUARDS_MISSING");
 const manual=file(root,".github/workflows/nico-partner-private-coordinated-release.yml");
 if(!manual.includes("workflow_dispatch:")||
    !manual.includes("FIRESTORE_BACKUP_RESTORE_VERIFIED")||
    !manual.includes("OWNER_REVENUE_PRICES_LOGIN_VERIFIED")||
    !manual.includes("EXISTING_FUNCTIONS_COST_APPROVED")||
    !manual.includes("scripts/check-finance-read-boundary-before-deploy.mjs")||
    !manual.includes("scripts/nico-production-cutover-preflight.mjs")||
    !manual.includes("--config firebase.partner-workspace.json"))
  violations.push("EXISTING_MANUAL_RELEASE_SAFETY_CHANGED");
 // This historical workflow can replace ONLY the existing four callables.
 // It must NOT gain an unreviewed new endpoint or a broad functions deploy.
 const line=manual.split("\n").find(x=>x.includes("--only functions:partner-workspace:"));
 if(!line||!line.includes("getPartnerWorkspace")||
    !line.includes("managePartnerWorkspace")||
    !line.includes("acceptPartnerWorkspaceInvite")||
    !line.includes("submitPartnerWorkspaceCounts")||
    OWNERS.some(name=>manual.includes("functions:partner-workspace:"+name)))
  violations.push("FROZEN_RELEASE_SCOPE_CHANGED");
 let finance;
 try{finance=inspectProductionCutover({
  rules:file(root,"firestore.rules"),index:ownerPage
 })}catch{finance={sourceCheckPassed:false,blocked:["STATIC_CUTOVER_UNVERIFIED"]}}
 const status={
  kind:"offline-no-deploy-static-inventory-v1",
  firebaseProject:PROD,
  configCount:configs.length,
  functionsCodebases:[...scopes.values()].map(x=>({
   codebase:x.codebase,source:x.source,
   exports:x.exports.slice().sort(),configs:x.configs.slice().sort()
  })).sort((a,b)=>a.codebase.localeCompare(b.codebase)),
  ownerEndpoints:{codebase:"partner-workspace",names:[...OWNERS],
   defaultEnabled:false},
  historicManualRelease:{scope:"four-legacy-only",modified:false,
   ownerEndpointsCovered:false},
  staticFinanceCutover:{passed:finance.sourceCheckPassed===true,
   blockers:finance.blocked||[]},
  sourceInventoryPassed:violations.length===0,
  violations:Object.freeze(violations),
  requiredBeforeProduction:Object.freeze([
   "Independent owner-signed protected source review",
   "Verified existing-live Firebase Functions names, region and codebase; no overwrite",
   "Actual partner UID money GET/LIST deny and hub Owner finance regression",
   "Complete verified backup and restored isolated copy",
   "Read-only count reconciliation and customer/partner live E2E",
   "Separate reviewed least-scope release path plus post-release check"
  ]),
  productionReleaseApproved:false
 };
 return Object.freeze(status);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const summary=inspectOwnerCorrectionRelease();
  for(const x of summary.functionsCodebases)
   console.log("FUNCTION_CODEBASE "+x.codebase+" "+x.source+" "+x.exports.join(","));
  for(const x of summary.violations)console.log("SOURCE_BLOCK "+x);
  for(const x of summary.staticFinanceCutover.blockers)
   console.log("FINANCE_CUTOVER_BLOCK "+x);
  console.log("OWNER_CORRECTION_SOURCE_INVENTORY="+
   (summary.sourceInventoryPassed?"PASS":"FAIL"));
  console.log("PRODUCTION_RELEASE_APPROVED=NO");
  if(!summary.sourceInventoryPassed)process.exitCode=2;
 }catch{
  console.error("OWNER_CORRECTION_SOURCE_INVENTORY=UNVERIFIED; NO_DEPLOY");
  process.exitCode=2;
 }
}
