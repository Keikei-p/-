import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 BASE_VERSION,NEW_PATH,NEW_BLOB,gitBlob,hostingHash,
 planLoginSelfCheck,assertCandidate
} from "../tools/hosting/login-self-check-addone-guard.mjs";
import {publishLoginSelfCheck} from "../tools/hosting/release-login-self-check-addone.mjs";
const source=readFileSync(new URL("../staging/login-selfcheck-v1/login-self-check.html",import.meta.url),"utf8");
const API="https://firebasehosting.googleapis.com/v1beta1";
const CREATED="sites/nico-factory/versions/login_status_new";
const NEWER="sites/nico-factory/versions/verified_other_current";
const C={headers:[{source:"**",headers:[{key:"X-Important",value:"keep"}]}]};
const ORIGINAL=[
 "/index.html","/partner-workspace.html","/partner-invite.html",
 "/partner-counts.html","/owner-partner-admin.html",
 "/owner-partner-counts-readonly.html","/finance-boundary-check.html",
 "/owner-partner-admin-assets/owner-client.mjs",
 "/owner-partner-admin-assets/owner-ui.mjs",
 "/owner-partner-admin-assets/mobile-bootstrap.mjs",
 ...Array.from({length:8},(_,i)=>"/original-asset-"+i+".js")
];
assert.equal(ORIGINAL.length,18);
function fixture({
 collision=false,missing=false,modifiedExisting=false,configDrift=false,
 concurrent=false,unknownUpload=false,changedFinal=false,releasedBefore=false
}={}){
 const baseline=ORIGINAL.map((path,i)=>({
  path,hash:(i%6+1).toString().repeat(64)
 }));
 const current=baseline.map(x=>({...x}));
 if(collision)current[0].path=NEW_PATH;
 if(missing)current[0].path="/unexpected-file";
 if(modifiedExisting)current[0].hash="f".repeat(64);
 let live=releasedBefore?NEWER:BASE_VERSION;
 let created=false,finalized=false,published=false,writes=[];
 const expected=new Map([...current.map(x=>[x.path,x.hash]),[NEW_PATH,hostingHash(source)]]);
 const request=async(method,url,body=null,type="application/json")=>{
  if(method!=="GET")writes.push({method,url,body:type==="application/octet-stream"?"BINARY":body});
  if(url===API+"/sites/nico-factory/releases?pageSize=1"&&method==="GET"){
   if(concurrent&&created&&!published)live="sites/nico-factory/versions/unreviewed_concurrent";
   return {releases:[{version:{name:live}}]};
  }
  if(method==="GET"&&url===API+"/"+BASE_VERSION)return {
   name:BASE_VERSION,status:"FINALIZED",config:C,fileCount:18
  };
  if(method==="GET"&&url===API+"/"+NEWER)return {
   name:NEWER,status:"FINALIZED",config:configDrift?{rewrites:[]}:C,fileCount:18
  };
  if(method==="GET"&&url===API+"/"+BASE_VERSION+"/files?pageSize=1000")
   return {files:baseline};
  if(method==="GET"&&url===API+"/"+NEWER+"/files?pageSize=1000")
   return {files:current};
  if(method==="POST"&&url===API+"/sites/nico-factory/versions"){
   assert.deepEqual(body,{config:C});
   created=true;
   return {name:CREATED,status:"CREATED"};
  }
  if(method==="POST"&&url===API+"/"+CREATED+":populateFiles"){
   assert.deepEqual(Object.entries(body.files),[...expected]);
   return {
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/login_status_new/files",
    uploadRequiredHashes:[unknownUpload?"f".repeat(64):hostingHash(source)]
   };
  }
  if(method==="POST"&&url==="https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/login_status_new/files/"+hostingHash(source)){
   assert.equal(type,"application/octet-stream");
   assert(Buffer.isBuffer(body));return {};
  }
  if(method==="PATCH"&&url===API+"/"+CREATED+"?update_mask=status"){
   finalized=true;return {name:CREATED,status:"FINALIZED",config:C};
  }
  if(method==="GET"&&url===API+"/"+CREATED+"/files?pageSize=1000"){
   const manifest=[...expected].map(([path,hash])=>({path,hash}));
   if(changedFinal)manifest[0].hash="e".repeat(64);
   return {files:manifest};
  }
  if(method==="GET"&&url===API+"/"+CREATED)
   return {name:CREATED,status:finalized?"FINALIZED":"CREATED",config:C};
  if(method==="POST"&&url===API+"/sites/nico-factory/releases?versionName="+encodeURIComponent(CREATED)){
   assert.equal(finalized,true);
   live=CREATED;published=true;return {version:{name:CREATED}};
  }
  throw Error("UNEXPECTED_REQUEST_"+method+"_"+url);
 };
 return {request,writes,baseline,current,get published(){return published}};
}
test("exact Git blob, reviewed source and 18-to-19 additive manifest",()=>{
 assert.equal(gitBlob(source),NEW_BLOB);
 assert.equal(assertCandidate(source),hostingHash(source));
 const f=fixture();
 const plan=planLoginSelfCheck({
  baseVersion:BASE_VERSION,baseFiles:f.baseline,liveFiles:f.baseline,source
 });
 assert.equal(plan.before.size,18);
 assert.equal(plan.after.size,19);
 assert.equal(plan.after.get(NEW_PATH),hostingHash(source));
 for(const [path,hash] of plan.before)assert.equal(plan.after.get(path),hash);
 assert.equal(plan.firestoreWrites,0);
 assert.equal(plan.authUpdates,0);
});
test("fail closed on changed candidate, missing existing asset, unreviewed target collision",()=>{
 const f=fixture();
 assert.throws(()=>assertCandidate(source+"<script>setDoc()</script>"),/STOP_LOGIN_SELF_CHECK_GUARD_/);
 for(const opts of [{collision:true},{missing:true}]){
  const x=fixture(opts);
  assert.throws(()=>planLoginSelfCheck({
   baseVersion:BASE_VERSION,baseFiles:x.baseline,liveFiles:x.current,source
  }),/STOP_LOGIN_SELF_CHECK_GUARD_/);
 }
});
test("GET-only dry run performs no release or mutation",async()=>{
 const f=fixture();
 const p=await publishLoginSelfCheck({request:f.request,source,release:false});
 assert.equal(p.released,false);
 assert.equal(p.originalAssetsUnchanged,18);
 assert.equal(f.writes.length,0);
});
test("single new HTML is published, all 18 original files and config preserved",async()=>{
 const f=fixture();
 const p=await publishLoginSelfCheck({request:f.request,source,release:true});
 assert.equal(p.released,true);
 assert.equal(p.oldFilesPreserved,18);
 assert.equal(p.newFileCount,1);
 assert.equal(p.firestoreWrites,0);
 assert.equal(f.published,true);
 assert.equal(f.writes.filter(x=>x.url.includes("/releases?versionName=")).length,1);
 assert(f.writes.every(x=>!x.url.includes("/firestore/")&&!x.url.includes("/functions/")));
});
test("a newer 18-file release with one changed original hash stays intact",async()=>{
 const f=fixture({releasedBefore:true,modifiedExisting:true});
 const p=await publishLoginSelfCheck({request:f.request,source,release:true});
 assert.equal(p.released,true);
 const upload=f.writes.find(x=>x.url.includes(":populateFiles"));
 assert.equal(upload.body.files["/index.html"],"f".repeat(64));
});
test("config drift and concurrent release stop BEFORE activation",async()=>{
 for(const options of [
  {releasedBefore:true,configDrift:true},
  {concurrent:true},
  {unknownUpload:true},
  {changedFinal:true}
 ]){
  const f=fixture(options);
  await assert.rejects(publishLoginSelfCheck({request:f.request,source,release:true}),
   /STOP_LOGIN_SELF_CHECK_(?:GUARD|RELEASE)_/);
  assert.equal(f.published,false);
 }
});
test("release implementation never touches financial originals, Auth identities or deploy CLI",()=>{
 const script=readFileSync(new URL("../tools/hosting/release-login-self-check-addone.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(script,/\b(?:setDoc|updateDoc|deleteDoc|runTransaction|setCustomUserClaims|createUser|deleteUser)\s*\(/);
 assert.doesNotMatch(script,/firebase deploy|firebase deploy:|\/firestore\/|\/cloudfunctions\//);
 assert.match(script,/CONCURRENT_RELEASE_BEFORE_PUBLISH/);
 assert.match(script,/APPROVE_SINGLE_READONLY_LOGIN_STATUS_PAGE/);
});
