/**
 * Read-only postmortem for a FAILED, scoped ranking deployment.
 * Never prints the private CLI log, Function metadata, identities or tokens.
 * A partial Function creation is not a successful deployment or authorization.
 */
import {readFileSync} from "node:fs";
import {getIds} from "./ranking-disabled-function-scope.mjs";

const NAME="getVerifiedJointCountRanking";
const EXACT="projects/sales-management-cc116/locations/asia-northeast1/functions/"+NAME;
const STOP=()=>{throw Error("RANKING_DEPLOY_FAILURE_RECONCILIATION_REQUIRED")};

export function classifyFailureLog(log){
  if(typeof log!=="string")STOP();
  if(/(?:permission.denied|permission denied|insufficient permissions|not authorized|iam\.serviceaccounts)/i.test(log))
    return "PERMISSION_OR_IAM";
  if(/(?:billing|quota exceeded|resource.exhausted|quota limit)/i.test(log))
    return "BILLING_OR_QUOTA";
  if(/(?:build failed|build error|cloud build|npm err|failed to build)/i.test(log))
    return "BUILD_OR_DEPENDENCY";
  if(/(?:timeout|timed out|deadline.exceeded)/i.test(log))
    return "TIMEOUT";
  if(/(?:api has not been used|api not enabled|serviceusage)/i.test(log))
    return "API_NOT_ENABLED";
  return "UNCLASSIFIED_PRIVATE_LOG";
}

export function summarizeFailedDeploy(before,after,log){
  const old=getIds(before),now=getIds(after);
  const basename=id=>id.split("/").at(-1);
  if([...old].some(id=>basename(id)===NAME))STOP();
  if([...old].some(id=>!now.has(id)))STOP();
  const added=[...now].filter(id=>!old.has(id));
  if(added.length>1 || added.some(id=>basename(id)!==NAME))STOP();
  let ranking="ABSENT";
  if(added.length===1){
    const id=added[0];
    if(id!==NAME && id!==EXACT)STOP();
    const entry=after.result.find(item=>(item?.id||item?.name)===id);
    if(entry?.region!==undefined && entry.region!=="asia-northeast1")STOP();
    if(id===NAME && entry?.region!=="asia-northeast1")STOP();
    ranking="PRESENT_BUT_UNVERIFIED";
  }
  return Object.freeze({
    privateCliFailureCategory:classifyFailureLog(log),
    rankingFunction:ranking,
    originalFunctionIdsPreserved:true,
    originalFunctionVersionsVerified:false,
    rankingFeatureDisabledVerified:false,
    deploymentSucceeded:false,
    safeToRetryAutomatically:false,
    requiresReadOnlyMetadataAndManualReview:true
  });
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g,"/"))){
  try{
    const [beforePath,afterPath,logPath]=process.argv.slice(2);
    if(!beforePath||!afterPath||!logPath)STOP();
    const summary=summarizeFailedDeploy(
      JSON.parse(readFileSync(beforePath,"utf8")),
      JSON.parse(readFileSync(afterPath,"utf8")),
      readFileSync(logPath,"utf8")
    );
    console.log("RANKING_FAILED_DEPLOY_READONLY_SUMMARY "+JSON.stringify(summary));
  }catch{
    console.error("RANKING_DEPLOY_FAILURE_RECONCILIATION_REQUIRED_NO_RETRY");
    process.exitCode=1;
  }
}
