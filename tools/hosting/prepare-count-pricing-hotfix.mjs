/**
 * Build an unapproved index-only candidate from the actual live HTML.
 * No credentials, Firebase API, deployment, database writes or price migration.
 */
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const BASE_COMMIT="1f75da8c9fdc7a997089d962b7fa12f974fc70c4";
export const BASE_BLOB="88ef5636bfe9254e71f2109d452b6d3049f99861";
export const LIVE_SOURCE_COMMIT="455a5bb852e87ecae39b37d39c981043fdd6845f";
export const LIVE_BLOB="6478197c52cd3a9fd6570e7214ed744e3ac93576";
export const LIVE_VERSION="sites/nico-factory/versions/6cd0ef86037773c1";
export const CHANGED_FUNCTIONS=Object.freeze([
 "buildProductInputGroups","verifyNewRecordPricing","verifyChangedRecordPricing"
]);
export const gitBlob=s=>createHash("sha1").update("blob "+Buffer.byteLength(s)+"\0").update(s).digest("hex");
const stop=code=>{throw Error("STOP_COUNT_PRICING_HOTFIX_"+code)};
export function functionBody(source,name){
 const marker="function "+name+"(";
 if(typeof source!=="string"||source.split(marker).length!==2)stop("FUNCTION_NOT_UNIQUE");
 const start=source.indexOf(marker),end=source.indexOf("\n}",start);
 if(start<0||end<=start)stop("FUNCTION_BOUNDARY");
 return source.slice(start,end+2);
}
function replaceOnce(source,before,after){
 if(source.split(before).length!==2)stop("FUNCTION_SOURCE_DRIFT");
 return source.replace(before,after);
}
export function prepareCountPricingHotfix({live,base,candidate}={}){
 if(typeof live!=="string"||typeof base!=="string"||typeof candidate!=="string")stop("SOURCE_SHAPE");
 base=base.replace(/\r\n/g,"\n");candidate=candidate.replace(/\r\n/g,"\n");
 if(gitBlob(base)!==BASE_BLOB)stop("MAIN_BASE_CHANGED");
 if(gitBlob(live)!==LIVE_BLOB)stop("LIVE_HTML_CHANGED");
 let restored=candidate,asset=live;
 const before={},after={};
 for(const name of CHANGED_FUNCTIONS){
  before[name]=functionBody(base,name);after[name]=functionBody(candidate,name);
  if(functionBody(live,name)!==before[name])stop("LIVE_FUNCTION_CHANGED");
  if(before[name]===after[name])stop("EXPECTED_FIX_MISSING");
  restored=replaceOnce(restored,after[name],before[name]);
  asset=replaceOnce(asset,before[name],after[name]);
 }
 if(gitBlob(restored)!==BASE_BLOB)stop("UNRELATED_INDEX_CHANGE");
 let inverse=asset;
 for(const name of CHANGED_FUNCTIONS)inverse=replaceOnce(inverse,after[name],before[name]);
 if(inverse!==live||gitBlob(inverse)!==LIVE_BLOB)stop("LIVE_INVERSE_MISMATCH");
 return Object.freeze({asset,report:Object.freeze({
  kind:"unapproved-live-index-pricing-hotfix-v1",baseCommit:BASE_COMMIT,
  baseBlob:BASE_BLOB,sourceLiveCommit:LIVE_SOURCE_COMMIT,sourceLiveBlob:LIVE_BLOB,sourceVersion:LIVE_VERSION,
  candidateSourceBlob:gitBlob(candidate),assetBlob:gitBlob(asset),
  assetSha256:createHash("sha256").update(asset).digest("hex"),
  changedFunctions:CHANGED_FUNCTIONS,restoresExactLiveBlob:true,
  dataWrites:0,deployed:false,productionReleaseApproved:false
 })});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,output]=process.argv.slice(2);
  if(mode!=="--prepare"||!output||process.argv.length!==4)stop("PREPARE_ONLY");
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const base=execFileSync("git",["show",BASE_COMMIT+":index.html"],{cwd:root,encoding:"utf8",maxBuffer:3000000});
  const candidate=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
  const response=await fetch("https://nico-factory.web.app/index.html",{redirect:"error",cache:"no-store"});
  if(response.status!==200)stop("LIVE_HTTP");
  const result=prepareCountPricingHotfix({live:await response.text(),base,candidate});
  writeFileSync(output,result.asset,{encoding:"utf8",flag:"wx"});
  console.log(JSON.stringify(result.report));
 }catch(e){
  console.error(/^STOP_COUNT_PRICING_HOTFIX_[A-Z_]+$/.test(e?.message||"")?e.message:"STOP_COUNT_PRICING_HOTFIX_UNVERIFIED");
  process.exitCode=1;
 }
}
