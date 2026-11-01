#!/usr/bin/env node
/**
 * Read-only, additive-only production cutover gate for NICO's isolated
 * company-code partner workspace. This is NOT permission to deploy the
 * canonical 620KB internal sales client or the production Firestore Rules.
 *
 * The canonical-app cutover audit intentionally fails while that legacy app
 * still reads raw financial documents. Do not disable that existing audit.
 * This narrow gate applies ONLY when firebase deploy targets the separate
 * functions:partner-workspace codebase and its single partner HTML asset.
 */
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

export const EXISTING_CANONICAL_BLOB="ce4472702cfb58c0cf1d0fc06adb09ff00637dbb";
const present=(s,term)=>typeof s==="string"&&s.includes(term);
export function inspectScopedCompanyCodeRelease({
  canonicalBlob="",canonical="",partnerPage="",workspaceService="",
  codeAuth="",entry="",config=null
}={}){
 const blocked=[];
 if(canonicalBlob!==EXISTING_CANONICAL_BLOB||
   !present(canonical,'signInWithEmailAndPassword')||
   !present(canonical,'function recordsCollectionQuery')||
   !present(canonical,'function persistDailyRecord'))
   blocked.push("CANONICAL_EXISTING_SALES_APP_CHANGED_OR_UNVERIFIED");
 if(config?.functions?.source!=="functions-partner-workspace"||
    config?.functions?.codebase!=="partner-workspace"||
    Object.keys(config).some(k=>k!=="functions"))
   blocked.push("WORKSPACE_CODEBASE_NOT_ISOLATED");
 if(!present(partnerPage,'codeSessionToken')||
    !present(partnerPage,'issuePartnerCompanyCode')||
    !present(partnerPage,'activatePartnerCompanyCode')||
    !present(partnerPage,'loginPartnerCompanyCode')||
    !present(partnerPage,'submitPartnerWorkspaceCounts')||
    !present(partnerPage,'partner-workspace.html')||
    /(?:firebase-firestore\.js|\bgetFirestore\s*\(|\bcollection\s*\(\s*db\s*,)/.test(partnerPage))
   blocked.push("PARTNER_PAGE_BYPASSES_COUNT_ONLY_BACKEND");
 if(!present(entry,'./company-code-auth.cjs')||
   !present(entry,'PARTNER_COMPANY_CODE_AUTH_ENABLED')||
   !present(entry,'submitPartnerWorkspaceCounts')||
   !present(entry,'logoutPartnerCompanyCode'))
   blocked.push("EIGHT_CODEBASE_API_EXPORTS_NOT_VERIFIED");
 const forbidden=/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)|\b(?:tx\.delete|recursiveDelete)\s*\(/;
 if(forbidden.test(workspaceService)||forbidden.test(codeAuth))
   blocked.push("RAW_FINANCE_OR_DESTRUCTIVE_BACKEND_PATH");
 if(!present(workspaceService,'partnerCodeSessions')||
    !present(workspaceService,'partnerCodeCredentials')||
    !present(workspaceService,'canViewRevenue!==false')||
    !present(workspaceService,'canViewUnitPrice!==false')||
    !present(workspaceService,'countSharingApproved!==true')||
    !present(codeAuth,'passwordValid')||
    !present(codeAuth,'safeEqual')||
    !present(codeAuth,'failedAttempts')||
    !present(codeAuth,'getAuth().verifyIdToken')||
    !present(codeAuth,'canViewRevenue:false')||
    !present(codeAuth,'canViewUnitPrice:false'))
   blocked.push("PARTNER_CODE_ACCESS_BOUNDARY_NOT_VERIFIED");
 return Object.freeze({
   scopedSourceCheckPassed:blocked.length===0,
   canonicalSalesAppUnchanged:blocked.length===0,
   fullProductionFinanceRulesApproved:false,
   liveBackupAndRestoreStillRequired:true,
   ownerSalesAccessStillRequiresLiveVerification:true,
   forbiddenChangeScope:"canonical Hosting,Firestore Rules,primary Functions,records,products,revenueGoals",
   blocked:Object.freeze([...new Set(blocked)])
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL("../",import.meta.url));
 const file=p=>readFileSync(path.join(root,p),"utf8");
 const hash=p=>execFileSync("git",["hash-object",p],{cwd:root,encoding:"utf8"}).trim();
 const result=inspectScopedCompanyCodeRelease({
  canonicalBlob:hash("index.html"),canonical:file("index.html"),
  partnerPage:file("partner-workspace.html"),
  workspaceService:file("functions-partner-workspace/service.cjs"),
  codeAuth:file("functions-partner-workspace/company-code-auth.cjs"),
  entry:file("functions-partner-workspace/index.js"),
  config:JSON.parse(file("firebase.partner-workspace.json"))
 });
 console.log("NICO_SCOPED_COMPANY_CODE_RELEASE "+JSON.stringify(result));
 if(!result.scopedSourceCheckPassed)process.exitCode=2;
}
