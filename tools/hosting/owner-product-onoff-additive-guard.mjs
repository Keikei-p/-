/** 
 * OFFLINE ONLY. Prepare the complete five-asset Owner product ON/OFF page.
 * This module NEVER calls Firebase, deploys, changes Rules or reads Auth.
 * Existing live Hosting files must be copied byte-identically by a separately
 * approved release operator; a collision with unknown bytes is a hard STOP.
 */
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";

export const ONOFF_ASSETS=Object.freeze({
 "/owner-product-publication.html":"3ef6050e76343632fec17630b69bcb8b0b64ad48",
 "/ranking/owner-product-visibility-dashboard-mount.mjs":"d606cdf258f0a53c4b9295e009b567b475badf31",
 "/ranking/owner-product-visibility-firebase-bridge.mjs":"1ade778691c27e9517d04cc69d3093af87af46fd",
 "/ranking/owner-product-visibility-panel.mjs":"3721c8cdf2b826a0db848f4ce4d49ca946bf0c25",
 "/ranking/owner-product-visibility-panel.css":"c4ac92aef2418396e0a7a254da489d62794dde62"
});
const REQUIRED=Object.freeze(["/index.html","/partner-workspace.html"]);
const HEX=/^[a-f0-9]{64}$/;
const abort=code=>{throw Error("STOP_OWNER_ONOFF_ASSETS_"+code);};
export function sourceGitBlob(content){
 if(typeof content!=="string")abort("SOURCE_TYPE");
 const bytes=Buffer.from(content,"utf8");
 return createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
}
export function hostingAssetHash(content){
 if(typeof content!=="string")abort("SOURCE_TYPE");
 return createHash("sha256").update(gzipSync(Buffer.from(content,"utf8"),{mtime:0})).digest("hex");
}
function exactObjectKeys(obj,keys){
 return obj&&typeof obj==="object"&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&
  keys.every(key=>Object.hasOwn(obj,key)&&typeof obj[key]==="string");
}
/**
 * Only a verified, immutable 5-file bundle can be proposed. Reads no cloud
 * data. A true production operator needs independent approval, live Hosting
 * version checks, fail-closed Firebase Auth/finance proof, and rollback.
 */
export function planOwnerOnOffAssets({liveFiles,sources}={}){
 const paths=Object.keys(ONOFF_ASSETS);
 if(!exactObjectKeys(sources,paths))abort("INCOMPLETE_BUNDLE");
 for(const path of paths){
  const bytes=sources[path];
  if(bytes.length<100||bytes.length>100000||
     sourceGitBlob(bytes)!==ONOFF_ASSETS[path])abort("UNREVIEWED_SOURCE");
 }
 const html=sources[paths[0]],mount=sources[paths[1]];
 if(!html.includes('href="./ranking/owner-product-visibility-panel.css"')||
    !html.includes('from "./ranking/owner-product-visibility-dashboard-mount.mjs"')||
    !mount.includes('from "./owner-product-visibility-firebase-bridge.mjs"')||
    !mount.includes('from "./owner-product-visibility-panel.mjs"')||
    !html.includes("mountOwnerProductVisibilityDashboard")||
    !html.includes("onAuthStateChanged"))abort("INCOMPLETE_IMPORT_CLOSURE");
 if(!Array.isArray(liveFiles)||liveFiles.length<2||
    liveFiles.length>30000)abort("LIVE_MANIFEST_BOUNDS");
 const before=new Map();
 for(const row of liveFiles){
  if(!row||typeof row.path!=="string"||
     !/^\/[A-Za-z0-9._\/-]+$/.test(row.path)||
     row.path.includes("..")||typeof row.hash!=="string"||
     !HEX.test(row.hash.toLowerCase())||before.has(row.path))
    abort("LIVE_MANIFEST_INVALID");
  before.set(row.path,row.hash.toLowerCase());
 }
 if(REQUIRED.some(p=>!before.has(p)))abort("CANONICAL_PAGE_MISSING");
 const after=new Map(before),added=[];
 for(const path of paths){
  const hash=hostingAssetHash(sources[path]);
  if(before.has(path)){
   if(before.get(path)!==hash)abort("LIVE_ASSET_COLLISION");
  }else{after.set(path,hash);added.push(path);}
 }
 if(after.size!==before.size+added.length||
    [...before].some(([p,h])=>after.get(p)!==h))
   abort("EXISTING_ASSET_CHANGED");
 return Object.freeze({
  status:added.length?"REVIEWED_OFFLINE_ADD_ONLY":"ALREADY_IDENTICAL",
  existingAssetsPreserved:before.size,
  newAssetPaths:Object.freeze(added),
  originalManifest:before,
  proposedManifest:after,
  rulesOrFunctionsChanged:false,
  hostingReleaseApproved:false,
  remoteRequests:0,
  firestoreWrites:0
 });
}
