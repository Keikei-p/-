import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
const PROJECT="sales-management-cc116",REGION="asia-northeast1",REPO="gcf-artifacts";
const RESOURCE="projects/"+PROJECT+"/locations/"+REGION+"/repositories/"+REPO;
function ageSeconds(str){
 if(typeof str!=="string")return NaN;
 const m=str.match(/^(\d+(?:\.\d+)?)([smhd])$/i);
 if(!m)return NaN;
 return Number(m[1])*({s:1,m:60,h:3600,d:86400}[m[2].toLowerCase()]);
}
export function validCleanupPolicy(p){
 if(!p||!["DELETE","Delete"].includes(typeof p.action==="string"?p.action:p.action?.type))return false;
 const c=p.condition||{};
 const age=ageSeconds(c.olderThan);
 if(!Number.isFinite(age)||age<=0||age>7*86400)return false;
 if(!["ANY","any"].includes(c.tagState))return false;
 if(c.newerThan||["tagPrefixes","packageNamePrefixes","versionNamePrefixes"].some(k=>Array.isArray(c[k])&&c[k].length>0))
  return false;
 return true;
}
// A bounded most-recent Keep policy preserves a small rollback window while
// the delete policy still bounds storage. Reject conditional/unbounded keeps.
export function boundedRollbackKeepPolicy(p){
 const action=typeof p?.action==="string"?p.action:p?.action?.type;
 if(!["KEEP","Keep"].includes(action))return false;
 const v=p?.mostRecentVersions;
 return !!v&&!p.condition&&Number.isSafeInteger(v.keepCount)&&
   v.keepCount>=1&&v.keepCount<=5&&
   (!v.packageNamePrefixes||v.packageNamePrefixes.length===0);
}
export function auditArtifactRepository(repo,permissions=[]){
 const policies=Object.values(repo?.cleanupPolicies||{});
 const deletionPolicyPresent=policies.some(validCleanupPolicy);
 // A maximum of five recent images per package is a bounded rollback
 // exception. Unknown or conditional keep rules remain fail-closed.
 const keeps=policies.filter(p=>["Keep","KEEP"].includes(typeof p?.action==="string"?p.action:p?.action?.type));
 const hasKeepPolicy=keeps.length>0;
 const boundedKeepPolicies=keeps.length>0&&keeps.every(boundedRollbackKeepPolicy);
 return Object.freeze({
  repositoryExists:!!repo,
  policyCount:policies.length,
  dryRun:repo?.cleanupPolicyDryRun===true,
  eligibleDeletionPolicy:deletionPolicyPresent&&(!hasKeepPolicy||boundedKeepPolicies)&&repo?.cleanupPolicyDryRun!==true,
  hasKeepPolicy,
  boundedKeepPolicies,
  iamCanUpdate:permissions.includes("artifactregistry.repositories.update"),
  iamCanDelete:permissions.includes("artifactregistry.versions.delete")
 });
}
export async function runAudit({request=fetch,getToken}={}){
 if(!getToken){
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  const {applicationDefault}=require("firebase-admin/app");
  getToken=async()=>(await applicationDefault().getAccessToken()).access_token;
 }
 const token=await getToken();
 if(!token)throw Error("STOP_MISSING_APPLICATION_IDENTITY");
 const base="https://artifactregistry.googleapis.com/v1/"+RESOURCE;
 const opts={headers:{Authorization:"Bearer "+token},redirect:"error"};
 const result=await request(base,opts);
 if(!result.ok)throw Error("STOP_ARTIFACT_REPOSITORY_HTTP_"+result.status);
 const repo=await result.json();
 if(repo.name!==RESOURCE)throw Error("STOP_ARTIFACT_REPOSITORY_NAME");
 const res=await request(base+":testIamPermissions",{
  ...opts,method:"POST",
  headers:{...opts.headers,"Content-Type":"application/json"},
  body:JSON.stringify({permissions:["artifactregistry.repositories.update","artifactregistry.versions.delete"]})
 });
 if(!res.ok)throw Error("STOP_ARTIFACT_IAM_DIAG_HTTP_"+res.status);
 const permissions=(await res.json()).permissions||[];
 const status=auditArtifactRepository(repo,permissions);
 return status;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const status=await runAudit();
  // Only coarse booleans. Never log a service account email, token or names.
  console.log("NICO_ARTIFACT_POLICY_AUDIT "+JSON.stringify(status));
 }catch(e){console.error(e.message?.startsWith("STOP_")?e.message:"STOP_ARTIFACT_AUDIT");process.exitCode=1;}
}
