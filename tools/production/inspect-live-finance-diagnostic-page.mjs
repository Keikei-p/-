#!/usr/bin/env node
/**
 * Read-only verification of the exact production diagnostic webpage.
 * Does not authenticate, visit Firestore, invoke Functions, or echo HTML.
 */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";

export const ORIGIN="https://nico-factory.web.app";
export const ROUTE="/finance-boundary-check.html";
const STOP=x=>{throw Error("STOP_LIVE_DIAGNOSTIC_"+x);};
const sha=x=>createHash("sha256").update(x,"utf8").digest("hex");
export function classifyLiveDiagnostic({status,contentType,body,reviewed}){
 if(typeof reviewed!=="string"||reviewed.length<2000||
    typeof body!=="string"||body.length>256000||
    typeof contentType!=="string"||!Number.isSafeInteger(status))STOP("INVALID_RESPONSE");
 const ok=status===200&&/^text\/html(?:;|$)/i.test(contentType);
 const matches=ok&&sha(body)===sha(reviewed);
 const required=["finance-boundary-check.html","getIdToken(true)","mask.fieldPaths",
  "getPartnerWorkspace","initializeAuth(app,{persistence:browserSessionPersistence})",
  "signInWithEmailAndPassword(auth,email,password)"];
 // Only a byte-for-byte copy of the reviewed page can certify a safe LIVE
 // diagnostic. Never call a generic 200 SPA fallback deployed.
 const reviewedSafe=required.slice(1).every(x=>reviewed.includes(x))&&
  !/\b(?:setDoc|updateDoc|deleteDoc|writeBatch|localStorage|sessionStorage)\s*\(/.test(reviewed);
 const codeSafe=matches&&reviewedSafe;
 return Object.freeze({
  mode:"PUBLIC_HTML_GET_ONLY",
  liveHttpStatus:status,
  liveReturnedHtml:ok,
  exactReviewedDiagnosticHtmlDeployed:codeSafe,
  liveHtmlDifferentFromReviewedSource:ok&&!matches,
  liveDiagnosticNotFound:status===404,
  financialDocumentRequests:0,
  authenticationRequests:0,
  productionWrites:0,
  rulesChanges:0,
  hostingDeploys:0,
  safeToUseForRealUserReadOnlyPreflight:codeSafe,
  proofOfRealUserFinancialDenial:false,
  proofOfCountSaveOrCorrection:false
 });
}
async function main(){
 if(process.argv.length!==2||
   process.env.GITHUB_ACTIONS!=="true"||
   process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
   process.env.GITHUB_REF!=="refs/heads/main")STOP("MAIN_ONLY");
 const reviewed=readFileSync(new URL("../../finance-boundary-check.html",import.meta.url),"utf8");
 let response;
 try{response=await fetch(ORIGIN+ROUTE+"?audit=source-only",{
  method:"GET",redirect:"error",cache:"no-store",
  signal:AbortSignal.timeout(25000),
  headers:{Accept:"text/html"}
 });}catch{STOP("HTTPS_GET_FAILED");}
 if(response.url.split("?")[0]!==ORIGIN+ROUTE)STOP("REDIRECT_OR_ORIGIN");
 let body;
 try{body=await response.text();}catch{STOP("BODY_UNAVAILABLE");}
 const result=classifyLiveDiagnostic({
  status:response.status,
  contentType:response.headers.get("content-type")??"",
  body,reviewed
 });
 console.log("LIVE_FINANCE_DIAGNOSTIC_SAFETY "+JSON.stringify(result));
 console.log(result.safeToUseForRealUserReadOnlyPreflight?
  "EXACT_REVIEWED_FINANCE_DIAGNOSTIC_URL_AVAILABLE":
  "BLOCK_FINANCE_DIAGNOSTIC_LIVE_PARITY_OR_AVAILABILITY");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{
  console.error(/^STOP_LIVE_DIAGNOSTIC_[A-Z_]+$/.test(error?.message??"")?
   error.message:"STOP_LIVE_DIAGNOSTIC_UNKNOWN");
  process.exitCode=1;
 });
