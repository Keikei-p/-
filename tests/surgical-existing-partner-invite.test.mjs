import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateManifest,uploadSingleExistingPartnerInvite}
 from "../tools/hosting/surgical-existing-partner-invite.mjs";
const html=readFileSync(new URL("../partner-invite.html",import.meta.url),"utf8");
const workspace=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const hash=s=>s.repeat(64);
const originals=[
 {path:"/index.html",hash:hash("a")},
 {path:"/partner-invite.html",hash:hash("b")},
 {path:"/partner-counts.html",hash:hash("c")},
 {path:"/partner-workspace.html",hash:hash("d")}
];
test("accepted company owner is guided to live count-only workspace; no money visible",()=>{
 assert.match(html,/href="\/partner-workspace\.html"/);
 assert.match(html,/id="acceptedBox" hidden/);
 assert.match(html,/\$\("acceptedBox"\)\.hidden=false/);
 assert.match(html,/班・スタッフを登録できます/);
 assert.doesNotMatch(html,/件数報告は別の安全確認が終わるまで利用できません|件数報告は管理者の安全確認後に有効になります/);
 assert.match(workspace,/submitPartnerWorkspaceCounts/);
 assert.match(html,/売上・単価は表示しません/);
 assert.doesNotMatch(html,/firebase-firestore\.js|getFirestore\(|\brevenuePerUnit\b|\btotalRevenue\b|\bunitPrice\b/);
});
test("only existing partner invitation may be replaced; preserve index and count pages",()=>{
 const {original,next}=validateManifest(originals,new Map([["/partner-invite.html",hash("e")]]),4);
 assert.equal(next.size,4);
 for(const [file,h] of original){
  assert.equal(next.get(file),file==="/partner-invite.html"?hash("e"):h);
 }
});
test("refuse unchanged, missing, multi-file or unsafe replacement",()=>{
 assert.throws(()=>validateManifest(originals,new Map([["/partner-invite.html",hash("b")]]),4),/NO_INVITE_CHANGE/);
 assert.throws(()=>validateManifest(originals.slice(0,1),new Map([["/partner-invite.html",hash("e")]]),1),/LIVE_PARTNER_INVITE_MISSING/);
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("e")]]),4),/ONLY_ONE_REPLACED_INVITE_ALLOWED/);
 assert.throws(()=>validateManifest(originals,new Map([["/partner-invite.html",hash("e")],["/index.html",hash("e")]]),4),/ONLY_ONE_REPLACED_INVITE_ALLOWED/);
});
test("existing audited 11-asset Hosting manifest is inspected without changing site",async()=>{
 const paths=["/index.html","/partner-invite.html","/partner-counts.html","/partner-workspace.html",
 "/service-worker.js","/manifest.webmanifest","/favicon.ico","/assets/app.js",
 "/assets/theme.css","/icons/app.svg","/robots.txt"];
 const files=paths.map((p,i)=>({path:p,hash:hash((i%6).toString(16))}));
 const version="sites/nico-factory/versions/b0f723150d84c176",seen=[];
 const request=async(method,url)=>{
  seen.push(method);
  assert.equal(method,"GET");
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:version}}]};
  if(url.endsWith("/"+version))return {name:version,status:"FINALIZED",config:{headers:[]}};
  if(url.includes("/"+version+"/files?"))return {files};
  throw Error("UNEXPECTED_REMOTE_READ");
 };
 const assetBytes=Buffer.from(html);
 const out=await uploadSingleExistingPartnerInvite({assetBytes,request,log:()=>{}});
 assert.equal(out.released,false);assert.equal(out.originalCount,11);
 assert(seen.every(x=>x==="GET"));
});
