"use strict";
/**
 * STAGING ONLY. Never registered as a Firebase Function or shipped to Hosting.
 *
 * A LIVE partner_secondary account may have both (1) primary internal member
 * finance access and (2) separate count-only partner workspace access.
 * This reviewed, explicit SELF-service transaction moves only CURRENT identity.
 * It cannot alter historical sales, financial originals, team snapshots,
 * partner work entries, financial Rules, billing, invitations or Auth identity.
 *
 * A future deploy requires independent real-UID GET/LIST + count continuity
 * proof, verified backup/restore and an explicit release approval.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]{1,128}@[^\s@]{1,254}$/;
const CONSENT="MOVE_MY_PRIMARY_LOGIN_TO_PARTNER_KEEP_OLD_SALES_HISTORY";
const INTERNAL_TYPES=new Set(["internal","direct","member","managed"]);
const clean=x=>typeof x==="string"?x.trim():"";
const hasId=x=>ID.test(x||"");
const validRole=x=>x==="leader"||x==="member";
const displayName=x=>typeof x==="string"&&
 x.trim().length>=1&&x.trim().length<=60&&!/[\u0000-\u001f\u007f]/.test(x);
function fail(ErrorType,code="failed-precondition"){
 throw new ErrorType(code,"Partner primary handoff denied");
}
function internalType(x){return x==null||INTERNAL_TYPES.has(x);}
function sameEmail(data,email){return !clean(data?.email)||clean(data.email).toLowerCase()===email;}

function buildService({db,getAuth,FieldValue,HttpsError}){
 if(!db?.collection||!db?.runTransaction||
    typeof getAuth!=="function"||!FieldValue?.serverTimestamp||
    !FieldValue?.delete||typeof HttpsError!=="function")
  throw Error("SECONDARY_PRIMARY_HANDOFF_MISSING_DEPENDENCY");
 const refs=(company,uid)=>({
  users:db.collection("users").doc(uid),
  internalCompany:db.collection("companies").doc(company),
  internalMember:db.collection("companies").doc(company).collection("members").doc(uid)
 });
 async function principal(request){
  const uid=request?.auth?.uid;
  const email=clean(request?.auth?.token?.email).toLowerCase();
  const bearer=request?.rawRequest?.headers?.authorization?.match(
   /^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!hasId(uid)||!EMAIL.test(email)||!bearer||
     request?.auth?.token?.email_verified!==true)
   fail(HttpsError,"unauthenticated");
  let live,decoded;
  try{[live,decoded]=await Promise.all([
   getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)
  ]);}catch{fail(HttpsError,"unauthenticated");}
  if(!live||live.disabled===true||live.emailVerified!==true||
    clean(live.email).toLowerCase()!==email||
    decoded?.uid!==uid||decoded?.email_verified!==true||
    clean(decoded.email).toLowerCase()!==email)
   fail(HttpsError,"unauthenticated");
  return {uid,email};
 }
 const path=(cid,sub)=>db.collection("companies").doc(cid).collection(sub);
 async function resolve(tx,who,partnerCompanyId){
  if(!hasId(partnerCompanyId))fail(HttpsError,"invalid-argument");
  const ctxRef=db.collection("partnerWorkspaceContexts").doc(who.uid);
  const userRef=db.collection("users").doc(who.uid);
  const partnerRef=db.collection("companies").doc(partnerCompanyId);
  const pmRef=path(partnerCompanyId,"members").doc(who.uid);
  const staffRef=path(partnerCompanyId,"partnerWorkStaff").doc(who.uid);
  const relRef=db.collection("partnerRelations").doc(partnerCompanyId);
  const archiveRef=db.collection("partnerHistoricalTransfers").doc(who.uid);
  const [ctxSnap,userSnap,partnerSnap,pmSnap,staffSnap,relSnap,archiveSnap]=
   await Promise.all([ctxRef,userRef,partnerRef,pmRef,staffRef,relRef,archiveRef]
    .map(ref=>tx.get(ref)));
  const ctx=ctxSnap.data()||{},user=userSnap.data()||{},
    partner=partnerSnap.data()||{},pm=pmSnap.data()||{},
    staff=staffSnap.data()||{},rel=relSnap.data()||{};
  const oldCid=clean(user.companyId);
  if(!ctxSnap.exists||!userSnap.exists||!partnerSnap.exists||
     !pmSnap.exists||!staffSnap.exists||!relSnap.exists||
     archiveSnap.exists||
     !hasId(oldCid)||!hasId(ctx.primaryCompanyId)||
     oldCid!==ctx.primaryCompanyId||oldCid!==ctx.hubCompanyId||
     partnerCompanyId===oldCid||
     user.uid!==who.uid||user.active!==true||
     !sameEmail(user,who.email)||
     (user.companyRole!=null&&user.companyRole!=="member")||
     (user.role!=null&&!validRole(user.role))||
     (user.accessKind!=null&&user.accessKind!=="internal")||
     !internalType(user.memberType)||
     ctx.uid!==who.uid||ctx.kind!=="partner_secondary"||
     ctx.active!==true||ctx.partnerCompanyId!==partnerCompanyId||
     clean(ctx.emailLower)!==who.email||
     !validRole(ctx.role)||!hasId(ctx.teamId)||
     partner.companyKind!=="partner"||partner.active!==true||
     partner.hubCompanyId!==oldCid||
     partner.ownerUid===who.uid||partner.masterUid===who.uid||
     pm.uid!==who.uid||pm.companyId!==partnerCompanyId||
     pm.companyRole!=="member"||pm.active!==true||
     pm.accessKind!=="partner"||pm.memberType!=="cooperator"||
     pm.role!==ctx.role||pm.teamId!==ctx.teamId||
     pm.canViewRevenue!==false||pm.canViewUnitPrice!==false||
     pm.canCreateInvite===true||!displayName(pm.name)||
     staff.uid!==who.uid||staff.companyId!==partnerCompanyId||
     staff.kind!=="account"||staff.active!==true||
     staff.role!==ctx.role||staff.teamId!==ctx.teamId||
     rel.active!==true||rel.countSharingApproved!==true||
     rel.partnerCompanyId!==partnerCompanyId||rel.hubCompanyId!==oldCid)
   fail(HttpsError);
  const old=refs(oldCid,who.uid);
  const teamRef=path(partnerCompanyId,"partnerWorkTeams").doc(ctx.teamId);
  const [oldCompanySnap,oldMemberSnap,teamSnap]=await Promise.all([
   tx.get(old.internalCompany),tx.get(old.internalMember),tx.get(teamRef)
  ]);
  const oldCompany=oldCompanySnap.data()||{},member=oldMemberSnap.data()||{},
    team=teamSnap.data()||{};
  if(!oldCompanySnap.exists||!oldMemberSnap.exists||!teamSnap.exists||
     oldCompany.active===false||
     !["internal","direct"].includes(oldCompany.companyKind??"internal")||
     oldCompany.ownerUid===who.uid||oldCompany.masterUid===who.uid||
     member.active!==true||
     (member.uid!=null&&member.uid!==who.uid)||
     (member.companyId!=null&&member.companyId!==oldCid)||
     (member.companyRole!=null&&member.companyRole!=="member")||
     (member.role!=null&&!validRole(member.role))||
     (member.accessKind!=null&&member.accessKind!=="internal")||
     !internalType(member.memberType)||
     !sameEmail(member,who.email)||
     team.companyId!==partnerCompanyId||team.active!==true)
   fail(HttpsError);
  // A complete snapshot MUST fit well inside Firestore's 1 MiB doc cap.
  // Extra legacy user/member fields can be archived but not silently discarded.
  const approx=Buffer.byteLength(JSON.stringify({user,member,ctx}),"utf8");
  if(approx>500000)fail(HttpsError,"resource-exhausted");
  return {who,ctx,user,member,oldCid,partnerCompanyId,
   userRef,oldMemberRef:old.internalMember,ctxRef,archiveRef,
   partnerMember:pm,staff,team};
 }
 const write=(tx,s)=>{
  const stamp=FieldValue.serverTimestamp();
  const profile={
   uid:s.who.uid,companyId:s.partnerCompanyId,
   name:clean(s.partnerMember.name),email:s.who.email,
   role:s.ctx.role,companyRole:"member",teamId:s.ctx.teamId,
   active:true,accessKind:"partner",memberType:"cooperator",
   canViewRevenue:false,canViewUnitPrice:false,canCreateInvite:false,
   updatedAt:stamp
  };
  const cleanup={};
  for(const key of Object.keys(s.user)){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))fail(HttpsError);
   if(!Object.hasOwn(profile,key))cleanup[key]=FieldValue.delete();
  }
  // ONE atomic transaction: archive originals, disable old primary membership
  // and secondary context, and switch only the current user profile. The
  // existing partner member+staff already exist; neither is re-created.
  tx.create(s.archiveRef,{
   uid:s.who.uid,sourceCompanyId:s.oldCid,
   destinationCompanyId:s.partnerCompanyId,hubCompanyId:s.oldCid,
   originalUser:s.user,originalMember:s.member,originalContext:s.ctx,
   createdAt:stamp,kind:"primary_partner_handoff"
  });
  tx.update(s.oldMemberRef,{active:false,updatedAt:stamp});
  tx.update(s.ctxRef,{active:false,convertedToPrimaryAt:stamp});
  tx.update(s.userRef,{...cleanup,...profile});
 };
 async function preview(request){
  const who=await principal(request);
  const data=request?.data||{};
  if(Object.keys(data).join()!=="workspaceCompanyId"||!hasId(data.workspaceCompanyId))
   fail(HttpsError,"invalid-argument");
  return db.runTransaction(async tx=>{
   const s=await resolve(tx,who,data.workspaceCompanyId);
   return {eligible:true,needsExplicitConsent:true,
    partnerCompanyId:s.partnerCompanyId,
    sourceHistoryPreserved:true,
    sourceFinanceAccessClosurePending:true,
    countInputReverificationRequired:true};
  });
 }
 async function commit(request){
  const who=await principal(request),d=request?.data||{};
  if(Object.keys(d).sort().join()!=="consent,workspaceCompanyId"||
     d.consent!==CONSENT||!hasId(d.workspaceCompanyId))
   fail(HttpsError,"invalid-argument");
  return db.runTransaction(async tx=>{
   const s=await resolve(tx,who,d.workspaceCompanyId);
   write(tx,s);
   return {transferred:true,partnerCompanyId:s.partnerCompanyId,
    historyArchived:true,requiresFreshSignInAndCountVerification:true};
  });
 }
 return Object.freeze({preview,commit});
}
module.exports={buildService,CONSENT};
