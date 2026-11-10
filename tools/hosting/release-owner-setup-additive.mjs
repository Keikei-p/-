#!/usr/bin/env node
/**
 * Firebase Hosting: add exactly 11 reviewed Owner setup files and preserve
 * every existing live file hash + complete active Hosting configuration.
 * Manual only. Does not write Auth, Firestore, Functions or Security Rules.
 */
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {SITE,PROJECT,SOURCES,prepareOwnerSetupAdditive}
 from "./owner-setup-additive-guard.mjs";
const API="https://firebasehosting.googleapis.com/v1beta1";
const RELEASES=API+"/sites/"+SITE+"/releases?pageSize=1";
const VERSION=/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/;
const STOP=code=>{throw Error("STOP_OWNER_SETUP_RELEASE_"+code);};
const exactVersion=x=>{
 const list=x?.releases,version=list?.[0]?.version?.name;
 if(!Array.isArray(list)||list.length!==1||!VERSION.test(version||""))
  STOP("ACTIVE_VERSION_UNVERIFIED");
 return version;
};
export async function releaseOwnerSetupAdditive({
 request,sources,release=false,log=()=>{}
}={}){
 if(typeof request!=="function"||typeof release!=="boolean"||
    typeof log!=="function")STOP("ARGUMENTS");
 const latest=async()=>exactVersion(await request("GET",RELEASES));
 const version=await latest();
 const before=await request("GET",API+"/"+version);
 if(before?.name!==version||before.status!=="FINALIZED"||
    !before.config||typeof before.config!=="object"||
    Array.isArray(before.config))STOP("CONFIG_NOT_VERIFIED");
 const list=async name=>{
  const rows=[];let cursor="",pages=0;const seen=new Set();
  do{
   if(++pages>100||seen.has(cursor))STOP("PAGING");
   seen.add(cursor);
   const q=new URLSearchParams({pageSize:"1000"});
   if(cursor)q.set("pageToken",cursor);
   const result=await request("GET",API+"/"+name+"/files?"+q);
   if(!Array.isArray(result?.files)||result.files.length>1000||
      rows.length+result.files.length>20000)STOP("MANIFEST_INCOMPLETE");
   rows.push(...result.files);
   cursor=result.nextPageToken||"";
   if(typeof cursor!=="string"||cursor.length>3000)STOP("PAGE_TOKEN_INVALID");
  }while(cursor);
  return rows;
 };
 const oldFiles=await list(version);
 if(before.fileCount!=null&&Number(before.fileCount)!==oldFiles.length)
  STOP("LIVE_COUNT_DRIFT");
 const plan=prepareOwnerSetupAdditive({oldFiles,sources});
 log("OWNER_SETUP_HOSTING_PREFLIGHT "+JSON.stringify({
  existingAssetsPreserved:plan.sourceFiles,newFilesOnly:plan.additions,
  newRoutesOnly:true,hostingConfigUnchanged:true,
  originalSalesAndCountWrites:0
 }));
 if(!release)return Object.freeze({
  released:false,liveAssetsPreserved:plan.sourceFiles,newAssetsPlanned:11,
  allOriginalHashesPreserved:true,productionDocumentWrites:0
 });
 if(await latest()!==version)STOP("CONCURRENT_RELEASE_BEFORE_CREATE");
 const created=await request("POST",API+"/sites/"+SITE+"/versions",{config:before.config});
 if(!VERSION.test(created?.name||"")||created.status!=="CREATED")
  STOP("CREATED_VERSION_INVALID");
 const manifest=[...plan.proposedManifest.entries()];
 let uploadUrl="",required=new Set();
 for(let i=0;i<manifest.length;i+=800){
  const result=await request("POST",API+"/"+created.name+":populateFiles",{
   files:Object.fromEntries(manifest.slice(i,i+800))
  });
  if(!result||typeof result!=="object"||
     result.uploadRequiredHashes!=null&&!Array.isArray(result.uploadRequiredHashes))
   STOP("POPULATE_INVALID");
  if(result.uploadUrl){
   if(typeof result.uploadUrl!=="string"||
      uploadUrl&&uploadUrl!==result.uploadUrl)STOP("UPLOAD_URL_CHANGED");
   uploadUrl=result.uploadUrl;
  }
  for(const digest of result.uploadRequiredHashes||[]){
   if(typeof digest!=="string"||!plan.payloads.has(digest))
    STOP("UPLOAD_NOT_IN_REVIEWED_SET");
   required.add(digest);
  }
 }
 if(required.size>0){
  const prefix="https://upload-firebasehosting.googleapis.com/upload/sites/"+
   SITE+"/versions/"+created.name.split("/").at(-1)+"/";
  if(!uploadUrl.startsWith(prefix))STOP("UPLOAD_ORIGIN_UNVERIFIED");
 }
 for(const digest of required)await request("POST",uploadUrl+"/"+digest,
  plan.payloads.get(digest),"application/octet-stream");
 const finalized=await request("PATCH",API+"/"+created.name+"?update_mask=status",{
  status:"FINALIZED"
 });
 if(finalized?.name!==created.name||finalized.status!=="FINALIZED"||
    JSON.stringify(finalized.config)!==JSON.stringify(before.config))
  STOP("FINALIZED_CONFIG_DRIFT");
 const exact=async()=>{
  const actual=await list(created.name),got=new Map();
  for(const file of actual){
   if(typeof file?.path!=="string"||typeof file.hash!=="string"||
      got.has(file.path))STOP("FINAL_MANIFEST_INVALID");
   got.set(file.path,file.hash.toLowerCase());
  }
  if(got.size!==plan.proposedManifest.size||
     [...plan.proposedManifest].some(([p,h])=>got.get(p)!==h))
    STOP("FINAL_MANIFEST_DIFFERENT");
 };
 await exact();
 if(await latest()!==version)STOP("CONCURRENT_RELEASE_BEFORE_PUBLISH");
 const released=await request("POST",API+"/sites/"+SITE+
  "/releases?versionName="+encodeURIComponent(created.name),{});
 if(released?.version?.name!==created.name)STOP("RELEASE_RESPONSE_INVALID");
 if(await latest()!==created.name)STOP("LIVE_RELEASE_MISMATCH");
 await exact();
 const report=Object.freeze({
  released:true,existingAssetsUnchanged:plan.sourceFiles,newAssets:11,
  originalHostingConfigUnchanged:true,
  liveVersion:created.name,
  originalSalesAndCountWrites:0,authFunctionsRulesUnchanged:true
 });
 log("OWNER_SETUP_HOSTING_RELEASE "+JSON.stringify(report));
 return report;
}
function allowedUrl(method,value){
 let p;try{p=new URL(value);}catch{STOP("URL_INVALID");}
 const host=p.origin==="https://firebasehosting.googleapis.com"&&
  p.pathname.startsWith("/v1beta1/sites/"+SITE+"/");
 const upload=p.origin==="https://upload-firebasehosting.googleapis.com"&&
  p.pathname.startsWith("/upload/sites/"+SITE+"/versions/");
 if((!host&&!upload)||p.username||p.password||p.hash)STOP("URL_SCOPE");
 if(!["GET","POST","PATCH"].includes(method)||upload&&method!=="POST")
  STOP("METHOD");
 if(method==="PATCH"&&p.search!=="?update_mask=status")STOP("PATCH");
 if(method==="POST"&&!upload&&
    !(/\/versions$/.test(p.pathname)||/:populateFiles$/.test(p.pathname)||
      /\/releases$/.test(p.pathname)))STOP("POST");
 return p.href;
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==1||!["--dry-run","--release"].includes(args[0])||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)STOP("RUNTIME_SCOPE");
 const release=args[0]==="--release";
 if(release&&process.env.NICO_OWNER_SETUP_HOSTING_RELEASE!==
    "CONFIRM_ONLY_ELEVEN_NEW_OWNER_SETUP_ASSETS")STOP("APPROVAL");
 const base=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const sources=Object.fromEntries(Object.keys(SOURCES).map(file=>[
  file,readFileSync(path.join(base,file),"utf8")
 ]));
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credential=applicationDefault();
 const request=async(method,url,body=null,type="application/json")=>{
  const destination=allowedUrl(method,url);
  const access=(await credential.getAccessToken())?.access_token;
  if(typeof access!=="string"||access.length<20)STOP("TOKEN");
  const headers={Authorization:"Bearer "+access};
  const options={method,headers,redirect:"error"};
  if(body!==null){
   headers["Content-Type"]=type;
   options.body=type==="application/octet-stream"?body:JSON.stringify(body);
  }
  const response=await fetch(destination,options);
  if(!response.ok)STOP("HOSTING_HTTP_"+response.status);
  const data=await response.text();
  if(data.length>4000000)STOP("RESPONSE_TOO_LARGE");
  try{return data?JSON.parse(data):{};}catch{STOP("JSON_INVALID");}
 };
 const report=await releaseOwnerSetupAdditive({
  request,sources,release,log:console.log
 });
 console.log("OWNER_SETUP_HOSTING_RESULT "+JSON.stringify(report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_(?:SETUP_RELEASE|SETUP_HOSTING)_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_SETUP_RELEASE_UNVERIFIED");
  process.exitCode=1;
 });
