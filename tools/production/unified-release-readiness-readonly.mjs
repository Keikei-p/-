#!/usr/bin/env node
/**
 * Production release board, READ ONLY / NO DEPLOY.
 * Consumes sanitized results from four already reviewed production GET audits.
 * Does not fetch production itself and cannot change production state.
 * A successful audit is NOT a production-release authorization.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {classifyInventory,TARGETS as CLI_TARGETS,REGION as CLI_REGION} from "./inspect-four-count-cli-region-readonly.mjs";

export const PROJECT="sales-management-cc116";
export const LABELS=Object.freeze({
 rules:"NICO_LIVE_RULES_SOURCE_AUDIT ",
 partner:"PARTNER_COUNT_FUNCTION_METADATA ",
 secondary:"NICO_SECONDARY_READ_ONLY ",
 billing:"NICO_BILLING_METADATA_SAFE "
});
const fail=code=>{throw Error("STOP_NICO_UNIFIED_READINESS_"+code)};
export const COUNT_FUNCTIONS=Object.freeze(["getPartnerWorkspace",
 "submitPartnerWorkspaceCounts","managePartnerWorkspace","acceptPartnerWorkspaceInvite"]);
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const bool=(v,name)=>{
 if(typeof v!=="boolean")fail("INVALID_"+name.toUpperCase());
 return v;
};
const parseReport=(source,prefix)=>{
 if(typeof source!=="string"||source.length>2000000)fail("INVALID_REPORT");
 const lines=source.split(/\r?\n/).map(x=>x.trim());
 const found=lines.filter(line=>line.startsWith(prefix));
 if(found.length!==1)fail("MISSING_OR_DUPLICATE_REPORT");
 let item;
 try{item=JSON.parse(found[0].slice(prefix.length));}
 catch{fail("REPORT_NOT_JSON");}
 if(!object(item)||item.project!==PROJECT||item.productionWrites>0||
    item.originalSalesDataWrites>0||item.productionDocumentWrites>0||
    item.userDataReads>0||item.deploys>0)fail("WRONG_PROJECT_OR_WRITES");
 return item;
};
export function extractReports(logs){
 if(!object(logs)||Object.keys(LABELS).some(k=>typeof logs[k]!=="string"))
  fail("LOGS_MISSING");
 return Object.fromEntries(Object.entries(LABELS).map(([key,label])=>
  [key,parseReport(logs[key],label)]));
}
export function summarize(input,cliInventory=null){
 if(!object(input))fail("MISSING_INPUT");
 const {rules,partner,secondary,billing}=input;
 if([rules,partner,secondary,billing].some(r=>!object(r)||r.project!==PROJECT))
  fail("WRONG_PROJECT");
 const matched=bool(rules.liveRulesMatchReviewedAndTested,"rules_match");
 const secondaryRisk=bool(secondary.oldInternalFinancePathPresent,"secondary_risk");
 const ownerRisk=bool(secondary.ownerContextConflictPresent,"owner_conflict");
 const unknownRisk=bool(secondary.unrecognizedContextPresent,"unknown_context");
 const backup=bool(secondary.recentReadyBackupWithin48h,"recent_backup");
 const fnAvailable=bool(partner.countFunctionMetadataPresent,"fn_present");
 const fnActive=bool(partner.countFunctionsActive,"fn_active");
 const fnEnabled=bool(partner.countFunctionsConfiguredEnabled,"fn_enabled");
 // Validate actual per-function Cloud Functions v2 metadata rather than trusting
 // a single aggregate boolean. Never copy raw deployment metadata, secrets,
 // endpoints, traffic URIs or source environment into the public report.
 if(!object(partner.functions)||Object.keys(partner.functions).sort().join("|")!==
    [...COUNT_FUNCTIONS].sort().join("|"))fail("FOUR_FUNCTION_IDENTITIES");
 const countFunctionHealth={};
 for(const name of COUNT_FUNCTIONS){
  const item=partner.functions[name];
  if(!object(item)||Object.keys(item).sort().join("|")!==
     ["deployed","active","callableGen2","countEnabled"].sort().join("|"))
   fail("FUNCTION_METADATA_SHAPE");
  const deployed=bool(item.deployed,"deployed"),active=bool(item.active,"active"),
   callableGen2=bool(item.callableGen2,"callable_gen2"),
   countEnabled=bool(item.countEnabled,"count_enabled");
  if(active&&!deployed||callableGen2&&!active||countEnabled&&!callableGen2)
   fail("FUNCTION_STATE_INCONSISTENT");
  countFunctionHealth[name]=Object.freeze({deployed,active,
   callableGen2,countEnabled});
 }
 if(fnAvailable!==COUNT_FUNCTIONS.every(name=>countFunctionHealth[name].deployed)||
    fnActive!==COUNT_FUNCTIONS.every(name=>countFunctionHealth[name].active)||
    fnEnabled!==COUNT_FUNCTIONS.every(name=>countFunctionHealth[name].countEnabled))
  fail("FUNCTION_AGGREGATE_INCONSISTENT");

 // The direct Google v2 GET audit can report 404 for each name while the
 // pinned Firebase CLI lists all four exact regional Gen2 ACTIVE Functions.
 // Keep the evidence channels independent: neither a 404 nor a CLI match
 // alone proves a signed-in count save or a financial permission denial.
 let cliMetadataVerified=false,cliMetadataAvailable=false;
 const cliCountFunctionHealth={};
 if(cliInventory!==null){
  if(!object(cliInventory)||cliInventory.project!==PROJECT||
     cliInventory.mode!=="SANITIZED_FUNCTIONS_LIST_READ_ONLY"||
     cliInventory.deploymentAuthorized!==false||
     cliInventory.financeRulesChangeAuthorized!==false||
     cliInventory.liveFunctionInvocations!==0||
     cliInventory.productionDocumentWrites!==0||
     !object(cliInventory.functions)||
     Object.keys(cliInventory.functions).sort().join("|")!==[...CLI_TARGETS].sort().join("|")||
     CLI_REGION!=="asia-northeast1")fail("CLI_REPORT_UNTRUSTED");
  cliMetadataAvailable=true;
  for(const name of CLI_TARGETS){
   const item=cliInventory.functions[name];
   if(!object(item)||Object.values(item).some(v=>!Number.isSafeInteger(v)||v<0)||
      !Number.isSafeInteger(item.entries)||
      Object.keys(item).sort().join("|")!==[
       "listed","entries","inTargetRegion","outsideTargetRegion","regionUnknown",
       "projectUnknown","otherProject","gen1Listed","gen2Listed",
       "generationUnknown","stateKnown","activeState","codebaseKnown",
       "expectedCodebase","workspaceFlagKnown","workspaceFlagEnabled"
      ].sort().join("|")||
      typeof item.listed!=="boolean"||
      item.entries>500)
      fail("CLI_FUNCTION_ROW_UNTRUSTED");
   cliCountFunctionHealth[name]=item.listed===true&&item.entries===1&&
     item.inTargetRegion===1&&item.outsideTargetRegion===0&&
     item.regionUnknown===0&&item.projectUnknown===0&&item.otherProject===0&&
     item.gen1Listed===0&&item.gen2Listed===1&&item.generationUnknown===0&&
     item.stateKnown===1&&item.activeState===1&&item.codebaseKnown===1&&
     item.expectedCodebase===1&&item.workspaceFlagKnown===1&&
     item.workspaceFlagEnabled===1;
  }
  cliMetadataVerified=CLI_TARGETS.every(name=>cliCountFunctionHealth[name]===true);
 }
 const directV2Verified=fnAvailable&&fnActive&&fnEnabled;
 const functionMetadataSourceConflict=cliMetadataAvailable&&
   CLI_TARGETS.some(name=>cliCountFunctionHealth[name]!==(
     countFunctionHealth[name].deployed&&countFunctionHealth[name].active&&
     countFunctionHealth[name].callableGen2&&countFunctionHealth[name].countEnabled));
 const bills=bool(billing.billingEnabled,"billing_enabled");
 const linked=bool(billing.linkedBillingAccount,"billing_linked");
 const verifiedTrial=bool(billing.trialCreditBalanceVerified,"trial_balance");
 const guaranteed=bool(billing.noRecurringChargeGuaranteed,"recurring_guarantee");
 if(rules.testedAgainstSyntheticEmulatorOnly!==true||
    rules.realPartnerGetListProven!==false||
    secondary.realPartnerFinanceDenyVerified!==false||
    partner.realPartnerCountEntryVerified!==false||
    billing.releaseCostGatePassed!==false)
  fail("AUDIT_CONTRACT_CHANGED");
 const blocks=[];
 if(!matched)blocks.push("LIVE_RULES_NOT_PARITY_VERIFIED");
 if(secondaryRisk)blocks.push("SECONDARY_ACCOUNT_INTERNAL_FINANCE_PATH");
 if(ownerRisk)blocks.push("INTERNAL_OWNER_CONTEXT_CONFLICT");
 if(unknownRisk)blocks.push("SECONDARY_CONTEXT_UNRECOGNIZED");
 if(!backup)blocks.push("RECENT_RESTORABLE_BACKUP_NOT_PROVED");
 if(functionMetadataSourceConflict)
  blocks.push("FOUR_COUNT_FUNCTION_METADATA_SOURCE_CONFLICT");
 if(!directV2Verified&&cliMetadataVerified!==true)
  blocks.push("FOUR_NEW_COUNT_FUNCTIONS_NOT_READY");
 if(!bills||!linked)blocks.push("BILLING_PROJECT_LINK_NOT_VERIFIED");
 if(!verifiedTrial||!guaranteed)
  blocks.push("TRIAL_AND_FUTURE_COST_LIMIT_NOT_PROVED_BY_API");
 blocks.push("REAL_PARTNER_TOKEN_DENIAL_NOT_PROVED");
 blocks.push("REAL_PARTNER_COUNT_SUBMISSION_NOT_PROVED");
 return Object.freeze({
  project:PROJECT,mode:"READ_ONLY_NO_DEPLOY",
  reviewedLiveRulesIdentical:matched,
  secondaryFinanceAccessPathStillPresent:secondaryRisk,
  originalOwnerSecondaryConflict:ownerRisk,
  secondaryContextUnknown:unknownRisk,
  recentReadyBackupPresent:backup,
  fourCountFunctionsDeployedActiveEnabled:directV2Verified,
  fourCountFunctionsCliVerified:cliMetadataVerified,
  fourCountFunctionsCliEvidenceAvailable:cliMetadataAvailable,
  countFunctionMetadataSourceConflict:functionMetadataSourceConflict,
  countFunctionCliHealth:Object.freeze({...cliCountFunctionHealth}),
  // These statuses are independently useful and contain only four public names
  // and boolean readiness flags, never user or billing information.
  countFunctionHealth:Object.freeze(countFunctionHealth),
  firebaseBillingLinked:bills&&linked,
  trialBalanceVerifiedByProjectBillingApi:verifiedTrial,
  noFutureRecurringChargesGuaranteed:guaranteed,
  realPartnerTokenGetListTestCompleted:false,
  realPartnerCountSubmissionCompleted:false,
  safeForFinanceBoundaryCutover:false,
  safeForPartnerFullRelease:false,
  productionDocumentWrites:0,productionRulesWrites:0,
  productionFunctionsDeploys:0,
  blockingReasons:blocks
 });
}
export function renderPublic(result){
 if(!object(result)||result.mode!=="READ_ONLY_NO_DEPLOY"||
    result.safeForPartnerFullRelease!==false||
    !Array.isArray(result.blockingReasons))fail("PUBLIC_REPORT");
 return "NICO_RELEASE_READINESS "+JSON.stringify(result);
}
async function main(){
 if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||!process.env.RUNNER_TEMP)
  fail("ENV");
 const prefix=path.join(process.env.RUNNER_TEMP,"nico-readiness-");
 const logs=Object.fromEntries(Object.keys(LABELS).map(key=>
  [key,readFileSync(prefix+key+".private.log","utf8")]));
 // Only ephemeral runner-private Firebase CLI metadata may be ingested.
 // No remote write request or raw Function metadata appears in public logs.
 const cliFile=path.join(process.env.RUNNER_TEMP,"nico-readiness-cli.private.json");
 const cliSource=readFileSync(cliFile,"utf8");
 if(cliSource.length>2000000)fail("CLI_SOURCE_OVERSIZE");
 const cliReport=classifyInventory(JSON.parse(cliSource));
 const report=summarize(extractReports(logs),cliReport);
 console.log(renderPublic(report));
 for(const reason of report.blockingReasons)console.log("BLOCK_"+reason);
 console.log("NO_PRODUCTION_CHANGES_VERIFIED_BY_READ_ONLY_AUDITS");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_NICO_UNIFIED_READINESS_[A-Z_]+$/.test(e?.message||"")?
    e.message:"STOP_NICO_UNIFIED_READINESS_UNVERIFIED");
  process.exitCode=1;
 });
}
