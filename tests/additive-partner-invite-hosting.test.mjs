import test from "node:test";
import assert from "node:assert/strict";
import {validateManifest,uploadAdditiveInvite,ASSET} from "../tools/hosting/additive-partner-invite.mjs";

const h=s=>s.repeat(64);
const samples=[{path:"/index.html",hash:h("a")},{path:"/service-worker.js",hash:h("b")}];
test("retains each original asset exactly and adds one invite",()=>{
 const {original,next}=validateManifest(samples,new Map([[ASSET,h("c")]]),2);
 assert.equal(original.size,2);assert.equal(next.size,3);
 assert.equal(next.get("/index.html"),h("a"));
 assert.equal(next.get("/service-worker.js"),h("b"));
 assert.equal(next.get(ASSET),h("c"));
});
test("rejects existing invite, missing index, bad count or duplicate source",()=>{
 assert.throws(()=>validateManifest(samples,new Map([[ASSET,h("c")]]),3),/SOURCE_FILE_COUNT/);
 assert.throws(()=>validateManifest([samples[1]],new Map([[ASSET,h("c")]]),1),/LIVE_INDEX/);
 assert.throws(()=>validateManifest([...samples,{path:ASSET,hash:h("d")}],new Map([[ASSET,h("c")]]),3),/EXISTING_PARTNER/);
 assert.throws(()=>validateManifest([samples[0],samples[0]],new Map([[ASSET,h("c")]]),2),/INVALID_SOURCE/);
 assert.throws(()=>validateManifest(samples,new Map([[ASSET,h("c")],["/index.html",h("d")]]),2),/ONLY_ONE/);
});
function mock({mutateLive=false,missingOldBlob=false,configMismatch=false}={}){
 const seen=[];
 let current="sites/nico-factory/versions/111",releaseCount=0;
 const base="https://firebasehosting.googleapis.com/v1beta1";
 const cfg={rewrites:[{glob:"**",destination:"/index.html"}],headers:[{glob:"**",headers:{"cache-control":"no-cache"}}]};
 const request=async(method,url,body)=>{
  seen.push({method,url,body});
  const suffix=url.slice(base.length);
  if(method==="GET"&&suffix==="/sites/nico-factory/releases?pageSize=1"){
   releaseCount++;
   if(mutateLive&&releaseCount>=2)current="sites/nico-factory/versions/999";
   return {releases:[{version:{name:current}}]};
  }
  if(method==="GET"&&suffix==="/sites/nico-factory/versions/111")
   return {name:current,status:"FINALIZED",fileCount:"2",config:cfg};
  if(method==="GET"&&suffix.startsWith("/sites/nico-factory/versions/111/files?"))
   return {files:samples};
  if(method==="POST"&&suffix==="/sites/nico-factory/versions")
   return {name:"sites/nico-factory/versions/222",status:"CREATED"};
  if(method==="POST"&&suffix==="/sites/nico-factory/versions/222:populateFiles")
   return {uploadRequiredHashes:missingOldBlob?[h("a")]:[],
    uploadUrl:"https://upload-firebasehosting.googleapis.com/upload/sites/nico-factory/versions/222/files"};
  if(method==="PATCH"&&suffix.startsWith("/sites/nico-factory/versions/222?"))
   return {name:"sites/nico-factory/versions/222",status:"FINALIZED",fileCount:"3",config:configMismatch?{}:cfg};
  if(method==="POST"&&suffix.startsWith("/sites/nico-factory/releases?"))
   return {name:"sites/nico-factory/releases/777",version:{name:"sites/nico-factory/versions/222"}};
  throw Error("UNMOCKED "+method+" "+url);
 };
 return {request,seen};
}
const asset=Buffer.from("createPartnerCompanyInvitation acceptPartnerCompanyInvitation ".repeat(15));
test("dry-run calls only read endpoints and returns no release",async()=>{
 const x=mock(),r=await uploadAdditiveInvite({assetBytes:asset,request:x.request,log:()=>{}});
 assert.equal(r.released,false);assert.equal(r.originalCount,2);
 assert.ok(x.seen.every(v=>v.method==="GET"));
});
test("additive release cannot mutate original hashes or config",async()=>{
 const x=mock(),r=await uploadAdditiveInvite({assetBytes:asset,request:x.request,release:true,log:()=>{}});
 assert.equal(r.released,true);
 const populate=x.seen.find(x=>x.url.includes(":populateFiles"));
 assert.equal(populate.body.files["/index.html"],h("a"));
 assert.equal(populate.body.files["/service-worker.js"],h("b"));
 assert.ok(typeof populate.body.files[ASSET]==="string");
 assert.equal(x.seen.filter(x=>x.url.includes("/releases?versionName")).length,1);
});
test("fail-closed when existing blobs unavailable or config changes",async()=>{
 for(const flags of [{missingOldBlob:true},{configMismatch:true}]){
  const x=mock(flags);
  await assert.rejects(uploadAdditiveInvite({assetBytes:asset,request:x.request,release:true,log:()=>{}}),/OLD_LIVE_BLOB|CONFIG_CHANGED/);
  assert.ok(!x.seen.some(v=>v.url.includes("/releases?versionName")));
 }
});
test("fail-closed on a concurrent live version change",async()=>{
 const x=mock({mutateLive:true});
 await assert.rejects(uploadAdditiveInvite({assetBytes:asset,request:x.request,release:true,log:()=>{}}),/LIVE_CHANGED/);
 assert.ok(!x.seen.some(v=>v.url.includes("/releases?versionName")));
});


