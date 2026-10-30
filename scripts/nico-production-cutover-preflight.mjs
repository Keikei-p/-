#!/usr/bin/env node
/**
 * PRE-DEPLOY STOP GATE for the official NICO Firebase Hosting workflow.
 *
 * Source-only: no production Firebase credentials, Firestore reads, writes,
 * deletes, API calls or external network requests. A PASS is NECESSARY but
 * not SUFFICIENT for production: independent restoration, device/role and
 * live gateway checks remain operator release responsibilities.
 *
 * Prevents two dangerous half-cutovers:
 *   - deploying a frontend while Firestore still grants raw money reads to
 *     partner/company members
 *   - closing financial Rules while the app still reads/writes raw collections
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {checkFinanceRulesBeforeDeploy} from "./check-finance-read-boundary-before-deploy.mjs";

const repoFile=(relative)=>readFileSync(new URL("../"+relative,import.meta.url),"utf8");
const forbiddenBrowserCollections=[
 "records","products","recordCorrections","revenueGoals"
];
export function inspectProductionCutover({rules,index}={}){
 const blocked=[];
 if(typeof rules!=="string"||!rules.trim())blocked.push("MISSING_RULES");
 else {
  try{checkFinanceRulesBeforeDeploy(rules);}
  catch{blocked.push("FINANCE_RAW_RULES_ALLOW_PARTNER_OR_UNVERIFIED");}
 }
 if(typeof index!=="string"||!index.includes('projectId: "sales-management-cc116"')||
    !index.includes("signInWithEmailAndPassword")||
    !index.includes("service-worker.js"))
  blocked.push("CANONICAL_APP_NOT_VERIFIED");
 if(typeof index==="string"){
  // Direct Firestore SDK collection reads/writes must be migrated to an
  // authenticated, server-enforced count/finance gateway. Regex tests are
  // a supplementary tripwire, NOT proof of authorization by themselves.
  for(const collection of forbiddenBrowserCollections){
   const escaped=collection.replace(/[.*+?^\u0024{}()|[\]\\]/g,"\\$&");
   const sdk=new RegExp("collection\\s*\\(\\s*db\\s*,\\s*['\"]"+escaped+"['\"]");
   const scoped=new RegExp("companyCollectionQuery\\s*\\(\\s*['\"]"+escaped+"['\"]");
   if(sdk.test(index)||scoped.test(index))
    blocked.push("DIRECT_BROWSER_FINANCE_COLLECTION_"+collection);
  }
  // Old helper resolves recordsCollectionQuery() to the raw records path.
  if(/function\s+recordsCollectionQuery\s*\(/.test(index))
   blocked.push("LEGACY_RECORDS_DIRECT_QUERY");
  if(/function\s+persistDailyRecord\s*\(/.test(index))
   blocked.push("LEGACY_RECORDS_DIRECT_WRITE");
 }
 return Object.freeze({
  sourceCheckPassed:blocked.length===0,
  productionApprovalGranted:false,
  runtimeEvidenceRequired:true,
  blocked:Object.freeze([...new Set(blocked)])
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const status=inspectProductionCutover({
  rules:repoFile("firestore.rules"),
  index:repoFile("index.html")
 });
 if(process.argv.includes("--json")){
  console.log(JSON.stringify(status,null,2));
 }else{
  console.log("NICO pre-deploy source audit (READ ONLY)");
  for(const code of status.blocked)console.log("[BLOCK] "+code);
  if(status.sourceCheckPassed)console.log("[PASS] Static finance cutover compatibility");
  console.log("Live owner/partner role tests and verified backup restore remain separate.");
 }
 if(!status.sourceCheckPassed)process.exitCode=2;
}