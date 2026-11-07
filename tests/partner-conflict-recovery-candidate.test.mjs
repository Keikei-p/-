import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {
 gitBlob,preparePartnerConflictRecoveryPage,candidateActionSource
} from "../staging/partner-sb-v2/partner-conflict-recovery-candidate.mjs";

const baseline=readFileSync(new URL(
 "../staging/partner-sb-v2/partner-workspace.html",import.meta.url),"utf8");
const frozen="82a1ed0c67b14ea3fd915419da7864b7c99ffe7b";
function mockFlow({failRead=false}={}){
 const calls={clear:0,refresh:0,fail:[],notice:[],saved:0};
 const fields={
  date:{value:"2026-10-31"},
  staffSelect:{value:"s1"},
  appBox:{hidden:false}
 };
 const session={uid:"partner-owner"};
 const context=vm.createContext({
  loading:false,
  activeCodeSession:null,
  auth:{currentUser:session},
  data:{date:"2026-10-31",records:[{staffId:"s1",version:1}]},
  countDayCache:{clear(){calls.clear++}},
  $:name=>fields[name]??(()=>{throw Error("UNEXPECTED_FIELD")})(),
  refresh:async()=>{
   calls.refresh++;
   if(failRead){
    context.data=null;
    return;
   }
   context.data={date:"2026-10-31",records:[{
    staffId:"s1",version:2,counts:{NURO:5}
   }]};
  },
  notice:(msg,error)=>calls.notice.push([msg,error===true]),
  fail:e=>calls.fail.push(e?.code??"unknown")
 });
 const task=async error=>{
  calls.saved++;
  if(error)throw Object.assign(Error("redacted"),{code:error});
  return "保存・再取得照合が成功しました。第2版";
 };
 const action=vm.runInContext(candidateActionSource()+"\naction",context);
 return {calls,fields,context,action,task};
}
test("baseline remains exact, candidate generated without changing any published or reviewed page",()=>{
 assert.equal(gitBlob(baseline),frozen);
 const result=preparePartnerConflictRecoveryPage(baseline);
 assert.equal(result.report.originalSha,frozen);
 assert.equal(result.report.originalUntouched,true);
 assert.equal(result.report.deployed,false);
 assert.equal(result.report.firebaseWrites,0);
 assert.equal(result.report.automaticallyRetriesConflict,false);
 assert.equal(gitBlob(baseline),frozen);
 assert.notEqual(result.html,baseline);
 assert.equal(result.report.candidateSha,gitBlob(result.html));
 assert.match(result.html,/resumeOnConflict:true/);
 assert.match(result.html,/他の担当者または自社が件数を更新しました/);
 assert.equal(result.html.includes('$("save").onclick=()=>action(async()=>{'),true);
 assert.equal(result.html.includes('functions/aborted'),true);
 assert.equal((result.html.match(/resumeOnConflict:true/g)||[]).length,1);
 assert.match(result.html,/const verified=\(await get\(\{date:\$\("date"\)\.value\}\)\)\.data/);
 assert.doesNotMatch(result.html,/firebase deploy|firestore:delete|deleteDoc\(/);
});
test("changed or already-patched page fails closed; never silently patches wrong document",()=>{
 assert.throws(()=>preparePartnerConflictRecoveryPage(baseline+" "),
  /STOP_PARTNER_CONFLICT_CANDIDATE_ORIGINAL_CHANGED/);
 const patched=preparePartnerConflictRecoveryPage(baseline).html;
 assert.throws(()=>preparePartnerConflictRecoveryPage(patched),
  /STOP_PARTNER_CONFLICT_CANDIDATE_ORIGINAL_CHANGED/);
 assert.throws(()=>preparePartnerConflictRecoveryPage(null),
  /STOP_PARTNER_CONFLICT_CANDIDATE_SOURCE_TYPE/);
});
test("version conflict reads fresh server state once without retrying stale count write",async()=>{
 const f=mockFlow();
 await f.action(()=>f.task("functions/aborted"),{resumeOnConflict:true});
 assert.equal(f.calls.saved,1);
 assert.equal(f.calls.refresh,1);
 assert.equal(f.calls.clear,2);
 assert.equal(f.calls.fail.length,0);
 assert.equal(f.context.data.records[0].version,2);
 assert.match(f.calls.notice.at(-1)[0],/最新データを読み直しました/);
 assert.match(f.calls.notice.at(-1)[0],/自動再送はしていません/);
 assert.equal(f.context.loading,false);
});
test("same guard supports server normalized aborted code and not unrelated failures",async()=>{
 const f=mockFlow();
 await f.action(()=>f.task("aborted"),{resumeOnConflict:true});
 assert.equal(f.calls.refresh,1);
 const x=mockFlow();
 await x.action(()=>x.task("functions/permission-denied"),{resumeOnConflict:true});
 assert.equal(x.calls.saved,1);
 assert.equal(x.calls.refresh,0);
 assert.deepEqual(x.calls.fail,["functions/permission-denied"]);
 const y=mockFlow();
 await y.action(()=>y.task("functions/aborted"));
 assert.equal(y.calls.refresh,0,"only count-save opts in to recovery");
 assert.deepEqual(y.calls.fail,["functions/aborted"]);
});
test("account/date switch during failed write hides stale screen without cross-user fetch",async()=>{
 for(const mode of ["account","date","company-code"]){
  const f=mockFlow();
  const task=async()=>{
   f.calls.saved++;
   if(mode==="account")f.context.auth.currentUser={uid:"new"};
   if(mode==="date")f.fields.date.value="2026-11-01";
   if(mode==="company-code")f.context.activeCodeSession="changed";
   throw Object.assign(Error("secret"),{code:"functions/aborted"});
  };
  await f.action(task,{resumeOnConflict:true});
  assert.equal(f.calls.refresh,0,mode);
  assert.equal(f.calls.saved,1);
  assert.equal(f.fields.appBox.hidden,true);
  assert.equal(f.context.data,null);
  assert.match(f.calls.notice.at(-1)[0],/再ログイン・再取得/);
 }
});
test("readback failure is disclosed, never guessed successful or retried",async()=>{
 const f=mockFlow({failRead:true});
 await f.action(()=>f.task("functions/aborted"),{resumeOnConflict:true});
 assert.equal(f.calls.saved,1);
 assert.equal(f.calls.refresh,1);
 assert.match(f.calls.notice.at(-1)[0],/最新の件数を照合できません/);
 assert.equal(f.calls.fail.length,0);
});
test("successful save preserves the existing verified-read confirmation",async()=>{
 const f=mockFlow();
 await f.action(()=>f.task(null),{resumeOnConflict:true});
 assert.equal(f.calls.saved,1);
 assert.equal(f.calls.refresh,1);
 assert.equal(f.calls.clear,1);
 assert.equal(f.calls.fail.length,0);
 assert.match(f.calls.notice.at(-1)[0],/保存・再取得照合が成功しました/);
 assert.equal(f.calls.notice.at(-1)[1],false);
});
test("frozen reviewed deployment baselines unchanged and candidate requires manual release review",()=>{
 const src=readFileSync(new URL(
  "../staging/partner-sb-v2/partner-conflict-recovery-candidate.mjs",import.meta.url),"utf8");
 assert.match(src,/STAGING ONLY \/ NEVER DEPLOY/);
 assert.doesNotMatch(src,/getFirestore|httpsCallable\(|firebase deploy|fs\.writeFile|writeFileSync/);
 assert.equal(preparePartnerConflictRecoveryPage(baseline).report.deployed,false);
});
