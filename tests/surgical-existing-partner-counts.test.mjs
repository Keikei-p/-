import test from "node:test";
import assert from "node:assert/strict";
import {validateManifest,ASSET} from "../tools/hosting/surgical-existing-partner-counts.mjs";
const hash=c=>c.repeat(64);
const original=[
 {path:"/index.html",hash:hash("a")},
 {path:"/partner-invite.html",hash:hash("b")},
 {path:"/partner-workspace.html",hash:hash("c")},
 {path:"/partner-counts.html",hash:hash("d")},
 {path:"/service-worker.js",hash:hash("e")}
];
test("reviewed counts page only can change while entire original Hosting manifest is preserved",()=>{
 assert.equal(ASSET,"/partner-counts.html");
 const {original:before,next}=validateManifest(original,
  new Map([[ASSET,hash("f")]]),original.length);
 assert.equal(next.size,before.size);
 assert.equal(next.get(ASSET),hash("f"));
 for(const [path,checksum] of before)
  if(path!==ASSET)assert.equal(next.get(path),checksum);
});
test("never replace unknown routes, missing pages, identical bytes or altered file counts",()=>{
 assert.throws(()=>validateManifest(original,new Map([[ASSET,hash("d")]]),original.length),/NO_COUNTS_CHANGE/);
 assert.throws(()=>validateManifest(original.slice(0,3),new Map([[ASSET,hash("f")]]),3),/LIVE_PARTNER_COUNTS_MISSING/);
 assert.throws(()=>validateManifest(original,new Map([["/index.html",hash("f")]]),5),/ONLY_ONE_REPLACED_COUNTS_ALLOWED/);
 assert.throws(()=>validateManifest(original,new Map([[ASSET,hash("f")]]),4),/SOURCE_FILE_COUNT_MISMATCH/);
 assert.throws(()=>validateManifest(original,new Map([[ASSET,hash("f")],["/partner-invite.html",hash("f")]]),5),/ONLY_ONE_REPLACED_COUNTS_ALLOWED/);
});
test("count-only page is exclusively authenticated-callable, and no client finance SDK is imported",async()=>{
 const fs=await import("node:fs");
 const html=fs.readFileSync(new URL("../partner-counts.html",import.meta.url),"utf8");
 for(const name of ["submitPartnerQuickCounts","getPartnerQuickCounts","approvePartnerQuickCounts"]){
  assert.ok(html.includes(name));
 }
 assert.doesNotMatch(html,/firebase-firestore\.js|\bgetFirestore\(|\bgetDoc\(|\bgetDocs\(/);
 assert.ok(html.includes('id="approvalSection"'));
 assert.ok(html.includes('id="reportSection"'));
 assert.ok(html.includes('id="ownerSection"'));
});
