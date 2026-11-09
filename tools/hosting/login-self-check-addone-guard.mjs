import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
/**
 * One reviewed public self-service LOGIN STATUS check, additive Hosting only.
 * Existing 18 assets must stay byte/hash identical, no Firebase data writes.
 */
export const SITE="nico-factory";
export const PROJECT="sales-management-cc116";
export const BASE_VERSION="sites/nico-factory/versions/181ccb549d6d3df9";
export const NEW_PATH="/login-self-check.html";
export const NEW_BLOB="a3a3ddd5ab4a87e6e7f120e0d6a5c3619d4e2709";
const HASH=/^[a-f0-9]{64}$/;
const REQUIRED=[
 "/index.html","/partner-invite.html","/partner-workspace.html",
 "/partner-counts.html","/owner-partner-admin.html",
 "/owner-partner-counts-readonly.html","/finance-boundary-check.html"
];
const STOP=code=>{throw Error("STOP_LOGIN_SELF_CHECK_GUARD_"+code)};
export function gitBlob(text){
 const bytes=Buffer.from(text,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
}
export function uploadBytes(text){return gzipSync(Buffer.from(text,"utf8"),{mtime:0})}
export function hostingHash(text){
 return createHash("sha256").update(uploadBytes(text)).digest("hex");
}
export function assertCandidate(source){
 if(typeof source!=="string"||source.length<5000||source.length>18000||
    gitBlob(source)!==NEW_BLOB||
    !source.includes("Firebaseログインは成功していますが、このアカウントは会社側で利用停止中")||
    !source.includes('getDocFromServer(doc(db,"users",user.uid))')||
    !source.includes("signInWithEmailAndPassword")||
    !source.includes("onAuthStateChanged")||
    !source.includes("emailVerified")||
    !source.includes("login-self-check")&&source.includes("href=\"/login-self-check\"")||
    /\b(?:setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|createUserWithEmailAndPassword|createCustomToken|setCustomUserClaims)\s*\(/.test(source)||
    /doc\(db,"(?:companies|members|records|products|revenueGoals|recordCorrections)"/.test(source)||
    /\b(?:localStorage|sessionStorage|firebase deploy)\b/.test(source))
   STOP("CANDIDATE_UNREVIEWED");
 return hostingHash(source);
}
export function assertManifest(list,{expected=18}={}){
 if(!Array.isArray(list)||list.length!==expected)STOP("ASSET_COUNT");
 const map=new Map();
 for(const f of list){
  if(typeof f?.path!=="string"||!f.path.startsWith("/")||
    typeof f.hash!=="string"||!HASH.test(f.hash.toLowerCase())||map.has(f.path))
   STOP("MANIFEST_INVALID");
  map.set(f.path,f.hash.toLowerCase());
 }
 if(map.has(NEW_PATH)||REQUIRED.some(p=>!map.has(p)))STOP("PATH_MISSING_OR_COLLISION");
 return map;
}
export function planLoginSelfCheck({baseVersion,baseFiles,liveFiles,source}={}){
 if(baseVersion!==BASE_VERSION)STOP("BASE_VERSION");
 const base=assertManifest(baseFiles),live=assertManifest(liveFiles);
 if([...base.keys()].some(p=>!live.has(p)))STOP("LIVE_PATH_SET_DRIFT");
 const newHash=assertCandidate(source);
 const next=new Map([...live,[NEW_PATH,newHash]]);
 if(next.size!==19||[...live].some(([p,h])=>next.get(p)!==h))
  STOP("EXISTING_ASSET_MODIFIED");
 return Object.freeze({
  before:live,after:next,newHash,
  oldFilesPreserved:18,newFilesAdded:1,
  newPath:NEW_PATH,bytes:uploadBytes(source),
  financeOriginalsRead:false,firestoreWrites:0,authUpdates:0
 });
}
