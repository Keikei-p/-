#!/usr/bin/env node
/**
 * Read-only Cloud Functions v2 regional snapshot around an additive Owner
 * settings deployment. Never reads Firestore, Auth users, sales or private
 * request bodies. Keeps SHA256 fingerprints only in runner temporary storage.
 */
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {NEW,PROJECT,REGION,checkDeployedMetadata}
 from "./owner-setup-six-release-scope.mjs";
const stop=c=>{throw Error("STOP_OWNER_REGION_METADATA_"+c);};
const BASE="projects/"+PROJECT+"/locations/"+REGION+"/functions/";
const URLS="https://cloudfunctions.googleapis.com/v2/"+BASE.slice(0,-1)+"?pageSize=1000";
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==="object"?
 Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export function summarizeRegional(rows,phase){
 if(!Array.isArray(rows)||rows.length>1000||
    !["before","after"].includes(phase))stop("ROWSET_INVALID");
 const protectedNames=new Map();
 for(const row of rows){
  if(!row||typeof row!=="object"||Array.isArray(row)||
     typeof row.name!=="string"||!row.name.startsWith(BASE)||
     protectedNames.has(row.name))stop("ROW_INVALID");
  const short=row.name.slice(BASE.length);
  if(!/^[A-Za-z][A-Za-z0-9]{0,120}$/.test(short))stop("FUNCTION_NAME_UNVERIFIED");
  if(NEW.includes(short))continue;
  protectedNames.set(short,createHash("sha256").update(JSON.stringify(stable(row))).digest("hex"));
 }
 if(phase==="before"&&rows.some(r=>NEW.includes(r.name.slice(BASE.length))))
   stop("OWNER_ALREADY_PRESENT");
 if(phase==="after")checkDeployedMetadata(rows);
 return Object.freeze(Object.fromEntries([...protectedNames].sort((a,b)=>a[0].localeCompare(b[0]))));
}
export function compareProtected(before,after){
 if(!before||!after||typeof before!=="object"||typeof after!=="object"||
    Array.isArray(before)||Array.isArray(after))stop("BASELINE_UNVERIFIED");
 const names=Object.keys(before);
 if(names.length!==Object.keys(after).length||names.some(n=>
  !/^[A-Za-z][A-Za-z0-9]{0,120}$/.test(n)||
  !/^[a-f0-9]{64}$/.test(before[n])||after[n]!==before[n]))
  stop("EXISTING_V2_CHANGED_OR_REMOVED");
 return Object.freeze({
  allExistingGen2FunctionsUnchanged:true,
  existingFunctionCount:names.length,ownerFunctionsAdded:6,
  existingFunctionReplacements:0,financeOrCountsUpdated:false
 });
}
async function main(){
 const phase=process.argv[2];
 if(!["before","after"].includes(phase)||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    !process.env.RUNNER_TEMP)
   stop("ENVIRONMENT");
 const creds=createRequire(new URL("../../functions/package.json",import.meta.url))(
  "firebase-admin/app").applicationDefault();
 const token=(await creds.getAccessToken())?.access_token;
 if(typeof token!=="string"||token.length<20)stop("TOKEN_MISSING");
 const result=await fetch(URLS,{method:"GET",redirect:"error",cache:"no-store",
  headers:{Authorization:"Bearer "+token}});
 if(result.status!==200)stop("REGION_GET_FAILED");
 const payload=await result.json();
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
    !Array.isArray(payload.functions??[])||
    payload.nextPageToken)stop("REGION_LIST_INCOMPLETE");
 const data=summarizeRegional(payload.functions??[],phase);
 const dest=path.join(process.env.RUNNER_TEMP,"nico-owner-six-other-gen2.private.json");
 if(phase==="before"){
  writeFileSync(dest,JSON.stringify(data),{mode:0o600,flag:"wx"});
  console.log("OWNER_SIX_EXISTING_GEN2_SNAPSHOT_CAPTURED");
 }else{
  const old=JSON.parse(readFileSync(dest,"utf8"));
  console.log("OWNER_SIX_EXISTING_GEN2_STABILITY "+JSON.stringify(compareProtected(old,data)));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_REGION_METADATA_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_REGION_METADATA_UNVERIFIED");
  process.exitCode=1;
 });
