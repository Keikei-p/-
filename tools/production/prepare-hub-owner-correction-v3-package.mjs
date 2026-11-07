#!/usr/bin/env node
/**
 * NO DEPLOY / NO FIREBASE API / NO LIVE DATA.
 * Produce a strictly reviewed, isolated two-callable Hub Owner correction
 * package into a disposable GitHub Actions runner. This NEVER publishes it.
 */
import {createHash} from "node:crypto";
import {readFileSync,mkdirSync,writeFileSync,rmSync,existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const REVIEWED=Object.freeze({
 "staging/partner-owner-correction-v3/entry.cjs":"309bd57fa808c59ab2cba4e9d7fd10b664f0b626",
 "staging/partner-owner-correction-v3/firebase.owner-correction.json":"2bb289edd33de3a17c2579c2ffbdf1eae0a75417",
 "staging/partner-owner-correction-v3/service.cjs":"a595de15c33c9707342b3721c79e67e2d29a0748",
 "staging/partner-owner-correction-v3/trusted-auth.cjs":"a3e1f03f3e7032024e00109d9211bc34384b9a49",
 "staging/partner-sb-v2/sb-category-v2.cjs":"7f1f7214dd38c6aae3339bab26a8378f1e556f4c",
 "functions-partner-workspace/package.json":"6572599ecac0b8e2b05c166f9e921dc07c0b39f1",
 "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "functions-partner-workspace/index.js":"38da7e9174ffea7c406c92292dccfc651b565eb0",
 "functions-partner-workspace/service.cjs":"b94a6aba231dc2569009580a178297a5b6194bda",
 "firestore.rules":"d9f4df6a2ac0f8b5720534a2461ec66b94379190",
 "index.html":"88ef5636bfe9254e71f2109d452b6d3049f99861",
 "partner-workspace.html":"0930abb188165afea19ef427308ea22fddf636e7"
});
const stop=x=>{throw Error("STOP_OWNER_V3_PACKAGE_"+x)};
export function gitBlob(s){
 const data=Buffer.isBuffer(s)?s:Buffer.from(s,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");
}
export function makeOwnerPackage(files){
 if(!files||typeof files!=="object"||Array.isArray(files))stop("SOURCE_SHAPE");
 for(const [name,digest] of Object.entries(REVIEWED)){
  if(typeof files[name]!=="string"||gitBlob(files[name])!==digest)
   stop("SOURCE_CHANGED");
 }
 const entry=files["staging/partner-owner-correction-v3/entry.cjs"];
 const auth=files["staging/partner-owner-correction-v3/trusted-auth.cjs"];
 const service=files["staging/partner-owner-correction-v3/service.cjs"];
 const helper=files["staging/partner-sb-v2/sb-category-v2.cjs"];
 const originalPkg=JSON.parse(files["functions-partner-workspace/package.json"]);
 const config=JSON.parse(files["staging/partner-owner-correction-v3/firebase.owner-correction.json"]);
 const intendedExports=[
  "listHubPartnerCounts","correctHubPartnerCounts"
 ];
 const found=[...entry.matchAll(/exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)].map(x=>x[1]);
 if(found.length!==2||!intendedExports.every(x=>found.includes(x))||
    config.functions?.source!=="functions-hub-owner-correction"||
    config.functions?.codebase!=="hub-owner-correction-v3"||
    originalPkg.engines?.node!=="22"||
    !entry.includes('HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="enabled"')||
    !entry.includes('minInstances:0')||
    !entry.includes('maxInstances:2')||
    !entry.includes('region:"asia-northeast1"')||
    !entry.includes('cors:["https://nico-factory.web.app"]')||
    !auth.includes('auth.verifyIdToken(bearer,true)')||
    !auth.includes('request?.auth?.uid')||
    !auth.includes('makeHubCountCorrections')||
    !service.includes('tx.create(ar,')||
    !service.includes('ensurePartner(r=>tx.get(r)')||
    !helper.includes("旧未分類"))
   stop("SAFETY_CONTRACT_CHANGED");
 const originalRequire='require("../partner-sb-v2/sb-category-v2.cjs")';
 if(service.split(originalRequire).length!==2)stop("SOURCE_IMPORT_CHANGED");
 const packagedService=service.replace(originalRequire,'require("./sb-category-v2.cjs")');
 const pkg=JSON.stringify({
  ...originalPkg,name:"sales-hub-owner-correction-v3"
 },null,2)+"\n";
 const bundle=Object.freeze({
  "functions-hub-owner-correction/index.js":entry,
  "functions-hub-owner-correction/service.cjs":packagedService,
  "functions-hub-owner-correction/trusted-auth.cjs":auth,
  "functions-hub-owner-correction/sb-category-v2.cjs":helper,
  "functions-hub-owner-correction/package.json":pkg,
  "firebase.owner-correction.json":files["staging/partner-owner-correction-v3/firebase.owner-correction.json"]
 });
 return Object.freeze({
  bundle,report:Object.freeze({
   project:"sales-management-cc116",
   codebase:"hub-owner-correction-v3",
   exports:intendedExports,
   separateFromOriginalFunctions:true,
   stagingSecurityGateDefaultDisabled:true,
   financeSourcePreserved:true,
   productDataWrites:0,productionDataWrites:0,
   deployed:false,realUserVerified:false,financeBoundaryVerified:false
  })
 });
}
export function writeDisposablePackage(prepared,base){
 if(process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    typeof process.env.RUNNER_TEMP!=="string"||
    process.env.RUNNER_TEMP.length<2)stop("RUNNER_ONLY");
 const root=path.resolve(process.env.RUNNER_TEMP);
 const wanted=path.join(root,"nico-reviewed-owner-correction-v3-package");
 if(root==="/"||!path.isAbsolute(root)||base!==wanted||existsSync(base))
  stop("DESTINATION");
 if(!prepared?.bundle||Object.keys(prepared.bundle).length!==6)
  stop("BUNDLE");
 const allowed=new Set([
  "functions-hub-owner-correction/index.js",
  "functions-hub-owner-correction/service.cjs",
  "functions-hub-owner-correction/trusted-auth.cjs",
  "functions-hub-owner-correction/sb-category-v2.cjs",
  "functions-hub-owner-correction/package.json",
  "firebase.owner-correction.json"
 ]);
 try{
  mkdirSync(base,{mode:0o700});
  mkdirSync(path.join(base,"functions-hub-owner-correction"),{mode:0o700});
  for(const [name,data] of Object.entries(prepared.bundle)){
   if(!allowed.has(name)||typeof data!=="string")stop("BUNDLE_PATH");
   writeFileSync(path.join(base,name),data,{encoding:"utf8",mode:0o600,flag:"wx"});
  }
 }catch(e){rmSync(base,{recursive:true,force:true});throw e}
 return Object.freeze([...allowed]);
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--prepare")
  stop("PREPARE_ONLY");
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
 const files={};
 for(const name of Object.keys(REVIEWED)){
  const loc=path.resolve(base,name);
  if(!loc.startsWith(base+path.sep))stop("SOURCE_PATH");
  files[name]=readFileSync(loc,"utf8");
 }
 const ready=makeOwnerPackage(files);
 const dest=path.join(process.env.RUNNER_TEMP||"",
  "nico-reviewed-owner-correction-v3-package");
 writeDisposablePackage(ready,dest);
 console.log("OWNER_V3_PACKAGE_READY_NO_DEPLOY "+JSON.stringify(ready.report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_OWNER_V3_PACKAGE_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_V3_PACKAGE_UNVERIFIED");
  process.exitCode=1;
 });
}
