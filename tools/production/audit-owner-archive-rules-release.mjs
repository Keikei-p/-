#!/usr/bin/env node
/** GET-only pre/post production Firestore Rules version check.
 * Compare exact deployed source to pinned original, then audited Owner archive.
 * NEVER reads or writes sales documents, users or financial values.
 */
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const PROJECT="sales-management-cc116";
const BEFORE="b77dffcae205a095fda21fa23959b7329802c725";
const AFTER="c3295f67f63102295d074d7729dbcad93d73a42a";
const BASE="https://firebaserules.googleapis.com/v1/";
const prefix="projects/"+PROJECT+"/";
const stop=code=>{throw Error("STOP_OWNER_ARCHIVE_RULES_"+code);};
const validRuleset=x=>typeof x==="string"&&
 new RegExp("^projects/"+PROJECT+"/rulesets/[A-Za-z0-9_-]{1,180}$").test(x);
const original=()=>execFileSync("git",["show",BEFORE+":firestore.rules"],{
 encoding:"utf8",maxBuffer:300000});
const candidate=()=>readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8");

export function verifyScopedArchiveRules(base,proposed) {
 if(typeof base!=="string"||typeof proposed!=="string"||base.length<200||
  proposed.length<200)stop("SOURCE_INPUT");
 const products="match /products/{productId} {";
 const next="match /records/{recordId} {";
 const a=base.indexOf(products),b=base.indexOf(next,a);
 const c=proposed.indexOf(products),d=proposed.indexOf(next,c);
 if(a<0||b<0||c!==a||d<0||
    base.slice(0,a)!==proposed.slice(0,c)||
    base.slice(b)!==proposed.slice(d))stop("NON_PRODUCT_RULES_CHANGED");
 const x=proposed.slice(c,d);
 if(!x.includes("allow delete: if false;")||
    !x.includes("hasOnly(['active', 'updatedAt'])")||
    !x.includes("isCompanyOwner(resource.data.companyId)")||
    !x.includes("isCompanyMaster(resource.data.companyId)"))
    stop("UNREVIEWED_PRODUCT_RULES");
 return true;
}

export async function readDeployedOwnerArchiveRules({get}={}) {
 if(typeof get!=="function")stop("NO_GET");
 const full=BASE+prefix+"releases/cloud.firestore";
 const fallback=BASE+prefix+"releases/cloud.firestore/(default)";
 let release=await get(full);
 if(release?.status===404)release=await get(fallback);
 if(release?.status!==200)stop("LIVE_RELEASE_UNAVAILABLE");
 const rel=await release.json();
 if(!rel||![prefix+"releases/cloud.firestore",
     prefix+"releases/cloud.firestore/(default)"].includes(rel.name)||
    !validRuleset(rel.rulesetName))stop("LIVE_RELEASE_UNKNOWN");
 const rules=await get(BASE+rel.rulesetName);
 if(rules?.status!==200)stop("RULESET_UNAVAILABLE");
 const data=await rules.json();
 const src=data?.source?.files;
 if(data?.name!==rel.rulesetName||!Array.isArray(src)||src.length!==1||
    typeof src[0]?.content!=="string"||src[0].content.length>300000)
    stop("LIVE_SOURCE_UNTRUSTED");
 return src[0].content;
}
export function compareOwnerArchiveRulePhase({phase,live,base,reviewed}={}){
 if(!["--before","--after"].includes(phase))stop("PHASE");
 verifyScopedArchiveRules(base,reviewed);
 if(typeof live!=="string"||live!==(phase==="--before"?base:reviewed))
   stop(phase==="--before"?"LIVE_PREIMAGE_CHANGED":"POSTDEPLOY_RULES_UNVERIFIED");
 return Object.freeze({project:PROJECT,phase,
   deployedRulesVerified:true,nonProductRulesIdentical:true,
   physicalProductDeleteStillDenied:true,productionDocumentWrites:0});
}
async function main() {
 const phase=process.argv[2];
 if(process.argv.length!==3||process.env.GITHUB_ACTIONS!=="true"||
   process.env.GITHUB_REF!=="refs/heads/main"||
   process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
   process.env.FIREBASE_PROJECT_ID!==PROJECT||
   !process.env.GOOGLE_APPLICATION_CREDENTIALS||
   JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"))
     .projects.default!==PROJECT)stop("RUNTIME");
 const git=execFileSync("git",["rev-parse",AFTER+":firestore.rules"],{encoding:"utf8"}).trim();
 const local=execFileSync("git",["hash-object","firestore.rules"],{encoding:"utf8"}).trim();
 if(git!==local)stop("UNREVIEWED_MAIN_RULES");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const credential=applicationDefault();
 const get=async url=>{
  if(!url.startsWith(BASE+prefix))stop("UNREVIEWED_API");
  const token=(await credential.getAccessToken()).access_token;
  return fetch(url,{method:"GET",redirect:"error",
    headers:{Authorization:"Bearer "+token}});
 };
 const live=await readDeployedOwnerArchiveRules({get});
 const result=compareOwnerArchiveRulePhase({
  phase,live,base:original(),reviewed:candidate()
 });
 console.log("NICO_OWNER_ARCHIVE_RULES "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{const m=e?.message||"";
    console.error(/^STOP_OWNER_ARCHIVE_RULES_[A-Z_]+$/.test(m)?m:
      "STOP_OWNER_ARCHIVE_RULES_UNVERIFIED");process.exitCode=1;});
