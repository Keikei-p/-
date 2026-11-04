"use strict";
// Isolated, opt-in account-only erasure. No raw sales, ranking, team, price,
// correction, LINE, or historical count collection is ever read or written.
const crypto=require("node:crypto");
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm=x=>typeof x==="string"?x.trim():"";
const lower=x=>norm(x).toLowerCase();
const jobKey=(companyId,uid)=>crypto.createHash("sha256").update(companyId+"\n"+uid).digest("hex");

function makeAccountErasure({db,getAuth,FieldValue,HttpsError,enabled=()=>false,now=()=>Date.now()}={}){
 if(!db||!getAuth||!FieldValue||!HttpsError)throw Error("missing_erasure_dependency");
 const fail=(code="failed-precondition")=>{throw new HttpsError(code,"対象・権限・削除条件を確認できません。");};
 const ref=(root,id)=>db.collection(root).doc(id);
 const member=(cid,uid)=>ref("companies",cid).collection("members").doc(uid);
 const staff=(cid,uid)=>ref("companies",cid).collection("partnerWorkStaff").doc(uid);
 const job=(cid,uid)=>ref("accountErasureJobs",jobKey(cid,uid));
 const authIdentityHash=a=>{
  if(!a||!UID.test(a.uid||"")||!EMAIL.test(lower(a.email))||
     typeof a.metadata?.creationTime!=="string"||
     !a.metadata.creationTime.trim())fail();
  return crypto.createHash("sha256").update(a.uid+"\\n"+
   lower(a.email)+"\\n"+a.metadata.creationTime).digest("hex");
 };
 async function authGone(uid){
  try{await getAuth().getUser(uid);return false;}
  catch(e){if(e?.code==="auth/user-not-found")return true;throw e;}
 }
 // Team movement is preserved only as business metadata. Unknown fields
 // (including email/name/phone) never get copied into the erasure receipt.
 const safeHistory=value=>{
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>100)fail();
  return value.map(entry=>{
   if(!entry||typeof entry!=="object"||Array.isArray(entry)||
      Object.keys(entry).some(key=>!["effectiveDate","fromTeamId","toTeamId"].includes(key))||
      typeof entry.effectiveDate!=="string"||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.effectiveDate)||
      (entry.fromTeamId!=null&&!UID.test(entry.fromTeamId))||
      (entry.toTeamId!=null&&!UID.test(entry.toTeamId)))fail();
   return {effectiveDate:entry.effectiveDate,fromTeamId:entry.fromTeamId??null,
    toTeamId:entry.toTeamId??null};
  });
 };
 async function actor(request,strict=false){
  if(enabled()!==true)fail("unavailable");
  const uid=request?.auth?.uid,mail=lower(request?.auth?.token?.email);
  if(!UID.test(uid||"")||!EMAIL.test(mail)||
   request.auth.token.email_verified!==true)fail("unauthenticated");
  const bearer=request?.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!bearer)fail("unauthenticated");
  let a,t;
  try{[a,t]=await Promise.all([getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)]);}
  catch{fail("unauthenticated");}
  if(a.disabled||!a.emailVerified||lower(a.email)!==mail||
    t.uid!==uid||t.email_verified!==true||lower(t.email)!==mail)fail("unauthenticated");
  // Require a fresh login on the administrator's device for irreversible erasure.
  if(strict&&(!Number.isFinite(t.auth_time)||
     now()/1000-t.auth_time>300||now()/1000-t.auth_time<0))fail("failed-precondition");
  return {uid,email:mail};
 }
 async function check(a,targetUid,transaction=null,allowPending=false){
  if(!UID.test(targetUid||"")||targetUid===a.uid)fail("invalid-argument");
  const get=doc=>transaction?transaction.get(doc):doc.get();
  const managerUserRef=ref("users",a.uid);
  const managerUserSnap=await get(managerUserRef),mu=managerUserSnap.data()||{};
  const cid=mu.companyId;
  if(!managerUserSnap.exists||!UID.test(cid||"")||mu.uid!==a.uid||
    mu.active!==true)fail("permission-denied");
  const companyRef=ref("companies",cid),managerMemberRef=member(cid,a.uid);
  const [companySnap,managerMemberSnap]=await Promise.all([get(companyRef),get(managerMemberRef)]);
  const c=companySnap.data()||{},mm=managerMemberSnap.data()||{};
  if(!companySnap.exists||!managerMemberSnap.exists||c.active!==true||
    mm.uid!==a.uid||mm.active!==true||mm.companyRole!==mu.companyRole||
    (mm.companyId!=null&&mm.companyId!==cid))fail("permission-denied");
  let mode;
  if((c.companyKind==="internal"||c.companyKind==="direct"||c.companyKind==null)&&
    c.ownerUid===a.uid&&mu.companyRole==="owner"&&mm.companyRole==="owner"&&
    mu.accessKind!=="partner"&&mm.accessKind!=="partner")mode="internal_owner";
  else if(c.companyKind==="partner"&&
    mu.accessKind==="partner"&&mm.accessKind==="partner"&&
    mu.memberType==="cooperator"&&mm.memberType==="cooperator"&&
    mu.canViewRevenue===false&&mm.canViewRevenue===false&&
    mu.canViewUnitPrice===false&&mm.canViewUnitPrice===false&&
    (mu.role==="leader"&&mm.role==="leader"||
      c.ownerUid===a.uid&&mu.companyRole==="owner"&&mm.companyRole==="owner")&&
    mu.role===mm.role&&UID.test(c.hubCompanyId||"")){
    const rs=await get(ref("partnerRelations",cid)),rel=rs.data()||{};
    if(!rs.exists||rel.partnerCompanyId!==cid||rel.hubCompanyId!==c.hubCompanyId||
      rel.active!==true||rel.countSharingApproved!==true)fail("permission-denied");
    mode="partner_leader";
  }
  else fail("permission-denied");
  const ur=ref("users",targetUid),mr=member(cid,targetUid);
  const sr=mode==="partner_leader"?staff(cid,targetUid):null;
  const jr=job(cid,targetUid);
  const [us,ms,ss,js,secondary,oldTransfer]=await Promise.all([
   get(ur),get(mr),sr?get(sr):Promise.resolve(null),
   get(jr),get(ref("partnerWorkspaceContexts",targetUid)),
   get(ref("partnerHistoricalTransfers",targetUid))
  ]);
  const u=us.data()||{},m=ms.data()||{},st=ss?.data()||{},j=js.data()||{};
  if(secondary.exists||oldTransfer.exists)fail();
  if(js.exists){
   if(j.companyId!==cid||j.mode!==mode||j.requestedByUid!==a.uid||
      !["pending","complete"].includes(j.status))fail();
   if(j.status==="complete")return{mode,cid,status:"complete",jr,targetUid};
   if(!allowPending)fail();
   // A pending job is permission to finish deletion of ONLY the original
   // inactive roster. If that UID was reactivated/transferred, never delete
   // the new current users/{uid}, even when Auth proof happens to match.
   if(!us.exists||!ms.exists||
      u.uid!==targetUid||u.companyId!==cid||u.active!==false||
      m.uid!==targetUid||(m.companyId!=null&&m.companyId!==cid)||
      m.active!==false||
      (sr&&(!ss?.exists||st.uid!==targetUid||st.companyId!==cid||
       st.kind!=="account"||st.active!==false)))fail();
   if(j.targetUid!==targetUid||!norm(j.targetName)||
      typeof j.targetAuthHash!=="string"||
      !/^[a-f0-9]{64}$/.test(j.targetAuthHash)||
      typeof j.targetAuthMarker!=="string"||
      !/^[a-f0-9]{48}$/.test(j.targetAuthMarker))fail();
   return {mode,cid,status:"pending",jr,targetUid,ur,mr,sr,
    targetName:j.targetName,targetAuthHash:j.targetAuthHash,
    targetAuthMarker:j.targetAuthMarker};
  }
  if(!us.exists||!ms.exists||u.uid!==targetUid||
    u.companyId!==cid||m.uid!==targetUid||
    (m.companyId!=null&&m.companyId!==cid)||
    u.companyRole!=="member"||m.companyRole!=="member"||
    !norm(u.name)||u.name.length>80)fail();
  // Before touching anything, prove that the Auth UID and profile's
  // existing email actually refer to the same target account.
  let identity;
  try{identity=await getAuth().getUser(targetUid);}catch{fail();}
  if(identity.uid!==targetUid||!EMAIL.test(lower(identity.email))||
    (u.email&&lower(u.email)!==lower(identity.email))||
    (m.email&&lower(m.email)!==lower(identity.email)))fail();
  // Existing owner "利用停止" disables Auth but keeps old personal profiles.
  // Such an already suspended account must still be eligible for hard erasure.
  // One active and one inactive document is an unsafe partial state.
  const activePair=u.active===true&&m.active===true;
  const alreadySuspended=u.active===false&&m.active===false&&identity.disabled===true;
  if(!activePair&&!alreadySuspended)fail();
  if(mode==="internal_owner"){
   if(u.accessKind==="partner"||m.accessKind==="partner"||
     c.ownerUid===targetUid||c.masterUid===targetUid)fail();
  }else{
   if(!ss?.exists||st.uid!==targetUid||st.companyId!==cid||
      !UID.test(u.teamId||"")||
      !["member","leader"].includes(u.role)||m.role!==u.role||
      st.kind!=="account"||
      !(st.active===true||alreadySuspended&&st.active===false)||
      st.role!==u.role||st.teamId!==u.teamId||m.teamId!==u.teamId||
      u.accessKind!=="partner"||m.accessKind!=="partner"||
      u.memberType!=="cooperator"||m.memberType!=="cooperator"||
      u.canViewRevenue!==false||m.canViewRevenue!==false||
      u.canViewUnitPrice!==false||m.canViewUnitPrice!==false||
      c.ownerUid===targetUid)fail();
   // Ordinary partner leaders may only erase members of their OWN team.
   // No leader-to-leader deletion, no cross-team or another company's UID.
   if(c.ownerUid!==a.uid&&
      (u.role!=="member"||m.role!=="member"||u.teamId!==mu.teamId))fail("permission-denied");
  }
  return {mode,cid,status:"ready",jr,targetUid,ur,mr,sr,
   targetName:norm(u.name),targetAuthHash:authIdentityHash(identity),
   businessHistory:{
    oldTeamId:u.teamId||null,role:u.role||null,
    userTeamHistory:safeHistory(u.teamHistory),
    memberTeamHistory:safeHistory(m.teamHistory),
    staffTeamHistory:safeHistory(st.teamHistory)
   }};
 }
 async function preview(request){
  const a=await actor(request),d=request?.data||{};
  if(d.action!=="preview"||!UID.test(d.targetUid||"")||
    Object.keys(d).some(k=>!["action","targetUid"].includes(k)))fail("invalid-argument");
  const result=await check(a,d.targetUid,null,true);
  return {targetUid:d.targetUid,
   // Name is shown only to the same manager who already owns the roster.
   targetName:result.status==="ready"||result.status==="pending"?
    result.targetName:null,
   ready:result.status==="ready",
   pending:result.status==="pending",
   completed:result.status==="complete",
   removesFirebaseAuthentication:true,
   removesActiveUserAndMemberProfile:true,
   historicalSalesAndTeamSnapshotsRetained:true,
   note:"過去の営業記録・班履歴に保存済みの氏名・UIDは履歴として残る場合があります。"};
 }
 // A fresh manager-initiated query is necessary: deactivated accounts
 // disappear from the ordinary active-member list, even after page reload.
 async function listPending(request){
  const a=await actor(request),d=request?.data||{};
  if(d.action!=="listPending"||
     Object.keys(d).some(k=>k!=="action"))fail("invalid-argument");
  const snaps=await db.collection("accountErasureJobs")
   .where("requestedByUid","==",a.uid).limit(26).get();
  if(snaps.size>25)fail("resource-exhausted");
  const entries=[];
  for(const sn of snaps.docs){
   const receipt=sn.data()||{};
   if(receipt.status!=="pending")continue;
   if(!UID.test(receipt.targetUid||""))fail();
   let x;
   try{x=await check(a,receipt.targetUid,null,true);}
   catch(e){
    if(e.code==="permission-denied"||e.code==="failed-precondition")continue;
    throw e;
   }
   if(x.status==="pending"&&x.jr.id===sn.id&&
      x.targetName===receipt.targetName){
    entries.push({targetUid:x.targetUid,targetName:x.targetName});
   }
  }
  entries.sort((a,b)=>a.targetName.localeCompare(b.targetName,"ja"));
  return {pending:entries,readOnly:true};
 }
 async function confirm(request){
  const a=await actor(request,true),d=request?.data||{};
  if(d.action!=="confirm"||!UID.test(d.targetUid||"")||
    d.confirmation!=="DELETE_ACCOUNT_ONLY"||
    typeof d.confirmName!=="string"||
    Object.keys(d).some(k=>!["action","targetUid","confirmation","confirmName"].includes(k)))
    fail("invalid-argument");
  let checked=await check(a,d.targetUid,null,true);
  if(checked.status==="complete"){
   if(!await authGone(d.targetUid))fail();
   return{complete:true,authDeleted:true,personalProfileDeleted:true};
  }
  if(norm(d.confirmName)!==checked.targetName)fail("invalid-argument");
  // Metadata.creationTime in the Auth emulator (and potentially near-simultaneous
  // real user recreations) is not a sufficient identity guarantee. A private,
  // per-deletion custom claim is REQUIRED before we call deleteUser.
  const marker=checked.status==="ready"?
   crypto.randomBytes(24).toString("hex"):checked.targetAuthMarker;
  if(!/^[a-f0-9]{48}$/.test(marker||""))fail();
  if(checked.status==="ready"){
   // Only the bounded account and roster paths change here. The business
   // history is copied BEFORE profile removal, without email, name or sales.
   await db.runTransaction(async tx=>{
    const x=await check(a,d.targetUid,tx,false);
    if(x.status!=="ready"||x.cid!==checked.cid||x.mode!==checked.mode||
       x.targetName!==checked.targetName)fail();
    tx.create(x.jr,{
     companyId:x.cid,mode:x.mode,requestedByUid:a.uid,status:"pending",
     targetUid:d.targetUid,targetName:x.targetName,
     targetAuthHash:x.targetAuthHash,targetAuthMarker:marker,
     businessHistory:x.businessHistory,createdAt:FieldValue.serverTimestamp()
    });
    tx.update(x.ur,{active:false,updatedAt:FieldValue.serverTimestamp()});
    tx.update(x.mr,{active:false,updatedAt:FieldValue.serverTimestamp()});
    if(x.sr)tx.update(x.sr,{active:false,updatedAt:FieldValue.serverTimestamp()});
   });
  }
  // Never delete a newly recreated Firebase Auth identity under a reused UID.
  // A missing Auth user is fine when an earlier attempt deleted it already.
  let stillThere=false;
  try{
   let account=await getAuth().getUser(d.targetUid);
   if(authIdentityHash(account)!==checked.targetAuthHash)fail();
   if(checked.status==="ready"){
    // Only the FIRST, explicitly consented deletion can mark an Auth record.
    // A retry MUST NOT re-mark a new Auth user with a reused UID.
    if(account.customClaims?.nicoErasureProofV1!=null)fail();
    try{
     await getAuth().setCustomUserClaims(d.targetUid,{
      ...(account.customClaims||{}),nicoErasureProofV1:marker
     });
    }catch{fail("unavailable");}
    account=await getAuth().getUser(d.targetUid);
   }
   if(authIdentityHash(account)!==checked.targetAuthHash||
      account.customClaims?.nicoErasureProofV1!==marker)fail();
   stillThere=true;
  }catch(e){
   if(e?.code!=="auth/user-not-found")throw e;
  }
  // Firebase Authentication cannot participate in Firestore transactions.
  // The durable pending job enables the SAME manager to retry safely.
  try{
   if(stillThere){
    // Re-check the marker immediately before each irrevocable Auth action.
    // Firebase Admin has no conditional delete-if-claims-match operation.
    const beforeDisable=await getAuth().getUser(d.targetUid);
    if(authIdentityHash(beforeDisable)!==checked.targetAuthHash||
       beforeDisable.customClaims?.nicoErasureProofV1!==marker)fail();
    try{await getAuth().updateUser(d.targetUid,{disabled:true});}
    catch(e){if(e?.code!=="auth/user-not-found")throw e;}
    const beforeDelete=await getAuth().getUser(d.targetUid);
    if(authIdentityHash(beforeDelete)!==checked.targetAuthHash||
       beforeDelete.customClaims?.nicoErasureProofV1!==marker)fail();
    try{await getAuth().deleteUser(d.targetUid);}
    catch(e){if(e?.code!=="auth/user-not-found")throw e;}
   }
  }catch{
   fail("unavailable"); // pending job remains for recovery, records unaffected
  }
  await db.runTransaction(async tx=>{
   const x=await check(a,d.targetUid,tx,true);
   if(x.status==="complete")return;
   if(x.status!=="pending")fail();
   const [us,ms,ss,receipt]=await Promise.all([tx.get(x.ur),tx.get(x.mr),
    x.sr?tx.get(x.sr):Promise.resolve(null),tx.get(x.jr)]);
   // No change to historical record, count, pricing, team or correction docs.
   if(us.exists)tx.delete(x.ur);
   if(ms.exists)tx.delete(x.mr);
   // A non-personal tombstone retains the historical staff ID for count joins.
   // Display name and email never remain on the live staff profile.
   if(ss?.exists){
    const business=receipt.data()?.businessHistory||{};
    if(!UID.test(business.oldTeamId||"")||
      !["leader","member"].includes(business.role))fail();
    // Replace the whole live staff document: old profile could contain
    // unexpected name/email/phone fields. Never leave PII by shallow update.
    tx.set(x.sr,{uid:null,name:"退会済み",kind:"retired",companyId:x.cid,
      role:business.role,teamId:business.oldTeamId,active:false,
      retiredAt:FieldValue.serverTimestamp()});
   }
   tx.update(x.jr,{status:"complete",
    targetUid:FieldValue.delete(),targetName:FieldValue.delete(),
    targetAuthHash:FieldValue.delete(),targetAuthMarker:FieldValue.delete(),
    completedAt:FieldValue.serverTimestamp()});
  });
  return {complete:true,authDeleted:true,personalProfileDeleted:true,
   historicalBusinessRecordsPreserved:true};
 }
 return Object.freeze({preview,confirm,listPending});
}
module.exports={makeAccountErasure};
