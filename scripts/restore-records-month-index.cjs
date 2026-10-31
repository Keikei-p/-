"use strict";
const PROJECT="sales-management-cc116";
const PARENT="projects/"+PROJECT+"/databases/(default)/collectionGroups/records";
const ENDPOINT="https://firestore.googleapis.com/v1/"+PARENT+"/indexes";
const FIELDS=[{fieldPath:"companyId",order:"ASCENDING"},{fieldPath:"date",order:"ASCENDING"}];
function isMonthlyIndex(i) {
 if(i?.queryScope!=="COLLECTION" || !Array.isArray(i.fields))return false;
 const a=i.fields;
 return a.length>=2 && a.length<=3 &&
   a[0]?.fieldPath==="companyId"&&a[0]?.order==="ASCENDING" &&
   a[1]?.fieldPath==="date"&&a[1]?.order==="ASCENDING" &&
   (a.length===2 || (a[2]?.fieldPath==="__name__"&&a[2]?.order==="ASCENDING"));
}
async function ensureMonthlyIndex({request,log=console.log,wait=async()=>{},polls=0}){
 if(typeof request!=="function")throw Error("request function required");
 const indexes=[];let token="",pageCount=0;
 do{
  if(++pageCount>50)throw Error("INDEX_LIST_TOO_MANY_PAGES");
  const url=ENDPOINT+"?pageSize=100"+(token?"&pageToken="+encodeURIComponent(token):"");
  const response=await request("GET",url);
  if(!response||!Array.isArray(response.indexes??[]))throw Error("INDEX_LIST_INVALID");
  indexes.push(...(response.indexes??[]));
  token=response.nextPageToken||"";
 }while(token);
 const existing=indexes.filter(isMonthlyIndex);
 if(existing.length>1)throw Error("DUPLICATE_MONTH_INDEXES_REQUIRE_MANUAL_REVIEW");
 let current=existing[0];
 if(current){
  if(current.state==="READY"){log("PASS EXISTING_MONTH_INDEX_READY "+current.name);return "READY";}
  if(current.state!=="CREATING")throw Error("INDEX_UNHEALTHY "+String(current.state));
  log("WAIT EXISTING_MONTH_INDEX_CREATING "+current.name);
 }else{
  // Exactly one approved additive schema index. No document, auth, rules,
  // existing-index deletion, replacement, or other collection write is allowed.
  const payload={queryScope:"COLLECTION",fields:FIELDS};
  const result=await request("POST",ENDPOINT,payload);
  if(!result?.name?.startsWith(PARENT+"/indexes/")&&!result?.name?.startsWith("projects/"+PROJECT+"/databases/(default)/operations/"))
    throw Error("INDEX_CREATE_RESPONSE_UNVERIFIED");
  log("CREATED ONLY records(companyId ASC,date ASC) INDEX "+result.name);
 }
 for(let i=0;i<polls;i++){
  await wait();
  const j=await request("GET",ENDPOINT+"?pageSize=100");
  if(!Array.isArray(j.indexes??[]))throw Error("INDEX_STATUS_INVALID");
  current=(j.indexes??[]).find(isMonthlyIndex);
  if(!current)throw Error("INDEX_MISSING_AFTER_CREATION");
  if(current.state==="READY"){log("PASS MONTH_INDEX_READY "+current.name);return "READY";}
  if(current.state!=="CREATING")throw Error("INDEX_UNHEALTHY "+String(current.state));
 }
 log("INDEX_CREATING_NOT_READY: Firestore is still building; original records are unchanged");
 return "CREATING";
}
async function main(){
 const {createRequire}=require("node:module");
 const {resolve}=require("node:path");
 const fromFunctions=createRequire(resolve(__dirname,"../functions/package.json"));
 const {applicationDefault}=fromFunctions("firebase-admin/app");
 const {access_token}=await applicationDefault().getAccessToken();
 if(!access_token)throw Error("SERVICE_ACCOUNT_TOKEN_UNAVAILABLE");
 const request=async(method,url,payload)=>{
  if(!url.startsWith(ENDPOINT)||!["GET","POST"].includes(method)||
     (method==="POST"&&(url!==ENDPOINT||JSON.stringify(payload)!==JSON.stringify({queryScope:"COLLECTION",fields:FIELDS}))))
   throw Error("UNAPPROVED_FIRESTORE_INDEX_OPERATION");
  const res=await fetch(url,{method,headers:{Authorization:"Bearer "+access_token,
    ...(method==="POST"?{"Content-Type":"application/json"}:{})},
    ...(method==="POST"?{body:JSON.stringify(payload)}:{})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error("FIRESTORE_INDEX_HTTP_"+res.status+" "+String(data?.error?.message||"").slice(0,180));
  return data;
 };
 const result=await ensureMonthlyIndex({request,wait:()=>new Promise(r=>setTimeout(r,20000)),polls:30});
 console.log("FINAL_INDEX_STATE "+result);
}
if(require.main===module)main().catch(e=>{console.error("STOP "+e.message);process.exitCode=1});
module.exports={ensureMonthlyIndex,isMonthlyIndex,ENDPOINT,FIELDS};
