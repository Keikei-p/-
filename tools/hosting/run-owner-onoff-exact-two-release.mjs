#!/usr/bin/env node
/**
 * Production runner for EXACT-TWO Firebase Hosting assets.
 *
 * IMPORTANT: Only publishes a standalone Owner ON/OFF HTML page and its
 * mount JS. It does NOT change Firebase Functions flags, Rules or Firestore.
 * The existing app's 3 matching dependencies are reused byte-for-byte.
 *
 * Execution restricted to GitHub Actions, exact protected main HEAD and
 * explicit single-purpose squash-commit subject. No laptop credentials.
 */
import {readFileSync,writeFileSync,unlinkSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {
  prepareOwnerOnOffTwoAssetRelease
} from "./release-owner-onoff-two-assets.mjs";
import {ONOFF_ASSETS} from "./owner-product-onoff-additive-guard.mjs";

const PROJECT="sales-management-cc116";
const REPOSITORY="Keikei-p/-";
const INTENT="release(hosting): publish Owner ONOFF two assets only";
const SITE="nico-factory";
const API="https://firebasehosting.googleapis.com/v1beta1";
const STOP=code=>{throw Error("STOP_OWNER_ONOFF_EXACT_TWO_"+code);};
function safeUrl(method,url){
 if(!["GET","POST","PATCH"].includes(method))STOP("METHOD");
 let u;try{u=new URL(url)}catch{STOP("URL")}
 if(u.username||u.password||u.hash)STOP("URL_AUTH");
 const normal=u.origin==="https://firebasehosting.googleapis.com"&&
   u.pathname.startsWith("/v1beta1/sites/"+SITE+"/");
 const upload=u.origin==="https://upload-firebasehosting.googleapis.com"&&
   /^\/upload\/sites\/nico-factory\/versions\/[A-Za-z0-9_-]+\/files\/[a-f0-9]{64}$/.test(u.pathname);
 if(!normal&&!upload)STOP("ORIGIN_OR_PATH");
 if(upload&&(method!=="POST"||u.search))STOP("UPLOAD_SCOPE");
 if(normal&&method==="PATCH"&&!(/\/versions\/[A-Za-z0-9_-]+$/.test(u.pathname)&&
     u.search==="?update_mask=status"))STOP("PATCH_SCOPE");
 if(normal&&method==="POST"&&!(/\/versions$/.test(u.pathname)||
     /\/versions\/[A-Za-z0-9_-]+:populateFiles$/.test(u.pathname)||
     /\/releases$/.test(u.pathname)))STOP("POST_SCOPE");
 if(method!=="POST"&&method!=="PATCH"&&method!=="GET")STOP("METHOD_SCOPE");
 return u.href;
}
function sourceFiles(){
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 return Object.fromEntries(Object.keys(ONOFF_ASSETS).map(name=>[
   name,readFileSync(path.join(root,name.slice(1)),"utf8")
 ]));
}
export async function runOwnerOnOffHosting({
  args=process.argv.slice(2),env=process.env,read=sourceFiles,
  credentials,net=fetch,log=console.log
}={}){
 if(!Array.isArray(args)||args.length!==1||
    !["--dry-run","--release"].includes(args[0]))STOP("ARGUMENTS");
 const release=args[0]==="--release";
 if(env.GITHUB_ACTIONS!=="true"||
    env.GITHUB_REPOSITORY!==REPOSITORY||
    env.GITHUB_REF!=="refs/heads/main"||
    env.GITHUB_EVENT_NAME!=="push"||
    env.FIREBASE_PROJECT_ID!==PROJECT||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||"")||
    !env.GOOGLE_APPLICATION_CREDENTIALS)
   STOP("CI_CONTEXT");
 if(env.NICO_ONOFF_STATIC_MAIN_SHA!==env.GITHUB_SHA||
    env.NICO_ONOFF_STATIC_COMMIT_SUBJECT!==INTENT)
   STOP("REVIEWED_MAIN_COMMIT");
 if(release&&env.NICO_ONOFF_STATIC_RELEASE!==
    "APPROVE_ONLY_TWO_STATIC_OWNER_ONOFF_ASSETS")STOP("EXPLICIT_RELEASE_APPROVAL");
 if(typeof credentials!=="function"||typeof net!=="function"||
    typeof read!=="function")STOP("DEPENDENCIES");
 const source=read();
 const getToken=async()=>{
   const token=await credentials();
   if(typeof token!=="string"||token.length<20)STOP("TOKEN");
   return token;
 };
 const request=async(method,url,body=null,type="application/json")=>{
   const target=safeUrl(method,url);
   const token=await getToken();
   const opts={method,redirect:"error",headers:{Authorization:"Bearer "+token}};
   if(body!==null){
     opts.headers["Content-Type"]=type;
     opts.body=type==="application/octet-stream"?body:JSON.stringify(body);
   }
   const r=await net(target,opts);
   if(!r?.ok)STOP("HTTP_"+(r?.status??"UNKNOWN"));
   const text=await r.text();
   if(text.length>5000000)STOP("RESPONSE_TOO_LONG");
   try{return text?JSON.parse(text):{}}catch{STOP("NOT_JSON")}
 };
 const result=await prepareOwnerOnOffTwoAssetRelease({
   request,sources:source,release,releaseAuthorized:release,
   log
 });
 return Object.freeze(result);
}
async function main(){
 const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const rc=JSON.parse(readFileSync(path.join(root,".firebaserc"),"utf8"));
 if(rc.projects?.default!==PROJECT)STOP("PROJECT_ID");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credentials=async()=>{
   const token=(await applicationDefault().getAccessToken())?.access_token;
   if(typeof token!=="string")STOP("IDENTITY_TOKEN");
   return token;
 };
 const result=await runOwnerOnOffHosting({credentials});
 console.log("OWNER_ONOFF_STATIC_RESULT "+JSON.stringify(result));
 if(result.released){
   const base="https://nico-factory.web.app";
   for(const pathname of [
      "/owner-product-publication.html",
      "/ranking/owner-product-visibility-dashboard-mount.mjs"
   ]){
     const expected=sourceFiles()[pathname];
     let matched=false;
     for(let attempt=0;attempt<8;attempt++){
       try{
         const r=await fetch(base+pathname+"?verify="+process.env.GITHUB_SHA,{
           method:"GET",redirect:"error",signal:AbortSignal.timeout(15000),
           headers:{"Cache-Control":"no-cache"}
         });
         if(r.ok&&await r.text()===expected){matched=true;break}
       }catch{ /* cache propagation, no write retry */ }
       await new Promise(resolve=>setTimeout(resolve,3000));
     }
     if(!matched)STOP("POST_PUBLISH_BYTE_MISMATCH");
     console.log("OWNER_ONOFF_PUBLIC_ASSET_VERIFIED "+pathname);
   }
   console.log("OWNER_ONOFF_HOSTING_TWO_ASSETS_PUBLISHED_NO_FIRESTORE_CHANGES");
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{
   const safe=/^STOP_OWNER_ONOFF_(EXACT_TWO|ASSETS|HOSTING_PREFLIGHT|TWO_ASSET_RELEASE)_[A-Z0-9_]+$/.test(error?.message||"")
     ?error.message:"STOP_OWNER_ONOFF_EXACT_TWO_UNVERIFIED";
   console.error(safe);process.exitCode=1;
 });
