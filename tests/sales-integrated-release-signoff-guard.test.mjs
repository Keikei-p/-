// Synthetic local Git repos only. Never signs a real release or accesses Firebase.
import assert from "node:assert/strict";
import {execFileSync,spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const script=fileURLToPath(new URL("../scripts/check-sales-safe-pr.mjs",import.meta.url));
function runGit(dir,...args){
 return execFileSync("git",args,{cwd:dir,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
}
function commit(dir,message){
 runGit(dir,"add",".");
 runGit(dir,"commit","-qm",message);
 return runGit(dir,"rev-parse","HEAD");
}
function setup(){
 const dir=mkdtempSync(join(tmpdir(),"nico-signed-review-"));
 mkdirSync(join(dir,"docs"));
 runGit(dir,"init","-q");
 runGit(dir,"config","user.name","Synthetic CI");
 runGit(dir,"config","user.email","ci@example.invalid");
 writeFileSync(join(dir,".firebaserc"),JSON.stringify({projects:{default:"sales-management-cc116"}}));
 writeFileSync(join(dir,"firebase.json"),JSON.stringify({firestore:{rules:"firestore.rules"}}));
 writeFileSync(join(dir,"index.html"),"baseline");
 writeFileSync(join(dir,"docs","SALES_RELEASE_SIGNOFF.md"),"# Historical reviews\n");
 const base=commit(dir,"baseline");
 writeFileSync(join(dir,"index.html"),"reviewed new app source");
 const reviewed=commit(dir,"reviewed code");
 return {dir,base,reviewed};
}
function signedNote(sha){
 return "\n## SALES_RELEASE_PR_704_SIGNED\n"+
  "reviewed_source_sha: "+sha+"\n"+
  "reviewed_by: Keikei-p\n"+
  "signature: Keikei-p\n"+
  "decision: APPROVE_PR_704_BOUNDED_RELEASE\n"+
  "review_date: 2026-11-16\n";
}
function signedCommit(dir,append){
 writeFileSync(join(dir,"docs","SALES_RELEASE_SIGNOFF.md"),
  readFileSync(join(dir,"docs","SALES_RELEASE_SIGNOFF.md"),"utf8")+append);
 return commit(dir,"synthetic signoff fixture");
}
function verdict({dir,base},head,hasLabel=true){
 const eventFile=join(dir,"synthetic-pr-event.json");
 writeFileSync(eventFile,JSON.stringify({
  repository:{full_name:"Keikei-p/-"},
  pull_request:{number:704,base:{ref:"main",sha:base},head:{sha:head},
   labels:hasLabel?[{name:"sales-production-reviewed"}]:[]}
 }));
 return spawnSync(process.execPath,[script],{cwd:dir,encoding:"utf8",
  env:{...process.env,GITHUB_EVENT_PATH:eventFile}});
}
function withRepo(fn){const fixture=setup();try{fn(fixture);}finally{rmSync(fixture.dir,{recursive:true,force:true});}}

test("PR704: a genuinely final, source-pinned synthetic review can pass structural validation",()=>{
 withRepo(f=>{
  const head=signedCommit(f.dir,signedNote(f.reviewed));
  const r=verdict(f,head);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/PASS: PR source guard/);
 });
});
test("PR704: unsigned note plus maintainer label cannot pass",()=>{
 withRepo(f=>{
  const head=signedCommit(f.dir,"\n## Pending review\n- signature: 未記入\n");
  const r=verdict(f,head);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/signer-only review commit/);
 });
});
test("PR704: fake reviewed SHA cannot pass",()=>{
 withRepo(f=>{
  const head=signedCommit(f.dir,signedNote("0".repeat(40)));
  assert.notEqual(verdict(f,head).status,0);
 });
});
test("PR704: any source change after the signed note invalidates it",()=>{
 withRepo(f=>{
  signedCommit(f.dir,signedNote(f.reviewed));
  writeFileSync(join(f.dir,"index.html"),"unreviewed change after signoff");
  const head=commit(f.dir,"later code change");
  assert.notEqual(verdict(f,head).status,0);
 });
});
test("PR704: signed note cannot replace maintainer label",()=>{
 withRepo(f=>{
  const head=signedCommit(f.dir,signedNote(f.reviewed));
  const r=verdict(f,head,false);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/maintainer-applied label/);
 });
});
