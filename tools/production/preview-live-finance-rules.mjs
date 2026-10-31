#!/usr/bin/env node
/**
 * Read the CURRENT deployed cloud.firestore release and preview the smallest
 * reviewed membership/retention patch in a disposable GitHub Actions checkout.
 *
 * Never deploys rules, writes Firestore data, or changes the deployed release.
 * Every permitted change is bounded to isCompanyMember or a named collection's
 * delete predicate, and all other original live Rules bytes stay untouched.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const PROJECT="sales-management-cc116";
const COLLECTIONS=Object.freeze(["teams","products","records","goals","revenueGoals"]);
const sha=s=>createHash("sha256").update(s.replace(/\r\n/g,"\n").trim()).digest("hex");
const stop=msg=>{throw new Error("LIVE_RULES_SURGICAL_STOP_"+msg);};

function closingBrace(source,opened) {
  let depth=0,quote="",lineComment=false,blockComment=false,escaped=false;
  for(let i=opened;i<source.length;i++){
    const c=source[i],n=source[i+1]||"";
    if(lineComment){if(c==="\n")lineComment=false;continue;}
    if(blockComment){if(c==="*"&&n==="/"){blockComment=false;i++;}continue;}
    if(quote){if(escaped){escaped=false;continue;}if(c==="\\"){escaped=true;continue;}
      if(c===quote)quote="";continue;}
    if(c==="/"&&n==="/"){lineComment=true;i++;continue;}
    if(c==="/"&&n==="*"){blockComment=true;i++;continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if(c==="{")depth++;
    if(c==="}"&&--depth===0)return i+1;
  }
  stop("UNBALANCED_BLOCK");
}
function uniqueBlock(source,re,name){
  const matches=[...source.matchAll(re)];
  if(matches.length!==1)stop("EXPECTED_SINGLE_"+name);
  const m=matches[0],start=m.index,opened=start+m[0].lastIndexOf("{");
  return {start,end:closingBrace(source,opened)};
}
function functionBlock(source,name){
  const re=new RegExp("^[ \\t]*function[ \\t]+"+name+"\\(companyId\\)[ \\t]*\\{","gm");
  return uniqueBlock(source,re,"FUNCTION_"+name);
}
function collectionBlock(source,name){
  const re=new RegExp("^[ \\t]*match[ \\t]+\\/"+name+"\\/\\{[A-Za-z][A-Za-z0-9]*\\}[ \\t]*\\{","gm");
  return uniqueBlock(source,re,"COLLECTION_"+name);
}
function replaceBlock(source,span,newText){
  return source.slice(0,span.start)+newText+source.slice(span.end);
}
export function previewLiveRules(live,reviewed){
  if(typeof live!=="string"||typeof reviewed!=="string"||
    !live.includes("service cloud.firestore")||!reviewed.includes("service cloud.firestore"))
    stop("NOT_FIRESTORE_RULES");
  // Only replace the company membership predicate. Do not replace all rules.
  const expectedFn=functionBlock(reviewed,"isCompanyMember");
  const reviewedFn=reviewed.slice(expectedFn.start,expectedFn.end);
  for(const marker of ["companyKind","accessKind","memberType","activeOrLegacy"]){
    if(!reviewedFn.includes(marker))stop("REVIEWED_GUARD_MISSING_"+marker);
  }
  let candidate=live;
  const oldFn=functionBlock(candidate,"isCompanyMember");
  const originalFn=candidate.slice(oldFn.start,oldFn.end);
  if(!originalFn.includes("verifiedUser()")||
     !originalFn.includes("exists(memberPath(")||
     !originalFn.includes("get(userPath("))
    stop("UNEXPECTED_OLD_MEMBERSHIP_PREDICATE");
  // Require support functions already present in the LIVE rule source.
  for(const fn of ["activeOrLegacy","userPath","memberPath","companyPath"])
    if(!candidate.includes("function "+fn+"("))stop("MISSING_LIVE_HELPER_"+fn);
  const changed=[];
  if(originalFn!==reviewedFn){
    candidate=replaceBlock(candidate,oldFn,reviewedFn);
    changed.push("isCompanyMember");
  }

  for(const name of COLLECTIONS){
    const approved=reviewed.slice(...(()=>{const s=collectionBlock(reviewed,name);return [s.start,s.end]})());
    if(!/allow[ \t]+delete[ \t]*:[ \t]*if[ \t]+false[ \t]*;/.test(approved))
      stop("REVIEWED_RETENTION_MISSING_"+name);
    const span=collectionBlock(candidate,name);
    const original=candidate.slice(span.start,span.end);
    // "allow write" or combined delete grants would override an inserted deny.
    if(/allow[ \t]+write[ \t]*:|allow[ \t]+(?:create|update)[ \t]*,[ \t]*delete[ \t]*:|allow[ \t]+delete[ \t]*,[ \t]*(?:create|update)[ \t]*:/.test(original))
      stop("COMBINED_OR_WRITE_GRANT_"+name);
    const deleted=[...original.matchAll(/^[ \t]*allow[ \t]+delete[ \t]*:[ \t]*if\b[\s\S]*?;/gm)];
    if(deleted.length!==1)stop("EXPECTED_SINGLE_DELETE_RULE_"+name);
    const one=deleted[0],before=one[0];
    const indent=(before.match(/^[ \t]*/)||[""])[0];
    const after=indent+"allow delete: if false;";
    if(before!==after){
      const adjusted=original.slice(0,one.index)+after+original.slice(one.index+before.length);
      candidate=replaceBlock(candidate,span,adjusted);
      changed.push("deny-delete:"+name);
    }
  }
  // Regression safety: idempotence is also tested in separate unit tests.
  return {candidate,changed,liveSha:sha(live),candidateSha:sha(candidate),
    reviewedSha:sha(reviewed),matchesReviewed:sha(candidate)===sha(reviewed)};
}
async function readLiveRules(){
  if(process.env.NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"||
     process.env.FIREBASE_PROJECT_ID!==PROJECT||
     !process.env.GOOGLE_APPLICATION_CREDENTIALS)
    stop("AUDIT_ENV_NOT_APPROVED");
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  const {applicationDefault}=require("firebase-admin/app");
  const {access_token}=await applicationDefault().getAccessToken();
  if(!access_token)stop("NO_READ_TOKEN");
  const root="https://firebaserules.googleapis.com/v1/projects/"+PROJECT;
  const get=async url=>{
    if(!url.startsWith(root+"/"))stop("UNTRUSTED_URL");
    const response=await fetch(url,{headers:{Authorization:"Bearer "+access_token},redirect:"error"});
    if(!response.ok)stop("RULES_READ_HTTP_"+response.status);
    return response.json();
  };
  const release=await get(root+"/releases/cloud.firestore");
  if(!/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/.test(release.rulesetName||""))
    stop("UNEXPECTED_RULESET");
  const set=await get("https://firebaserules.googleapis.com/v1/"+release.rulesetName);
  if(set?.source?.files?.length!==1||
     typeof set.source.files[0]?.content!=="string")
    stop("UNEXPECTED_RULE_FILES");
  return {live:set.source.files[0].content,releaseName:release.rulesetName};
}
async function main(){
  if(process.env.GITHUB_ACTIONS!=="true"||!process.env.RUNNER_TEMP)stop("CI_ONLY");
  if(JSON.parse(readFileSync(".firebaserc","utf8")).projects.default!==PROJECT)
    stop("WRONG_PROJECT");
  const original=readFileSync("firestore.rules","utf8");
  const {live,releaseName}=await readLiveRules();
  const out=previewLiveRules(live,original);
  // The snapshot stays in the disposable runner only, never in public logs.
  writeFileSync(process.env.RUNNER_TEMP+"/nico-original-live-firestore.rules",live,{mode:0o600});
  writeFileSync(process.env.RUNNER_TEMP+"/nico-proposed-live-firestore.rules",out.candidate,{mode:0o600});
  writeFileSync("firestore.rules",out.candidate,{mode:0o600});
  console.log("LIVE_RULES_SNAPSHOT_CAPTURED=true");
  console.log("LIVE_RULES_RELEASE_VERIFIED="+Boolean(releaseName));
  console.log("LIVE_RULES_CHANGESET="+JSON.stringify(out.changed));
  console.log("LIVE_RULES_ORIGINAL_SHA256="+out.liveSha);
  console.log("LIVE_RULES_CANDIDATE_SHA256="+out.candidateSha);
  console.log("LIVE_RULES_MATCHES_REVIEWED="+out.matchesReviewed);
  console.log("LIVE_RULES_NO_DEPLOYMENT=true");
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(e=>{console.error(e.message?.startsWith("LIVE_RULES_SURGICAL_STOP_")?
    e.message:"LIVE_RULES_SURGICAL_STOP_UNEXPECTED");process.exitCode=1;});
}
