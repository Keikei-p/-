/**
 * STAGING ONLY / NEVER DEPLOY. Byte-frozen, additive browser candidate.
 * The released partner workspace, staged baseline, reviewed Functions,
 * Firebase security rules, and all user data remain unchanged.
 *
 * A backend version rejection means an owner or another partner edited the
 * same record. Re-read the authoritative server version ONCE. Never replay
 * the rejected request automatically (it may overwrite someone else's work).
 */
import {createHash} from "node:crypto";
const FROZEN_BASELINE_SHA="82a1ed0c67b14ea3fd915419da7864b7c99ffe7b";
const ACTION_SOURCE=String.raw`async function action(task){if(loading)return;loading=true;try{
 countDayCache.clear();
 const message=await task();await refresh();
 // A successful re-read must not overwrite the actual save confirmation.
 if(typeof message==="string"&&data)notice(message);
 }catch(e){fail(e)}finally{loading=false}}`;
const SAVE_END=String.raw` return "保存・再取得照合が成功しました。第"+result.version+"版";
});`;
const ACTION_CANDIDATE=String.raw`async function action(task,options={}){
 if(loading)return;
 const attemptDate=$("date").value;
 const attemptStaff=$("staffSelect").value;
 const attemptCode=activeCodeSession;
 const attemptUser=auth.currentUser;
 loading=true;
 try{
  countDayCache.clear();
  const message=await task();await refresh();
  // A successful re-read must not overwrite actual save confirmation.
  if(typeof message==="string"&&data)notice(message);
 }catch(e){
  // This applies ONLY to count saves explicitly requesting recovery.
  // Never blindly retry the old version or replace updated SB breakdowns.
  const conflict=options?.resumeOnConflict===true &&
   (e?.code==="functions/aborted"||e?.code==="aborted");
  if(!conflict){fail(e);return}
  // An account/date switch during the request cannot reuse the prior form.
  if($("date").value!==attemptDate||
     activeCodeSession!==attemptCode||
     auth.currentUser!==attemptUser){
   data=null;
   $("appBox").hidden=true;
   notice("保存中にログイン状態または日付が変更されました。再ログイン・再取得して内容を確認してください。",true);
   return;
  }
  countDayCache.clear();
  await refresh();
  if(!data||data.date!==attemptDate||
     !Array.isArray(data.records)||
     !data.records.some(row=>row.staffId===attemptStaff)){
   notice("件数の保存競合が起きました。最新の件数を照合できません。再取得後に内容を確認してください。自動再送はしていません。",true);
  }else{
   notice("他の担当者または自社が件数を更新しました。最新データを読み直しました。訂正後の内容を確認し、必要な項目だけ改めて入力してください。自動再送はしていません。",true);
  }
 }finally{loading=false}
}`;
const SAVE_CANDIDATE=String.raw` return "保存・再取得照合が成功しました。第"+result.version+"版";
},{resumeOnConflict:true});`;
const halt=reason=>{throw Error("STOP_PARTNER_CONFLICT_CANDIDATE_"+reason)};
export function gitBlob(source){
 if(typeof source!=="string")halt("SOURCE_TYPE");
 const data=Buffer.from(source,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+data.length+"\0"))
  .update(data).digest("hex");
}
export function preparePartnerConflictRecoveryPage(source){
 if(gitBlob(source)!==FROZEN_BASELINE_SHA)halt("ORIGINAL_CHANGED");
 if(source.split(ACTION_SOURCE).length!==2||
    source.split(SAVE_END).length!==2||
    !source.includes('$("save").onclick=()=>action(async()=>{')||
    !source.includes('const result=(await save({date:$("date").value,staffId,counts,privateCounts,'))
  halt("SURGICAL_ANCHOR_CHANGED");
 const candidate=source.replace(ACTION_SOURCE,ACTION_CANDIDATE)
  .replace(SAVE_END,SAVE_CANDIDATE);
 if(candidate===source||candidate.length<=source.length||
    !candidate.includes(ACTION_CANDIDATE)||
    !candidate.includes(SAVE_CANDIDATE))
  halt("OUTPUT_UNVERIFIED");
 return Object.freeze({
  html:candidate,
  report:Object.freeze({
   mode:"STAGING_CANDIDATE_ONLY",
   originalSha:FROZEN_BASELINE_SHA,
   candidateSha:gitBlob(candidate),
   originalUntouched:true,
   deployed:false,
   firebaseWrites:0,
   automaticallyRetriesConflict:false,
   refreshesAuthoritativeCounts:true
  })
 });
}
export const candidateActionSource=()=>ACTION_CANDIDATE;