test("CLI accepts --dry-run and fails closed before credentials (regression for live run)",async()=>{
 const {spawnSync}=await import("node:child_process");
 const {fileURLToPath}=await import("node:url");
 const path= fileURLToPath(new URL("../tools/hosting/additive-partner-invite.mjs",import.meta.url));
 const env={...process.env,GOOGLE_APPLICATION_CREDENTIALS:""};
 const dry=spawnSync(process.execPath,[path,"--dry-run"],{encoding:"utf8",env});
 assert.equal(dry.status,1);
 assert.match(dry.stderr,/GOOGLE_APPLICATION_CREDENTIALS_REQUIRED/);
 assert.doesNotMatch(dry.stderr,/UNKNOWN_ARGUMENT/);
 const unknown=spawnSync(process.execPath,[path,"--danger"],{encoding:"utf8",env});
 assert.match(unknown.stderr,/UNKNOWN_ARGUMENT/);
 const live=spawnSync(process.execPath,[path,"--release"],{encoding:"utf8",env:{...env,NICO_PARTNER_RELEASE_CONFIRMATION:""}});
 assert.match(live.stderr,/RELEASE_CONFIRMATION_REQUIRED/);
 const both=spawnSync(process.execPath,[path,"--release","--dry-run"],{encoding:"utf8",env});
 assert.match(both.stderr,/CONFLICTING_FLAGS/);
});


test("one-time recovery only accepts manually confirmed original run, never push or arbitrary retry",async()=>{
 const fs=await import("node:fs");
 const text=fs.readFileSync(new URL("../.github/workflows/nico-partner-approved-recovery-once.yml",import.meta.url),"utf8");
 assert.match(text,/workflow_run:\s*\n\s+workflows:/);
 assert.match(text,/workflow_run\.id == 41080213061/);
 assert.match(text,/workflow_run\.head_sha == 'a135ee56375248b88ee6d02ecdac160a2de83b37'/);
 assert.match(text,/workflow_run\.run_attempt == 2/);
 assert.match(text,/workflow_run\.event == 'workflow_dispatch'/);
 assert.match(text,/workflow_run\.conclusion == 'failure'/);
 assert.match(text,/workflow_run\.actor\.login == 'Keikei-p'/);
 assert.match(text,/workflow run nico-partner-invite-only-release\.yml/);
 assert.match(text,/release_confirmation=CONFIRM_PARTNER_INVITE_ONLY/);
 assert.doesNotMatch(text,/^\s+push:/m);
 assert.doesNotMatch(text,/firebase deploy|firebase firestore|hosting deploy/);
});


test("failed post-create deployment recovery configures cheap cleanup and reuses unchanged 3 Functions",async()=>{
 const fs=await import("node:fs");
 const yaml=fs.readFileSync(new URL("../.github/workflows/nico-partner-invite-only-release.yml",import.meta.url),"utf8");
 assert.match(yaml,/functions:artifacts:setpolicy --days 1 --location asia-northeast1/);
 assert.match(yaml,/git hash-object functions\/index\.js/);
 assert.match(yaml,/dfb4c48ada6fa89a24c898cd4a2f911bcede822f/);
 assert.match(yaml,/4da83f98cd6f033d8ce8bda532aef39859db9c09/);
 assert.match(yaml,/already_deployed='+(present\.length===3/);
 assert.match(yaml,/if: \$\{\{ steps\.existing\.outputs\.already_deployed != 'true' \}\}/);
 assert.match(yaml,/function.*sendMissingReportReminders/i);
 assert.match(yaml,/--only functions:createPartnerCompanyInvitation,functions:previewPartnerCompanyInvitation,functions:acceptPartnerCompanyInvitation/);
 assert.doesNotMatch(yaml,/^\s+push:/m);
 assert.match(yaml,/workflow_dispatch:/);
});
