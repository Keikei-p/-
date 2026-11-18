#!/usr/bin/env node
/**
 * Overlay exactly the reviewed Owner-archive index.html diff on LIVE bytes.
 * The live index may have independent approved login FX not in GitHub main.
 * Never deploy the repository's whole index: preserve every unrelated byte.
 */
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {uploadSingleExistingIndex,SITE,PROJECT} from "./surgical-existing-index.mjs";

export const REVIEWED_BEFORE="b77dffcae205a095fda21fa23959b7329802c725";
export const REVIEWED_AFTER="c3295f67f63102295d074d7729dbcad93d73a42a";
export const REVIEWED_PUBLIC_SHA256="ca7ef44b66e576cc4734ddf96a38d0a8d8636c5fe8502c58bb239f08ed1c4b9d";
export const REVIEWED_PUBLIC_VERSION="sites/nico-factory/versions/5b51a39e4318e1c1";
const HOST="https://firebasehosting.googleapis.com/v1beta1";
const stop=code=>{throw Error("STOP_OWNER_ARCHIVE_HOST_"+code);};
const sha=s=>createHash("sha256").update(s).digest("hex");
const occurrence=(str,segment)=>{
 const start=str.indexOf(segment);
 if(start<0||str.indexOf(segment,start+1)>=0)stop("MISSING_OR_AMBIGUOUS_LIVE_HUNK");
 return start;
};
export function parseReviewedIndexHunks(patch){
 if(typeof patch!=="string"||patch.length<80||patch.length>40000)stop("PATCH_INPUT");
 const lines=patch.split("\n");
 if(lines.some(s=>s.startsWith("diff --git ")&&!s.includes("a/index.html b/index.html")))
  stop("OTHER_FILE_PATCH");
 const hunks=[];let cursor=-1,section=null;
 const finalize=()=>{
  if(!section)return;
  if(section.old.length!==section.oldCount||section.next.length!==section.newCount)
    stop("HUNK_LINE_COUNTS");
  if(section.old.length<3||section.next.length<3)stop("HUNK_TOO_SMALL");
  hunks.push(Object.freeze({old:section.old.join("\n"),next:section.next.join("\n")}));
 };
 for(const line of lines){
  if(line.startsWith("@@ ")){
   finalize();
   const m=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
   if(!m)stop("BAD_HUNK_HEADER");
   const oldStart=Number(m[1]),newStart=Number(m[3]);
   if(oldStart<=cursor||newStart<1)stop("HUNK_ORDER");
   cursor=oldStart;
   section={oldCount:m[2]===undefined?1:Number(m[2]),
     newCount:m[4]===undefined?1:Number(m[4]),old:[],next:[]};
  }else if(section){
   if(line.startsWith("diff --git ")||line.startsWith("index ")||
      line.startsWith("--- ")||line.startsWith("+++ "))stop("DIFF_SECTION");
   if(line.startsWith("\\ No newline"))stop("NO_NEWLINE_HUNK");
   if(line.length===0&&line===lines.at(-1))continue;
   const type=line[0],value=line.slice(1);
   if(type===" "){section.old.push(value);section.next.push(value);}
   else if(type==="-")section.old.push(value);
   else if(type==="+")section.next.push(value);
   else if(line)stop("UNREVIEWED_PATCH_MARKER");
  }
 }
 finalize();
 if(hunks.length<5||hunks.length>35)stop("UNEXPECTED_HUNK_COUNT");
 if(!hunks.some(x=>x.next.includes("productArchivePendingIds"))||
    !hunks.some(x=>x.next.includes("validateArchivedProductCountChange"))||
    !hunks.some(x=>x.next.includes("restore-product-button"))||
    !hunks.some(x=>x.next.includes("archivedHistory")))stop("ARCHIVE_PATCH_INCOMPLETE");
 return Object.freeze(hunks);
}
export function applyHunks(source,hunks,reverse=false){
 if(typeof source!=="string"||source.length<500000||source.length>3000000)
  stop("SOURCE_SHAPE");
 let out=source;let min=0;
 for(const hunk of hunks){
  const before=reverse?hunk.next:hunk.old,after=reverse?hunk.old:hunk.next;
  const p=occurrence(out,before);
  if(p<min)stop("HUNKS_OUT_OF_ORDER");
  out=out.slice(0,p)+after+out.slice(p+before.length);
  min=p+after.length;
 }
 return out;
}
export function transplantReviewedArchive({base,proposed,live,patch}={}){
 if(typeof base!=="string"||typeof proposed!=="string"||
    typeof live!=="string")stop("INVALID_STRINGS");
 const hunks=parseReviewedIndexHunks(patch);
 if(applyHunks(base,hunks)!==proposed)stop("REVIEWED_DIFF_NOT_EXACT");
 if(applyHunks(proposed,hunks,true)!==base)stop("REVIEWED_DIFF_INVERSE");
 if(sha(Buffer.from(live,"utf8"))!==REVIEWED_PUBLIC_SHA256)
  stop("LIVE_INDEX_PREIMAGE_CHANGED");
 const candidate=applyHunks(live,hunks);
 if(candidate===live||applyHunks(candidate,hunks,true)!==live)
  stop("LIVE_INVERSE_MISMATCH");
 if(candidate.includes("productArchivePendingIds")!==true||
    !candidate.includes("nfLoginFXController"))
  stop("LIVE_FEATURES_MISSING");
 return Object.freeze({
  candidate,sourceSha256:sha(Buffer.from(live,"utf8")),
  candidateSha256:sha(Buffer.from(candidate,"utf8")),hunkCount:hunks.length
 });
}
async function getPublicIndex(tag){
 const response=await fetch("https://"+SITE+".web.app/?archive_review="+encodeURIComponent(tag),{
  redirect:"follow",cache:"no-store",signal:AbortSignal.timeout(25000)});
 if(!response.ok||new URL(response.url).origin!=="https://"+SITE+".web.app")
  stop("PUBLIC_INDEX_UNAVAILABLE");
 return Buffer.from(await response.arrayBuffer());
}
async function main(){
 const mode=process.argv[2];
 if(process.argv.length!==3||!["--dry-run","--release"].includes(mode)||
    process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    PROJECT!=="sales-management-cc116"||SITE!=="nico-factory")
  stop("RUNTIME");
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8",maxBuffer:3500000});
 if(git("rev-parse",REVIEWED_AFTER+":index.html").trim()!==
    git("hash-object","index.html").trim())stop("REVIEWED_SOURCE_CHANGED");
 if(git("rev-parse","HEAD").trim()!==process.env.GITHUB_SHA)stop("WRONG_MAIN");
 const base=git("show",REVIEWED_BEFORE+":index.html");
 const proposed=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
 const patch=git("diff","--unified=3",REVIEWED_BEFORE,REVIEWED_AFTER,"--","index.html");
 const first=await getPublicIndex("preflight_"+process.env.GITHUB_SHA);
 const reviewed=transplantReviewedArchive({base,proposed,live:first.toString("utf8"),patch});
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credential=applicationDefault();
 let pinnedVersion=null;
 const request=async(method,url,body=null,type="application/json")=>{
  if(!url.startsWith(HOST+"/sites/"+SITE+"/")&&
     !url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/"+SITE+"/versions/"))
    stop("NON_HOSTING_API");
  const token=(await credential.getAccessToken()).access_token;
  const headers={Authorization:"Bearer "+token};
  if(body!==null)headers["Content-Type"]=type;
  const response=await fetch(url,{method,headers,redirect:"error",
    body:body===null?undefined:type==="application/octet-stream"?body:JSON.stringify(body)});
  if(!response.ok)stop("HOSTING_API_HTTP_"+response.status);
  const raw=await response.text();
  const result=raw?JSON.parse(raw):{};
  if(pinnedVersion&&method==="GET"&&url===HOST+"/sites/"+SITE+"/releases?pageSize=1"&&
     result?.releases?.[0]?.version?.name!==pinnedVersion)
    stop("HOSTING_VERSION_CHANGED");
  return result;
 };
 const releaseInfo=await request("GET",HOST+"/sites/"+SITE+"/releases?pageSize=1");
 const liveVersion=releaseInfo?.releases?.[0]?.version?.name;
 if(liveVersion!==REVIEWED_PUBLIC_VERSION)stop("LIVE_HOSTING_VERSION_UNREVIEWED");
 pinnedVersion=liveVersion;
 const meta=await request("GET",HOST+"/"+liveVersion);
 if(meta?.status!=="FINALIZED")stop("HOSTING_NOT_FINALIZED");
 const files=[],seen=new Set();let pageToken="";
 do{
  if(seen.has(pageToken))stop("MANIFEST_PAGINATION_LOOP");
  seen.add(pageToken);
  const q=new URLSearchParams({pageSize:"1000"});
  if(pageToken)q.set("pageToken",pageToken);
  const batch=await request("GET",HOST+"/"+liveVersion+"/files?"+q);
  if(!Array.isArray(batch.files))stop("HOSTING_MANIFEST_MISSING");
  files.push(...batch.files);pageToken=batch.nextPageToken||"";
  if(files.length>1000)stop("HOSTING_ASSET_LIMIT");
 }while(pageToken);
 if(files.length!==33||new Set(files.map(x=>x.path)).size!==33)
  stop("UNREVIEWED_HOSTING_ASSET_COUNT");
 const gz=gzipSync(first,{mtime:0});
 const expectedHash=sha(gz);
 if(files.find(x=>x.path==="/index.html")?.hash!==expectedHash)
  stop("PUBLIC_INDEX_MANIFEST_MISMATCH");
 const again=await getPublicIndex("before_release_"+process.env.GITHUB_SHA);
 if(sha(again)!==REVIEWED_PUBLIC_SHA256)stop("LIVE_INDEX_CHANGED_DURING_AUDIT");
 const willRelease=mode==="--release";
 if(willRelease&&process.env.NICO_OWNER_ARCHIVE_HOSTING_APPROVAL!==
    "REVIEWED_ARCHIVE_INDEX_ONLY_NO_OTHER_ASSETS")stop("RELEASE_NOT_APPROVED");
 const result=await uploadSingleExistingIndex({
  assetBytes:Buffer.from(reviewed.candidate,"utf8"),request,release:willRelease,
  log:message=>console.log("HOSTING_ARCHIVE "+message)
 });
 if(result.sourceName!==liveVersion||result.originalCount!==33)
  stop("RELEASE_SOURCE_SCOPE");
 console.log("NICO_OWNER_ARCHIVE_HOST "+JSON.stringify({
  status:result.released?"RELEASED":"DRY_RUN_OK",
  changesApplied:hunkCountToNumber(reviewed.hunkCount),
  retainedLiveLoginFx:true,retainedExistingOtherPaths:32,
  originalBytesSha256:reviewed.sourceSha256,candidateBytesSha256:reviewed.candidateSha256,
  productionDocumentWrites:0,rulesChanges:0
 }));
 if(!willRelease)return;
 if(result.released!==true)stop("NOT_RELEASED");
 let served=false;
 for(let i=0;i<12;i++){
  const page=await getPublicIndex("after_"+process.env.GITHUB_SHA+"_"+i);
  if(sha(page)===reviewed.candidateSha256){served=true;break;}
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
 if(!served)stop("POST_DEPLOY_PUBLIC_SHA_MISMATCH");
 for(const p of ["/partner-workspace.html","/partner-invite.html","/partner-counts.html"]){
  const response=await fetch("https://"+SITE+".web.app"+p,{
   redirect:"follow",signal:AbortSignal.timeout(15000)});
  if(response.status!==200)stop("OTHER_PUBLIC_ROUTE_FAILED");
 }
 console.log("OWNER_PRODUCT_ARCHIVE_INDEX_ONLY_AND_LOGIN_FX_PUBLIC_BYTE_PARITY_PASS");
}
function hunkCountToNumber(value){
 if(!Number.isInteger(value)||value<5||value>35)stop("BAD_HUNK_COUNT");
 return value;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{const msg=e?.message||"";
  console.error(/^STOP_OWNER_ARCHIVE_HOST_[A-Z0-9_]+$/.test(msg)?msg:
    "STOP_OWNER_ARCHIVE_HOST_UNVERIFIED");process.exitCode=1;});
