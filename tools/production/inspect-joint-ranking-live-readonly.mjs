/**
 * NICO FACTORY — live joint-ranking release status, GET ONLY / NO WRITES.
 * This script has no credentials, reads no Firestore documents, sends no
 * bearer tokens, and never configures IAM, billing, Rules or Functions.
 * It cannot prove real-account data isolation or make a GO decision.
 *
 * Run from GitHub Actions with no secrets. The status report contains only
 * HTTP status classes, not response bodies or user identifiers.
 */
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";

const PROJECT="sales-management-cc116";
const HOST="https://nico-factory.web.app";
const TARGETS=Object.freeze([
 {id:"direct-function",
  url:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking?month=2026-11"},
 {id:"hosting-rewrite",
  url:HOST+"/v1/owner-visible-counts?month=2026-11"}
]);
export function classifyJointRankingHttp(status,contentType=""){
 const json=/^application\/json(?:\s*;|$)/i.test(contentType.trim());
 if(!Number.isSafeInteger(status)||status<100||status>599)
  return "UNVERIFIED_HTTP";
 if(status===200)return json?"UNAUTHENTICATED_200_SECURITY_BLOCK":
  "HTTP_200_NOT_JSON_ROUTE_MISSING";
 if(status===301||status===302||status===307||status===308)
  return "REDIRECT_UNEXPECTED";
 if(status===401)return "AUTH_REQUIRED_NOT_REAL_USER_PROOF";
 if(status===403)return "ACCESS_DENIED_OR_IAM_BLOCK";
 if(status===404)return "NOT_FOUND_OR_UNREWRITTEN_ROUTE";
 if(status===405)return "METHOD_ROUTE_MISMATCH";
 if(status===503)return "DISABLED_OR_UNAVAILABLE_NO_GO";
 return "HTTP_"+status+"_NEEDS_REVIEW";
}
export async function inspectJointRankingLive({fetchFn=fetch}={}){
 if(typeof fetchFn!=="function")throw Error("READONLY_FETCH_DEPENDENCY_REQUIRED");
 const outputs=[];
 for(const target of TARGETS){
  try{
   const response=await fetchFn(target.url,{
    method:"GET",
    headers:{"Accept":"application/json","Cache-Control":"no-store"},
    redirect:"manual",
    signal:AbortSignal.timeout(12000)
   });
   const status=response?.status;
   const contentType=response?.headers?.get?.("content-type")??"";
   outputs.push({target:target.id,
    status:Number.isSafeInteger(status)?status:null,
    verdict:classifyJointRankingHttp(status,contentType)});
   // Intentionally NEVER read .text(), .json() or headers that might
   // contain tokens/personal information.
  }catch{
   outputs.push({target:target.id,status:null,
    verdict:"NETWORK_UNAVAILABLE_NOT_PROOF"});
  }
 }
 return Object.freeze({project:PROJECT,inspection:"ANONYMOUS_GET_ONLY",
  functionsDeployedByThisCheck:false,
  documentsWrittenByThisCheck:false,rulesChangedByThisCheck:false,
  realAccountAuthorizationVerified:false,
  liveReleaseGo:false,targets:Object.freeze(outputs)});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const result=await inspectJointRankingLive();
 for(const item of result.targets)
  console.log("JOINT_RANKING_READONLY",item.target,
   item.status??"NO_STATUS",item.verdict);
 console.log("NICO_RANKING_LIVE_RELEASE=NO_GO_UNTIL_REAL_ACCOUNT_PROOF");
 console.log("FIREBASE_DEPLOYS=0 DOCUMENT_WRITES=0 RULES_CHANGED=0");
}
