import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const branch="integration/nico-sales-count-publication-rank-ready-20261113";
const releaseKeys=["GOOGLE_APPLICATION_CREDENTIALS","FIREBASE_SERVICE_ACCOUNT_JSON",
 "FIREBASE_TOKEN","NICO_RULES_APPROVAL","NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED",
 "NICO_PARTNER_SHARED_RANKING_ENABLED","NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED",
 "NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED","NICO_JOINT_COUNT_RANKING_ENABLED",
 "HUB_OWNER_COUNT_CORRECTION_V3_ENABLED"];
function run({env:overrides={},changeEvent=()=>{},args=[]}={}){
 const folder=mkdtempSync(path.join(tmpdir(),"nico-offline-704-"));
 const event={pull_request:{number:704,head:{ref:branch,repo:{full_name:"Keikei-p/-"}},
  base:{repo:{full_name:"Keikei-p/-"}}}};
 changeEvent(event);
 const eventPath=path.join(folder,"event.json");
 writeFileSync(eventPath,JSON.stringify(event));
 const env={...process.env,GITHUB_EVENT_NAME:"pull_request",GITHUB_REPOSITORY:"Keikei-p/-",
  GITHUB_HEAD_REF:branch,GITHUB_EVENT_PATH:eventPath};
 for(const key of releaseKeys)delete env[key];
 try{return spawnSync(process.execPath,["scripts/ci/review-integrated-count-candidate.cjs",
  "--sources-only",...args],{cwd:root,env:{...env,...overrides},encoding:"utf8"});
 }finally{rmSync(folder,{recursive:true,force:true});}
}
test("exact PR #704 sources can be checked offline without release approval",()=>{
 const result=run();
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/EXACT_704_OFFLINE_SOURCES_VERIFIED_NO_APPROVAL_NO_DEPLOY/);
});
test("dispatch, main push, unrelated PRs, branches and forks cannot reuse candidate review",()=>{
 for(const options of [
  {env:{GITHUB_EVENT_NAME:"workflow_dispatch"}},
  {env:{GITHUB_EVENT_NAME:"push",GITHUB_REF:"refs/heads/main"}},
  {env:{GITHUB_REPOSITORY:"another/repo"}},
  {env:{GITHUB_HEAD_REF:"another-branch"}},
  {changeEvent:e=>{e.pull_request.number=705;}},
  {changeEvent:e=>{e.pull_request.head.ref="another-branch";}},
  {changeEvent:e=>{e.pull_request.head.repo.full_name="another/repo";}},
  {changeEvent:e=>{e.pull_request.base.repo.full_name="another/repo";}},
  {args:["--apply"]}
 ]){
  const result=run(options);
  assert.notEqual(result.status,0,"unrelated review context must fail closed");
  assert.doesNotMatch(result.stdout,/EXACT_704_OFFLINE_SOURCES_VERIFIED/);
 }
});
test("live credentials and every publication flag stop before source review",()=>{
 for(const key of releaseKeys){
  const result=run({env:{[key]:"synthetic-rejected-value"}});
  assert.notEqual(result.status,0,key);
  assert.match(result.stderr,/OFFLINE_704_NO_CREDENTIALS_OR_RELEASE_FLAG_/);
  assert.doesNotMatch(result.stdout,/EXACT_704_OFFLINE_SOURCES_VERIFIED/);
 }
});
