/**
 * Post-deploy read-only inventory proof after Firebase CLI reported a
 * successful getPartnerWorkspace update but then exited nonzero while
 * configuring Artifact Registry cleanup policy on 2026-11-17.
 *
 * No Cloud Function, Firestore, Hosting, IAM, or Artifact Registry writes.
 * Never claim unrelated Functions are unchanged without a captured BEFORE
 * snapshot; the failed deploy job cleaned that snapshot on exit.
 */
import {PROJECT,REGION,TARGET,inspectOwnerGetMetadata,inspectOwnerGetEnvironmentKeyNames}
 from "./owner-get-single-function-guard.mjs";
const stop=(reason)=>{throw Error("STOP_OWNER_GET_POSTDEPLOY_"+reason);};
export const EARLIEST_RELEASE_UPDATE="2026-11-17T10:00:48.000Z";
export function inspectOwnerGetPostDeploy(rows,{
 earliest=EARLIEST_RELEASE_UPDATE,now="2026-11-17T11:00:00.000Z"
}={}){
 if(!Array.isArray(rows)||rows.length!==20)stop("EXACT_TWENTY_FUNCTIONS");
 const names=inspectOwnerGetEnvironmentKeyNames(rows);
 if(names.unrecognizedKeyCount!==0)stop("UNKNOWN_ENV_KEYS");
 const audit=inspectOwnerGetMetadata(rows);
 if(audit.count!==20||audit.target!==TARGET)stop("TARGET_SCOPE");
 if(rows.some(r=>r.state!=="ACTIVE"))stop("INACTIVE_FUNCTION");
 const target=rows.find(r=>r.name===TARGET);
 if(!target||target.buildConfig?.entryPoint!=="getPartnerWorkspace"||
    target.buildConfig?.runtime!=="nodejs22")
  stop("TARGET_RUNTIME");
 const when=Date.parse(target.updateTime||"");
 const min=Date.parse(earliest),max=Date.parse(now);
 if(!Number.isFinite(when)||!Number.isFinite(min)||!Number.isFinite(max)||
    when<=min||when>max+60000)stop("TARGET_NOT_UPDATED_IN_RELEASE_WINDOW");
 const env=target.serviceConfig?.environmentVariables||{};
 for(const flag of [
  "NICO_PARTNER_SHARED_RANKING_ENABLED",
  "NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED",
  "NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED",
  "NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED"
 ])if(env[flag]==="enabled")stop("HIGH_RISK_MODE_ENABLED");
 return Object.freeze({
  project:PROJECT,region:REGION,target:"getPartnerWorkspace",
  liveTargetActive:true,liveTargetUpdatedAfterReleaseStart:true,
  liveTargetUpdateTime:target.updateTime,
  liveFunctionsFound:20,otherFunctionsFound:19,allFunctionsActive:true,
  highRiskCountAndRankingModesDisabled:true,unknownEnvKeys:0,
  sameSourceAsReviewedMainVerified:false,
  otherFunctionsByteForByteUnchangedVerified:false,
  realOwnerAuthenticatedGetVerified:false,
  ownerFinanceReadDeniedVerified:false,
  postDeployAuditReadOnly:true,
  postDeployAuditDocumentWrites:0,
  postDeployAuditFunctionUpdates:0,
  postDeployAuditHostingUpdates:0
 });
}
