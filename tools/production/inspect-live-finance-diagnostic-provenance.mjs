#!/usr/bin/env node
/**
 * Static public HTML provenance for the diagnostic page only.
 * No sign-in, no Firebase credentials, no Firestore, no Functions, no writes.
 * Only fixed booleans and Git commit prefixes leave this process.
 */
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=new URL("../../",import.meta.url);
const URL_LIVE="https://nico-factory.web.app/finance-boundary-check.html";
const STOP=x=>{throw Error("STOP_FINANCE_LIVE_HTML_PROVENANCE_"+x);};
const sha=x=>createHash("sha256").update(x,"utf8").digest("hex");
const lines=x=>x.replace(/\r\n/g,"\n").trimEnd().split("\n");
const required=[
 "initializeAuth(app,{persistence:browserSessionPersistence})",
 "signInWithEmailAndPassword(auth,email,password)",
 "getIdToken(true)",
 "mask.fieldPaths",
 "https://firestore.googleapis.com",
 "getPartnerWorkspace",
 "getPartnerQuickCounts",
 "<form id=\"loginForm\">"
];
export function classifyLiveHTMLProvenance(live,reviewed,historical=[]){
 if(typeof live!=="string"||typeof reviewed!=="string"||
    live.length>256000||reviewed.length>256000||reviewed.length<4000||
    !Array.isArray(historical)||historical.length>60)STOP("BAD_INPUT");
 if(historical.some(x=>typeof x?.sha!=="string"||
    !/^[a-f0-9]{40}$/.test(x.sha)||typeof x.html!=="string"))
  STOP("BAD_HISTORICAL_SOURCE");
 const exact=sha(live)===sha(reviewed);
 const match=historical.find(x=>sha(x.html)===sha(live))??null;
 // A fallback SPA can return HTTP 200 for a missing diagnostic route.
 const htmlPage=/^\s*<!doctype html>/i.test(live)&&
  /<html(?:\s|>)/i.test(live)&&/<\/html>\s*$/i.test(live);
 const diagnosticTitle=/<title>\s*NICO｜金額境界 診断専用\s*<\/title>/i.test(live);
 const markers=Object.fromEntries(required.map((s,i)=>[
  "m"+(i+1),live.includes(s)
 ]));
 const missing=Object.values(markers).filter(x=>!x).length;
 const unsafeWriteTokens=["setDoc(","updateDoc(","deleteDoc(","writeBatch(",
  "createUserWithEmailAndPassword(","localStorage.","sessionStorage."];
 const writes=unsafeWriteTokens.filter(x=>live.includes(x)).length;
 const moduleScripts=(live.match(/<script\b[^>]*type=["']module["']/gi)??[]).length;
 // Compare only structural line counts, not raw source, emails, endpoints or API keys.
 const liveLines=lines(live),reviewedLines=lines(reviewed);
 const reviewedSet=new Set(reviewedLines.map(sha));
 const overlap=liveLines.reduce((n,s)=>n+Number(reviewedSet.has(sha(s))),0);
 const sameNormalized=lines(live).join("\n")===lines(reviewed).join("\n");
 const report={
  mode:"PUBLIC_DIAGNOSTIC_HTML_GET_ONLY_NO_AUTH",
  source:"https://nico-factory.web.app/finance-boundary-check.html",
  liveBytes:Buffer.byteLength(live,"utf8"),
  reviewedBytes:Buffer.byteLength(reviewed,"utf8"),
  liveSha256Prefix:sha(live).slice(0,12),
  reviewedSha256Prefix:sha(reviewed).slice(0,12),
  exactReviewedSource:exact,
  sameAfterLineEndingNormalization:sameNormalized,
  historicalExactMatch:match!==null,
  historicalCommitPrefix:match?.sha.slice(0,12)??null,
  historicalVersionsInspected:historical.length,
  looksLikeDiagnosticHtml:htmlPage&&diagnosticTitle,
  hasDedicatedDiagnosticTitle:diagnosticTitle,
  moduleScriptCount:moduleScripts,
  requiredMarkerCount:required.length,
  missingRequiredMarkerCount:missing,
  forbiddenClientWriteMarkers:writes,
  liveLineCount:liveLines.length,
  reviewedLineCount:reviewedLines.length,
  exactReviewedLineOverlaps:overlap,
  publicPageProvenanceVerified:exact||match!==null,
  safeToOverwriteWithoutBaselineReview:false,
  provesFinancialGetListDenied:false,
  provesRealAccountIdentity:false,
  firebaseWrites:0,hostingWrites:0,financeDocumentRequests:0
 };
 return Object.freeze(report);
}
async function main(){
 if(process.argv.length!==2||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main")
  STOP("RUN_CONTEXT_UNVERIFIED");
 const reviewed=readFileSync(new URL("../../finance-boundary-check.html",import.meta.url),"utf8");
 let response;
 try{response=await fetch(URL_LIVE+"?provenance=public-static-only",{
  method:"GET",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000),
  headers:{Accept:"text/html"}
 });}catch{STOP("LIVE_GET_FAILED");}
 if(response.status!==200||!/text\/html/i.test(response.headers.get("content-type")??"")||
    response.url.split("?")[0]!==URL_LIVE)STOP("LIVE_RESPONSE_INVALID");
 const body=await response.text();
 const raw=execFileSync("git",
  ["log","--all","--format=%H","--","finance-boundary-check.html"],
  {cwd:ROOT,maxBuffer:20000,encoding:"utf8"});
 const commits=[...new Set(raw.split(/\s+/).filter(Boolean))].slice(0,60);
 const historical=[];
 for(const shaId of commits){
  if(!/^[a-f0-9]{40}$/.test(shaId))STOP("BAD_HISTORY_ID");
  let html;
  try{html=execFileSync("git",["show",shaId+":finance-boundary-check.html"],
    {cwd:ROOT,maxBuffer:512000,encoding:"utf8"});}
  catch{STOP("HISTORY_READ_FAILED");}
  historical.push({sha:shaId,html});
 }
 const result=classifyLiveHTMLProvenance(body,reviewed,historical);
 console.log("LIVE_FINANCE_HTML_PROVENANCE "+JSON.stringify(result));
 console.log(result.historicalExactMatch?
  "HISTORICAL_DIAGNOSTIC_SOURCE_MATCHED_REVIEW_BEFORE_REPLACE":
  "BLOCK_UNKNOWN_LIVE_DIAGNOSTIC_SOURCE_REQUIRES_REVIEW");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_FINANCE_LIVE_HTML_PROVENANCE_[A-Z_]+$/.test(e?.message??"")?
   e.message:"STOP_FINANCE_LIVE_HTML_PROVENANCE_UNVERIFIED");
  process.exitCode=1;
 });
