/**
 * Immutable additive Owner setup website release plan.
 * All existing Firebase Hosting assets and the full Hosting config are copied
 * from the latest live version without modifying or replacing any old path.
 */
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
export const SITE="nico-factory";
export const PROJECT="sales-management-cc116";
export const SOURCES=Object.freeze({
 "owner-partner-setup.html":"3d497bae89bdb016f9df3ac09eea9dbcc1802126",
 "ranking/owner-partner-setup-mount.mjs":"359d46320482086036149d9ec62dda92550a0e01",
 "ranking/owner-ranking-consent-firebase-bridge.mjs":"02c902ef177825f3c4a74218114e530aa53b024c",
 "ranking/owner-ranking-consent-panel.mjs":"76500729c3e91941c63d81684e80849a4d46924d",
 "ranking/owner-product-visibility-firebase-bridge.mjs":"1ade778691c27e9517d04cc69d3093af87af46fd",
 "ranking/owner-product-visibility-panel.mjs":"3721c8cdf2b826a0db848f4ce4d49ca946bf0c25",
 "ranking/owner-reviewed-sku-mapping-firebase-bridge.mjs":"43cb9c153e66eba76b2dc0e1803d634482d45b04",
 "ranking/owner-reviewed-sku-mapping-panel.mjs":"4ac72101bd96685142aef7e6e3a92b151056f9c9",
 "ranking/owner-ranking-consent-panel.css":"d7de6744acdcf475f946874dcbfcf3714f08b385",
 "ranking/owner-product-visibility-panel.css":"c4ac92aef2418396e0a7a254da489d62794dde62",
 "ranking/owner-reviewed-sku-mapping-panel.css":"7da005c5f7ea20748663ab00c9c5e745e7a4cf3e"
});
const EXISTING=Object.freeze([
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/owner-partner-admin.html"
]);
const STOP=x=>{throw Error("STOP_OWNER_SETUP_HOSTING_"+x);};
export function blobSha(data){
 if(typeof data!=="string")STOP("SOURCE_NOT_UTF8");
 const bytes=Buffer.from(data,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0"))
  .update(bytes).digest("hex");
}
export function uploadBytes(data){
 return gzipSync(Buffer.from(data,"utf8"),{mtime:0});
}
export function uploadSha(data){
 return createHash("sha256").update(uploadBytes(data)).digest("hex");
}
export function prepareOwnerSetupAdditive({oldFiles,sources}={}){
 if(!sources||typeof sources!=="object"||Array.isArray(sources)||
    Object.keys(sources).length!==Object.keys(SOURCES).length||
    !Object.keys(SOURCES).every(k=>Object.hasOwn(sources,k)))
  STOP("SOURCE_SET_MISMATCH");
 if(!Array.isArray(oldFiles)||oldFiles.length<EXISTING.length||
    oldFiles.length>20000)STOP("LIVE_MANIFEST_SIZE");
 const existing=new Map();
 for(const f of oldFiles){
  if(typeof f?.path!=="string"||!f.path.startsWith("/")||
     !/^\/[A-Za-z0-9./_-]{1,300}$/.test(f.path)||
     typeof f.hash!=="string"||!/^[a-f0-9]{64}$/i.test(f.hash)||
     existing.has(f.path))STOP("LIVE_MANIFEST_INVALID");
  existing.set(f.path,f.hash.toLowerCase());
 }
 if(EXISTING.some(p=>!existing.has(p)))STOP("EXISTING_CANONICAL_MISSING");
 const additions=new Map(),uploaded=new Map();
 for(const [source,pin] of Object.entries(SOURCES)){
  const value=sources[source],path="/"+source;
  if(typeof value!=="string"||value.length<50||
     value.length>150000||blobSha(value)!==pin)STOP("SOURCE_REVIEW_PIN_MISMATCH");
  if(existing.has(path))STOP("ADDITIVE_PATH_ALREADY_EXISTS");
  if(/firebase-firestore|(?:getFirestore|getDocs|setDoc|updateDoc|writeBatch|runTransaction)\s*\(/i.test(value))
   STOP("UNREVIEWED_DIRECT_FIRESTORE_ACCESS");
  if(source==="owner-partner-setup.html"&&
    (!value.includes('projectId:"sales-management-cc116"')||
     !value.includes("mountOwnerPartnerSetup")||
     !value.includes("onAuthStateChanged")||
     !value.includes('getFunctions(app,"asia-northeast1")')))
   STOP("OWNER_AUTH_ENTRY_MISSING");
  if(source.endsWith(".mjs")&&
     !value.includes("export ")&&!value.includes("import "))
   STOP("JAVASCRIPT_MODULE_INVALID");
  const bytes=uploadBytes(value),hash=uploadSha(value);
  additions.set(path,hash);
  uploaded.set(hash,bytes);
 }
 if(additions.size!==11||uploaded.size!==11)STOP("UNEXPECTED_ADDITIONS");
 const manifest=new Map([...existing,...additions]);
 if(manifest.size!==existing.size+11||
    [...existing].some(([path,hash])=>manifest.get(path)!==hash))
   STOP("EXISTING_ASSET_CHANGED");
 return Object.freeze({
  sourceFiles:existing.size,additions:11,
  existingAssetsPreserved:true,configChangeRequired:false,
  originalManifest:existing,proposedManifest:manifest,
  payloads:uploaded,addedPaths:[...additions.keys()]
 });
}
