import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {validateManifest,uploadSingleExistingWorkspace} from "../tools/hosting/surgical-existing-partner-workspace.mjs";
const hash=c=>String(c).repeat(64);
const originals=[
  {path:"/index.html",hash:hash("a")},
  {path:"/partner-invite.html",hash:hash("b")},
  {path:"/partner-counts.html",hash:hash("c")},
  {path:"/partner-workspace.html",hash:hash("d")}
];
test("only existing partner workspace is replaced; all other live files and hashes retained",()=>{
 const {original,next}=validateManifest(originals,new Map([["/partner-workspace.html",hash("e")]]),4);
 assert.equal(next.size,original.size);
 assert.equal(next.get("/partner-workspace.html"),hash("e"));
 for(const [path,sha] of original)if(path!=="/partner-workspace.html")assert.equal(next.get(path),sha);
 assert.equal(next.get("/index.html"),hash("a"));
});
test("stop when workspace is missing, unchanged, count unexpected or additive path attempted",()=>{
 assert.throws(()=>validateManifest(originals,new Map([["/partner-workspace.html",hash("d")]]),4),/NO_WORKSPACE_CHANGE/);
 assert.throws(()=>validateManifest(originals.slice(1),new Map([["/partner-workspace.html",hash("e")]]),3),/LIVE_INDEX_MISSING/);
 assert.throws(()=>validateManifest(originals,new Map([["/partner-workspace.html",hash("e")]]),3),/SOURCE_FILE_COUNT_MISMATCH/);
 assert.throws(()=>validateManifest(originals,new Map([["/foo.html",hash("e")]]),4),/ONLY_ONE_REPLACED_WORKSPACE_ALLOWED/);
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("e")],["/partner-counts.html",hash("f")]]),4),/ONLY_ONE_REPLACED_WORKSPACE_ALLOWED/);
});

function live(version="sites/nico-factory/versions/8a6f3ca799112677",omitCount=true,missing=false) {
 const paths=["/index.html","/partner-invite.html","/partner-counts.html","/partner-workspace.html",
  "/service-worker.js","/manifest.webmanifest","/favicon.ico","/assets/app.js","/assets/theme.css","/icons/app.svg","/robots.txt"];
 const originals=paths.map((p,i)=>({path:p,hash:hash((i%6).toString(16))}));
 if(missing)originals.splice(2,1);
 const seen=[];
 const request=async(method,url)=>{
  seen.push({method,url});
  if(method!=="GET")throw Error("UNEXPECTED_REMOTE_WRITE");
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:version}}]};
  if(url.endsWith("/"+version))
   return {name:version,status:"FINALIZED",config:{headers:[]},
    ...(omitCount?{}:{fileCount:originals.length})};
  if(url.includes("/"+version+"/files?"))return {files:originals};
  throw Error("UNMOCKED "+url);
 };
 return {request,seen};
}
const fakeWorkspace=Buffer.from("getPartnerWorkspace submitPartnerWorkspaceCounts NICO FACTORY".repeat(30));
test("audited 11-file live version missing fileCount is dry-run verifiable without any writes",async()=>{
 const x=live();
 const r=await uploadSingleExistingWorkspace({assetBytes:fakeWorkspace,request:x.request,release:false,log:()=>{}});
 assert.equal(r.released,false);
 assert.equal(r.originalCount,11);
 assert.ok(x.seen.every(s=>s.method==="GET"));
});
test("unreviewed live source missing fileCount is never allowed",async()=>{
 const x=live("sites/nico-factory/versions/unreviewed");
 await assert.rejects(uploadSingleExistingWorkspace({assetBytes:fakeWorkspace,request:x.request,log:()=>{}}),
  /UNREVIEWED_LIVE_VERSION_MISSING_COUNT/);
 assert.ok(x.seen.every(s=>s.method==="GET"));
});
test("known version missing one mandatory partner page is rejected without a release",async()=>{
 const x=live(undefined,true,true);
 await assert.rejects(uploadSingleExistingWorkspace({assetBytes:fakeWorkspace,request:x.request,log:()=>{}}),
  /SOURCE_REQUIRED_FILE_MISSING/);
 assert.ok(x.seen.every(s=>s.method==="GET"));
});

test("latest audited production login release can be read-only inspected before monthly display restore",async()=>{
 const x=live("sites/nico-factory/versions/8a6f3ca799112677",true,false);
 const r=await uploadSingleExistingWorkspace({assetBytes:fakeWorkspace,request:x.request,release:false,log:()=>{}});
 assert.equal(r.released,false);
 assert.equal(r.originalCount,11);
 assert(x.seen.every(a=>a.method==="GET"));
});

test("latest verified invitation-only Hosting version allows read-only 11-file preflight",async()=>{
 const x=live("sites/nico-factory/versions/b46f9f22bf75ed6e",true,false);
 const result=await uploadSingleExistingWorkspace({assetBytes:fakeWorkspace,request:x.request,release:false,log:()=>{}});
 assert.equal(result.originalCount,11);
 assert.equal(result.released,false);
 assert.ok(x.seen.every(a=>a.method==="GET"));
});

const workspaceHtml=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
test("recoverable partner login keeps original Firebase account, offers password reset and switch-account",()=>{
 assert.match(workspaceHtml,/id="resetPassword"/);
 assert.match(workspaceHtml,/id="loginLogout"/);
 assert.match(workspaceHtml,/sendPasswordResetEmail\(auth,email\)/);
 assert.match(workspaceHtml,/await signInWithEmailAndPassword\(auth,/);
 assert.match(workspaceHtml,/button\.setAttribute\("aria-busy","true"\)/);
 assert.match(workspaceHtml,/\$\("loginBox"\)\.hidden=false;\$\("loginLogout"\)\.hidden=!auth\.currentUser/);
 assert.match(workspaceHtml,/\$\("loginBox"\)\.hidden=!!u&&u\.emailVerified/);
 assert.match(workspaceHtml,/\$\("loginLogout"\)\.hidden=!u/);
 assert.doesNotMatch(workspaceHtml,/deleteUser\(|auth\.currentUser\.delete\(/);
 assert.doesNotMatch(workspaceHtml,/firebase-firestore\.js|\bgetFirestore\(/);
});
test("workspace login errors distinguish invalid password from backend membership denial",()=>{
 const source=workspaceHtml.match(/const fail=e=>\{[\s\S]*?\n\};/)?.[0];
 assert.ok(source,"real error mapper must exist");
 const result=code=>runInNewContext(
  '(()=>{let value="";const notice=(message)=>{value=message;};'+source+
  ';fail({code:'+JSON.stringify(code)+'});return value;})()');
 assert.match(result("auth/invalid-credential"),/パスワード/);
 assert.match(result("auth/email-already-in-use"),/登録済み/);
 assert.match(result("functions/permission-denied"),/ログイン済み/);
 assert.match(result("functions/unavailable"),/サービス/);
 assert.doesNotMatch(result("auth/invalid-credential"),/招待期限・入力権限/);
});
