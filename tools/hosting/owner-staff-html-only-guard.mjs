import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";

/**
 * Offline-only, fail-closed plan for one specific current production HTML.
 * Never changes the four existing Owner portal dependencies or any canonical app.
 */
const STOP=reason=>{throw Error("STOP_OWNER_STAFF_HTML_"+reason)};
const HASH=/^[a-f0-9]{64}$/;
export const SOURCE_VERSION="sites/nico-factory/versions/34842c6a26d62382";
export const TARGET="/owner-partner-admin.html";
const SOURCES=Object.freeze({
 previous:"8ac03f833b27706b256d9218742c343bb3e040ff",
 candidate:"3bcc5a267fd4d33def219ce5ac9799e5f9edf9f4",
 bootstrap:"8533ac6b02f7768189444c9bfb8cc11cea7b28e7",
 client:"3df123912de87d3212c173997465c721f5b9e54e",
 ui:"7c10e98da34339aa26b5fdc0ac89798b57c01016"
});
const depPaths=Object.freeze({
 bootstrap:"/owner-partner-admin-assets/mobile-bootstrap.mjs",
 client:"/owner-partner-admin-assets/owner-client.mjs",
 ui:"/owner-partner-admin-assets/owner-ui.mjs"
});
const canon=Object.freeze([
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/finance-boundary-check.html"
]);
const gitBlob=s=>{
 const b=Buffer.from(s,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+b.length+"\0"))
  .update(b).digest("hex");
};
export const hostingHash=s=>createHash("sha256")
 .update(gzipSync(Buffer.from(s,"utf8"),{mtime:0})).digest("hex");
export function planOwnerStaffHtmlOnly({liveFiles,previous,candidate,bootstrap,client,ui}={}){
 for(const k of ["previous","candidate","bootstrap","client","ui"]){
  const s=({previous,candidate,bootstrap,client,ui})[k];
  if(typeof s!=="string"||s.length<100||s.length>120000||
     gitBlob(s)!==SOURCES[k])STOP("SOURCE_DRIFT_"+k.toUpperCase());
 }
 if(!candidate.includes("const HUB_OWNER_CORRECTION_READY=false")||
    !candidate.includes('listCall({date:day,partnerCompanyId:partnerId})')||
    !candidate.includes("verifiedOwnerStaffCountRows(payload,day,partnerId)")||
    !candidate.includes("currentCompany!==partnerId")||
    !candidate.includes("auth.currentUser!==current")||
    !candidate.includes("containsFinance!==false")||
    !candidate.includes("getAuth(app)")||
    !candidate.includes("未報告を0件として扱いません")||
    !candidate.includes("const categories=Object.keys(ZERO())")||
    !candidate.includes('import {mountVerifiedOwnerCorrection')||
    /\b(?:signInWithEmailAndPassword|createUserWithEmailAndPassword|setDoc|updateDoc|deleteDoc|writeBatch|localStorage|sessionStorage)\s*\(/.test(candidate))
  STOP("SECURITY_CONTRACT");
 if(!Array.isArray(liveFiles)||liveFiles.length!==17)STOP("LIVE_COUNT_DRIFT");
 const originals=new Map();
 for(const item of liveFiles){
  if(typeof item?.path!=="string"||!item.path.startsWith("/")||
     typeof item.hash!=="string"||!HASH.test(item.hash.toLowerCase())||
     originals.has(item.path))STOP("LIVE_FILE_INVALID");
  originals.set(item.path,item.hash.toLowerCase());
 }
 if(canon.some(k=>!originals.has(k)))STOP("CANONICAL_MISSING");
 if(originals.get(TARGET)!==hostingHash(previous))STOP("LIVE_HTML_CHANGED");
 for(const [key,p] of Object.entries(depPaths)){
  if(originals.get(p)!==hostingHash(({bootstrap,client,ui})[key]))
   STOP("DEPENDENCY_CHANGED_"+key.toUpperCase());
 }
 const next=new Map(originals);
 next.set(TARGET,hostingHash(candidate));
 if(next.size!==originals.size||next.get(TARGET)===originals.get(TARGET)||
    [...originals].some(([p,digest])=>
      p!==TARGET&&next.get(p)!==digest))STOP("SCOPE_CHANGED");
 return Object.freeze({
  originalManifest:originals,proposedManifest:next,
  payloads:Object.freeze({[TARGET]:candidate}),
  changedPaths:Object.freeze([TARGET]),
  unchangedFileCount:originals.size-1,
  releaseApproved:false,zeroFirestoreWrites:true
 });
}
