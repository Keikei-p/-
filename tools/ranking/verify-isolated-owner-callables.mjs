#!/usr/bin/env node
/**
 * NO DEPLOY. Prevent split-brain between reviewed ranking ESM and the
 * independent Firebase codebase. Fail if any copied module diverges.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
const root=fileURLToPath(new URL("../../",import.meta.url));
const vendor=path.join(root,"functions-ranking-approvals");
const listing=["trusted-combined-ranking-context.mjs",
 "ranking-owner-consent-status.mjs","ranking-owner-consent-service.mjs"];
for(const file of listing){
 const first=readFileSync(path.join(root,"ranking",file));
 const second=readFileSync(path.join(vendor,"vendor",file));
 if(!first.equals(second))throw Error("STOP_RANKING_VENDOR_DIVERGENCE_"+file);
}
const config=JSON.parse(readFileSync(path.join(root,"firebase.ranking-approvals.json"),"utf8"));
if(JSON.stringify(Object.keys(config))!==JSON.stringify(["functions"])||
   config.functions?.source!=="functions-ranking-approvals"||
   config.functions?.codebase!=="ranking-owner-approvals"||
   !Array.isArray(config.functions.ignore)||
   config.functions.ignore.length!==3)throw Error("STOP_FUNCTION_DEPLOY_SCOPE");
const original=JSON.parse(readFileSync(path.join(root,"firebase.partner-workspace.json"),"utf8"));
if(original.functions?.source!=="functions-partner-workspace"||
   original.functions?.codebase!=="partner-workspace")throw Error("STOP_OLD_FUNCTION_SCOPE");
const index=readFileSync(path.join(vendor,"index.js"),"utf8");
const controller=readFileSync(path.join(vendor,"controller.cjs"),"utf8");
if(index.includes("submitPartnerWorkspaceCounts")||
   index.includes("managePartnerWorkspace")||
   controller.includes("functions-partner-workspace")||
   !index.includes('NICO_RANKING_OWNER_SETTINGS_ENABLED==="enabled"')||
   !index.includes("getRankingOwnerConsentStatus")||
   !index.includes("setRankingOwnerConsent")||
   /process[.]env[.]NICO_RANKING_OWNER_SETTINGS_ENABLED\s*[=]\s*/.test(index)||
   /firebase\s+deploy|firestore[.]rules|\.delete\s*\(/.test(controller))
  throw Error("STOP_RANKING_FUNCTION_FINANCE_OR_DEPLOY_BOUNDARY");
console.log("RANKING_OWNER_ISOLATED_FUNCTION_VENDOR_PARITY_PASS_NO_DEPLOY");
