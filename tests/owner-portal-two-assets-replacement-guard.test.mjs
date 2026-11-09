import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {
 planTwoAssetOwnerPortalReplacement,PROTECTED_ASSET_PATHS
} from "../tools/hosting/owner-portal-two-assets-replacement-guard.mjs";

const root=new URL("../",import.meta.url);
const previous={
 html:"staging/hub-owner-management/owner-partner-admin.html",
 bootstrap:"staging/partner-owner-correction-v3/mobile-bootstrap.mjs",
 client:"staging/partner-owner-correction-v3/owner-client.mjs",
 ui:"staging/partner-owner-correction-v3/owner-ui.mjs"
};
const candidate={
 html:"staging/owner-workspace-errors-v1/owner-partner-admin.html",
 bootstrap:"staging/owner-workspace-errors-v1/mobile-bootstrap.mjs",
 client:"staging/owner-workspace-errors-v1/owner-client.mjs",
 ui:"staging/owner-workspace-errors-v1/owner-ui.mjs"
};
const materialize=paths=>Object.fromEntries(Object.entries(paths).map(
 ([key,path])=>[key,readFileSync(new URL("../"+path,import.meta.url),"utf8")]
));
const old=materialize(previous),next=materialize(candidate);
const hash=x=>createHash("sha256")
 .update(gzipSync(Buffer.from(x,"utf8"),{mtime:0})).digest("hex");
const live=()=>{
 const rows=[
  "/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/finance-boundary-check.html",
  "/script.js","/style.css","/service-worker.js"
 ].map((path,i)=>({path,hash:String(i+1).repeat(64)}));
 for(const [key,path] of Object.entries(PROTECTED_ASSET_PATHS))
  rows.push({path,hash:hash(old[key])});
 return rows;
};
const plan=(files=live(),before=old,after=next)=>
 planTwoAssetOwnerPortalReplacement({liveFiles:files,previous:before,candidate:after});

test("live original Hosting manifest -> exactly two diagnostic assets change, everything else byte-hash preserved",()=>{
 const v=plan(),changes=new Set(v.changedPaths);
 assert.equal(v.status,"REVIEWED_OFFLINE_ONLY");
 assert.equal(v.releaseApproved,false);
 assert.equal(v.changedPaths.length,2);
 assert(changes.has("/owner-partner-admin.html"));
 assert(changes.has("/owner-partner-admin-assets/mobile-bootstrap.mjs"));
 assert.equal(v.originalManifest.size,v.proposedManifest.size);
 assert.equal(v.hostedOriginalFilesPreserved,live().length-2);
 for(const [path,digest] of v.originalManifest){
  if(!changes.has(path))assert.equal(v.proposedManifest.get(path),digest,path);
 }
 assert.equal(v.proposedManifest.get("/owner-partner-admin.html"),hash(next.html));
 assert.equal(v.proposedManifest.get("/owner-partner-admin-assets/mobile-bootstrap.mjs"),hash(next.bootstrap));
 assert.equal(v.payloads["/owner-partner-admin.html"],next.html);
 assert.equal(v.payloads["/owner-partner-admin-assets/mobile-bootstrap.mjs"],next.bootstrap);
});
test("preflight fails for existing live portal drift before creating a replacement plan",()=>{
 for(const key of ["html","bootstrap","client","ui"]){
  const rows=live();
  const file=rows.find(row=>row.path===PROTECTED_ASSET_PATHS[key]);
  file.hash="f".repeat(64);
  assert.throws(()=>plan(rows),/STOP_OWNER_PORTAL_TWO_ASSETS_LIVE_SOURCE_DRIFT/);
 }
});
test("missing, malformed, duplicated or truncated live inventory is blocked",()=>{
 for(const sample of [
  live().filter(x=>x.path!=="/index.html"),
  live().filter(x=>x.path!=="/owner-partner-admin.html"),
  [...live(),live()[0]],
  live().map((x,i)=>i===0?{...x,hash:"INVALID"}:x),
  live().slice(0,4),
  "wrong",
  []
 ]){
  assert.throws(()=>plan(sample),/STOP_OWNER_PORTAL_TWO_ASSETS_/);
 }
});
test("unexpected source modifications, reintroduced account impersonation or correction enable stop",()=>{
 for(const [key,suffix] of [
  ["html","\nconst HUB_OWNER_CORRECTION_READY=true;"],
  ["html","\nsignInWithEmailAndPassword(auth,'x','y')"],
  ["bootstrap","\nexport const revenue=100000;"],
  ["client","\nexport const leakedSecret='bad';"],
  ["ui","\nexport const newUI=true;"]
 ]){
  const altered={...next,[key]:next[key]+suffix};
  assert.throws(()=>plan(live(),old,altered),/STOP_OWNER_PORTAL_TWO_ASSETS_/);
 }
 assert.match(next.html,/const HUB_OWNER_CORRECTION_READY=false/);
});
test("immutable original review assets and candidate dependency bundle cannot be silently changed",()=>{
 const altered={...old,html:old.html+"\n"};
 assert.throws(()=>plan(live(),altered,next),/STOP_OWNER_PORTAL_TWO_ASSETS_SOURCE_HASH/);
 assert.equal(next.client,old.client);
 assert.equal(next.ui,old.ui);
});
test("guard is a pure offline comparison: no Firebase credentials, writes or deploy calls",()=>{
 const source=readFileSync(new URL("../tools/hosting/owner-portal-two-assets-replacement-guard.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/fetch\(|httpsCallable|setDoc\(|updateDoc\(|deleteDoc\(|\bexecSync\(|process\.env\.|FIREBASE_SERVICE_ACCOUNT_JSON/);
});
