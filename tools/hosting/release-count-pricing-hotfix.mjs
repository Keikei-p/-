/**
 * One unapproved candidate only. Default is GET-only dry-run. Human review,
 * signatures and protected PR checks are verified by the dedicated manual
 * workflow before credentials; this module independently binds its intent,
 * current main, immutable source release and exact candidate on every write.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {uploadSingleExistingIndex} from "./surgical-existing-index.mjs";
import {LIVE_BLOB,LIVE_VERSION,gitBlob} from "./prepare-count-pricing-hotfix.mjs";

export const CANDIDATE_BLOB="9e3185f554dd5c74ba3213ff8ffe6c088be23a8c";
export const CANDIDATE_SOURCE_BLOB="5edde6d5e5459ba283d12d157c021d4eee03d587";
export const CANDIDATE_SHA256="0822a201ac791e62dac9e032e80af8eb08622c2ba5adc62cc6313934f9cbe6d1";
export const MANIFEST_SHA256="8011e8e9ac4265aa9fdfa58f782ff12ae8dfc63bf4321e5f96f05370c5e928bb";
export const CONFIG_SHA256="3607756f3a42651deaa312840ed8b64fc16a999fdc2e9cff06ce1a0831540c43";
export const CONFIRMATION="RELEASE_COUNT_PRICING_INDEX_ONLY";
const BASE="https://firebasehosting.googleapis.com/v1beta1/";
const LATEST=BASE+"sites/nico-factory/releases?pageSize=1";
const SOURCE=BASE+LIVE_VERSION;
const WORKFLOW="Keikei-p/-/.github/workflows/nico-count-pricing-hotfix-manual.yml@refs/heads/main";
const stop=code=>{throw Error("STOP_COUNT_PRICING_RELEASE_"+code)};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export const sha256=data=>createHash("sha256").update(data).digest("hex");
export function assertCandidateRepoSource(source){
 if(typeof source!=="string"||gitBlob(source.replace(/\r\n/g,"\n"))!==CANDIDATE_SOURCE_BLOB)
  stop("REPO_SOURCE_BYTES");
}
export const configSha256=config=>{
 if(!object(config))stop("CONFIG_SHAPE");
 return sha256(JSON.stringify(config));
};
export function manifestSha256(files){
 if(!Array.isArray(files))stop("MANIFEST_SHAPE");
 const seen=new Set();
 const pairs=files.map(file=>{
  if(!object(file)||typeof file.path!=="string"||!file.path.startsWith("/")||
     !/^[0-9a-f]{64}$/.test(file.hash||"")||seen.has(file.path))stop("MANIFEST_ENTRY");
  seen.add(file.path);return [file.path,file.hash];
 }).sort((a,b)=>a[0].localeCompare(b[0],"en-US"));
 return sha256(JSON.stringify(pairs));
}
function latestName(body){
 if(!Array.isArray(body?.releases)||body.releases.length!==1||
    body.releases[0]?.version?.name!==LIVE_VERSION)stop("LIVE_VERSION_DRIFT");
 return LIVE_VERSION;
}
function sourceMetadata(body){
 if(body?.name!==LIVE_VERSION||body.status!=="FINALIZED"||
    ![33,"33"].includes(body.fileCount)||!object(body.config)||
    configSha256(body.config)!==CONFIG_SHA256)stop("SOURCE_METADATA_DRIFT");
}
function pageToken(url,version){
 let parsed;try{parsed=new URL(url)}catch{stop("URL")}
 if(parsed.origin!=="https://firebasehosting.googleapis.com"||
    parsed.pathname!=="/v1beta1/"+version+"/files"||
    parsed.searchParams.get("pageSize")!=="1000"||
    [...parsed.searchParams.keys()].some(x=>!["pageSize","pageToken"].includes(x))||
    parsed.searchParams.getAll("pageSize").length!==1||
    parsed.searchParams.getAll("pageToken").length>1||parsed.hash||parsed.username||parsed.password)
  stop("FILE_LIST_URL");
 const token=parsed.searchParams.get("pageToken")||"";
 if(token.length>3000)stop("PAGE_TOKEN");
 return token;
}
function intent(env,event,expected){
 if(!/^[0-9a-f]{40}$/.test(expected||"")||
    env.GITHUB_ACTIONS!=="true"||env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    env.GITHUB_REF!=="refs/heads/main"||env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    env.GITHUB_ACTOR!=="Keikei-p"||env.GITHUB_TRIGGERING_ACTOR!=="Keikei-p"||
    env.GITHUB_WORKFLOW_REF!==WORKFLOW||
    env.GITHUB_SHA!==expected||env.REVIEWED_MAIN_SHA!==expected||
    env.NICO_COUNT_PRICING_CONFIRMATION!==CONFIRMATION||
    !/^[1-9][0-9]{0,7}$/.test(env.REVIEWED_PR||"")||
    event?.sender?.login!=="Keikei-p"||event?.inputs?.reviewed_main_sha!==expected||
    event.inputs.confirmation!==CONFIRMATION||event.inputs.reviewed_pr!==env.REVIEWED_PR)
  stop("HUMAN_MANUAL_INTENT_REQUIRED");
}

export async function releaseCountPricingHotfix({assetBytes,request,readLiveIndex,
 readCurrentMain,reviewedMainSha,release=false,env={},event=null}={}){
 if(typeof release!=="boolean"||!Buffer.isBuffer(assetBytes)||
    gitBlob(assetBytes)!==CANDIDATE_BLOB||sha256(assetBytes)!==CANDIDATE_SHA256)
  stop("CANDIDATE_BYTES");
 if(typeof request!=="function"||typeof readLiveIndex!=="function"||
    typeof readCurrentMain!=="function"||!/^[0-9a-f]{40}$/.test(reviewedMainSha||""))
  stop("READ_DEPENDENCIES");
 const checkMain=async()=>{if(await readCurrentMain()!==reviewedMainSha)stop("MAIN_DRIFT")};
 const checkLiveIndex=async()=>{
  const bytes=await readLiveIndex();
  if(!Buffer.isBuffer(bytes)||gitBlob(bytes)!==LIVE_BLOB)stop("LIVE_INDEX_DRIFT");
 };
 const checkSource=async()=>{latestName(await request("GET",LATEST))};
 if(release)intent(env,event,reviewedMainSha);
 await checkMain();await checkSource();
 sourceMetadata(await request("GET",SOURCE));
 const files=[],tokens=new Set();let token="";
 do{
  if(tokens.has(token)||tokens.size>=100)stop("SOURCE_PAGE_LOOP");tokens.add(token);
  const q=new URLSearchParams({pageSize:"1000"});if(token)q.set("pageToken",token);
  const page=await request("GET",SOURCE+"/files?"+q);
  if(!Array.isArray(page?.files)||page.files.length>1000||
     typeof (page.nextPageToken||"")!=="string")stop("SOURCE_FILE_PAGE");
  files.push(...page.files);if(files.length>33)stop("SOURCE_FILE_COUNT");
  token=page.nextPageToken||"";
  if(token.length>3000)stop("PAGE_TOKEN");
 }while(token);
 if(files.length!==33||manifestSha256(files)!==MANIFEST_SHA256)stop("SOURCE_MANIFEST_DRIFT");
 const sourceFiles=new Map(files.map(x=>[x.path,x.hash]));
 if(!sourceFiles.has("/index.html"))stop("SOURCE_INDEX_MISSING");
 await checkLiveIndex();await checkMain();await checkSource();

 const gzip=gzipSync(assetBytes,{mtime:0}),candidateGzipHash=sha256(gzip);
 const expectedFiles=new Map(sourceFiles);expectedFiles.set("/index.html",candidateGzipHash);
 let created=null,writes=0;
 const sourcePages=new Set();
 const guardedRequest=async(method,url,body=null,type="application/json")=>{
  if(method==="GET"){
   if(url===LATEST){const result=await request(method,url);latestName(result);return result}
   if(url===SOURCE){const result=await request(method,url);sourceMetadata(result);return result}
   const sourceList=typeof url==="string"&&url.startsWith(SOURCE+"/files?");
   const finalList=created&&typeof url==="string"&&url.startsWith(BASE+created+"/files?");
   if(sourceList||finalList){
    const key=pageToken(url,sourceList?LIVE_VERSION:created);
    if(sourceList){if(sourcePages.has(key)||sourcePages.size>=100)stop("SOURCE_PAGE_LOOP");sourcePages.add(key)}
    const result=await request(method,url),expected=sourceList?sourceFiles:expectedFiles;
    if(!Array.isArray(result?.files)||result.files.length>33||
       typeof (result.nextPageToken||"")!=="string")stop("FILE_PAGE");
    for(const f of result.files)if(expected.get(f.path)!==f.hash)stop("FILE_HASH_DRIFT");
    return result;
   }
   if(created&&url===BASE+created){
    const result=await request(method,url);
    if(configSha256(result?.config)!==CONFIG_SHA256)stop("FINAL_CONFIG_DRIFT");
    return result;
   }
   stop("UNAPPROVED_GET");
  }
  if(!release)stop("DRY_RUN_WRITE");
  intent(env,event,reviewedMainSha);
  await checkMain();await checkSource();await checkLiveIndex();
  const create=method==="POST"&&url===BASE+"sites/nico-factory/versions";
  const populate=created&&method==="POST"&&url===BASE+created+":populateFiles";
  const finalize=created&&method==="PATCH"&&url===BASE+created+"?update_mask=status";
  const publish=created&&method==="POST"&&url===BASE+"sites/nico-factory/releases?versionName="+encodeURIComponent(created);
  const upload=created&&method==="POST"&&url===
   "https://upload-firebasehosting.googleapis.com/upload/"+created+"/files/"+candidateGzipHash;
  if(create){
   if(created||!object(body)||Object.keys(body).join("|")!=="config"||
      configSha256(body.config)!==CONFIG_SHA256)stop("CREATE_SCOPE");
  }else if(populate){
   if(!object(body)||Object.keys(body).join("|")!=="files"||!object(body.files)||
      Object.keys(body.files).length!==33||
      [...expectedFiles].some(([name,hash])=>body.files[name]!==hash))stop("POPULATE_SCOPE");
  }else if(finalize){
   if(!object(body)||JSON.stringify(body)!=='{"status":"FINALIZED"}')stop("FINALIZE_SCOPE");
  }else if(publish){
   if(!object(body)||Object.keys(body).length)stop("PUBLISH_SCOPE");
  }else if(upload){
   if(type!=="application/octet-stream"||!Buffer.isBuffer(body)||!body.equals(gzip))stop("UPLOAD_BYTES");
  }else stop("UNAPPROVED_WRITE");
  intent(env,event,reviewedMainSha);
  const result=await request(method,url,body,type);writes++;
  if(create){
   if(!/^sites\/nico-factory\/versions\/[A-Za-z0-9_-]+$/.test(result?.name||"")||
      result.name===LIVE_VERSION)stop("CREATED_VERSION");
   created=result.name;
  }
  return result;
 };
 const result=await uploadSingleExistingIndex({assetBytes,request:guardedRequest,release,log:()=>{}});
 if(result.released){
  await checkMain();
  const latest=await request("GET",LATEST);
  if(latest?.releases?.length!==1||latest.releases[0]?.version?.name!==result.newVersion)
   stop("POST_RELEASE_VERSION");
  const observed=await readLiveIndex();
  if(!Buffer.isBuffer(observed)||!observed.equals(assetBytes))stop("POST_RELEASE_HTTP");
 }
 return Object.freeze({mode:release?"RELEASE":"DRY_RUN",released:result.released,
  sourceVersion:LIVE_VERSION,sourceFiles:33,unchangedOtherAssets:32,
  candidateBlob:CANDIDATE_BLOB,candidateSha256:CANDIDATE_SHA256,
  manifestSha256:MANIFEST_SHA256,configSha256:CONFIG_SHA256,
  reviewedMainSha,hostingWriteCalls:writes,newVersion:result.newVersion||null,
  firestoreWrites:0,rulesWrites:0,functionsWrites:0,
  postPublicationByteCheck:result.released});
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length>1||(args.length===1&&!["--dry-run","--release"].includes(args[0])))stop("ARGUMENTS");
 const release=args[0]==="--release",env=process.env;
 if(!env.RUNNER_TEMP)stop("RUNNER_TEMP");
 const event=release?JSON.parse(readFileSync(env.GITHUB_EVENT_PATH||"","utf8")):null;
 if(release)intent(env,event,env.REVIEWED_MAIN_SHA);
 const assetBytes=readFileSync(join(env.RUNNER_TEMP,"count-pricing-live-index.html"));
 assertCandidateRepoSource(readFileSync(new URL("../../index.html",import.meta.url),"utf8"));
 // No protected identity is used until the candidate and release intent pass.
 if(gitBlob(assetBytes)!==CANDIDATE_BLOB||sha256(assetBytes)!==CANDIDATE_SHA256)stop("CANDIDATE_BYTES");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const credential=require("firebase-admin/app").applicationDefault();
 const request=async(method,url,body=null,type="application/json")=>{
  if(!(url.startsWith(BASE+"sites/nico-factory/")||
       url.startsWith("https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/")))
   stop("HOSTING_ENDPOINT");
  const token=(await credential.getAccessToken()).access_token;
  const options={method,redirect:"error",headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(30000)};
  if(body!==null){options.headers["Content-Type"]=type;options.body=type==="application/octet-stream"?body:JSON.stringify(body)}
  const response=await fetch(url,options);if(!response.ok)stop("HOSTING_HTTP_"+response.status);
  const raw=await response.text();return raw?JSON.parse(raw):{};
 };
 const readCurrentMain=async()=>{
  const headers={Accept:"application/vnd.github+json"};
  if(env.GH_TOKEN||env.GITHUB_TOKEN)headers.Authorization="Bearer "+(env.GH_TOKEN||env.GITHUB_TOKEN);
  const r=await fetch("https://api.github.com/repos/Keikei-p/-/git/ref/heads/main",
   {headers,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!r.ok)stop("MAIN_GET");return (await r.json()).object?.sha;
 };
 const readLiveIndex=async()=>{
  const r=await fetch("https://nico-factory.web.app/index.html",
   {redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(r.status!==200)stop("LIVE_HTTP");
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>3000000)stop("LIVE_SIZE");return bytes;
 };
 console.log(JSON.stringify(await releaseCountPricingHotfix({assetBytes,request,readLiveIndex,
  readCurrentMain,reviewedMainSha:env.REVIEWED_MAIN_SHA,release,env,event})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{
  console.error(/^STOP_COUNT_PRICING_RELEASE_[A-Z0-9_]+$/.test(error?.message||"")?
   error.message:"STOP_COUNT_PRICING_RELEASE_UNVERIFIED");process.exitCode=1;
 });
