"use strict";

/**
 * Standalone partner invitation callables. Does not alter legacy employee
 * invites, financial originals, or an existing company/user membership.
 * All APIs are OFF unless PARTNER_INVITES_ENABLED=enabled is explicitly set
 * in a separately reviewed Firebase Functions deployment.
 */
const crypto=require("node:crypto");
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const clean=x=>typeof x==="string"?x.trim():"";
const normalizeEmail=x=>clean(x).toLowerCase();
const bad=()=>{throw Error("partner_invite_invalid");};
const isInternal=x=>x==null||["internal","direct"].includes(x);
const isNonPartner=x=>isInternal(x?.accessKind)&&
  (x?.memberType==null||["internal","direct","member","managed"].includes(x.memberType));
function requireFactory({db,getAuth,Timestamp,FieldValue,HttpsError,enabled,now}){
 if(!db||typeof getAuth!=="function"||!Timestamp||!FieldValue||!HttpsError||
   typeof enabled!=="function"||typeof now!=="function")bad();
 const fail=(reason="permission-denied")=>{throw new HttpsError(reason,"協力店招待を確認できません。");};
 const ensureEnabled=()=>{if(enabled()!==true)fail("unavailable");};
 async function identity(request){
  ensureEnabled();
  const uid=request?.auth?.uid,email=normalizeEmail(request?.auth?.token?.email);
  if(typeof uid!=="string"||!ID.test(uid)||!EMAIL.test(email)||
     request.auth.token.email_verified!==true)fail("unauthenticated");
  const bearer=request.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!bearer)fail("unauthenticated");
  let fresh,verified;
  try {
   [fresh,verified]=await Promise.all([
    getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)
   ]);
  }catch{fail("unauthenticated");}
  if(!fresh||fresh.disabled===true||fresh.emailVerified!==true||
     normalizeEmail(fresh.email)!==email||verified?.uid!==uid||
     verified?.email_verified!==true||normalizeEmail(verified.email)!==email)
    fail("unauthenticated");
  return {uid,email,displayName:clean(fresh.displayName).slice(0,70)||"担当者"};
 }
 async function hubOwner(tx,companyId,uid){
  if(!ID.test(companyId))fail();
  const companyRef=db.collection("companies").doc(companyId);
  const userRef=db.collection("users").doc(uid);
  const memberRef=companyRef.collection("members").doc(uid);
  const [companySnap,userSnap,memberSnap]=await Promise.all([
    tx.get(companyRef),tx.get(userRef),tx.get(memberRef)
  ]);
  const company=companySnap.data()||{},user=userSnap.data()||{},
    member=memberSnap.data()||{};
  if(!companySnap.exists||!userSnap.exists||!memberSnap.exists||
     company.active!==true||!isInternal(company.companyKind)||
     company.ownerUid!==uid||user.companyId!==companyId||
     user.active===false||member.active!==true||
     user.companyRole!=="owner"||member.companyRole!=="owner"||
     !isNonPartner(user)||!isNonPartner(member))fail();
  return company;
 }
 const inviteRef=()=>db.collection("partnerCompanyInvitations");
 const hashToken=token=>{
  if(!TOKEN.test(token))fail("invalid-argument");
  return crypto.createHash("sha256").update(token).digest("hex");
 };
 async function findInvite(token){
  const digest=hashToken(token);
  const results=await inviteRef().where("tokenHash","==",digest).limit(2).get();
  if(results.size!==1)fail("not-found");
  return results.docs[0].ref;
 }
 const validInvitation=(data,email)=>{
  if(!data||data.kind!=="partner_company"||data.status!=="pending"||
     !ID.test(data.hubCompanyId)||!ID.test(data.invitedBy)||
     normalizeEmail(data.emailLower)!==email||
     typeof data.expiresAt?.toMillis!=="function"||
     data.expiresAt.toMillis()<=now()||data.canViewRevenue!==false||
     data.canViewUnitPrice!==false)fail("failed-precondition");
 };
 async function create(request){
  const actor=await identity(request);
  const recipientEmail=normalizeEmail(request?.data?.email);
  const partnerName=clean(request?.data?.companyName).replace(/\s+/g," ");
  if(!EMAIL.test(recipientEmail)||recipientEmail.length>254||
     partnerName.length<2||partnerName.length>80)
    fail("invalid-argument");
  const token=crypto.randomBytes(32).toString("base64url");
  // 24h single-use, addressed-email-bound, verified-auth invitation. Previously 30 minutes.
  const tokenHash=hashToken(token),expiresAt=Timestamp.fromMillis(now()+24*60*60*1000);
  const ref=inviteRef().doc();
  await db.runTransaction(async tx=>{
   const userSnap=await tx.get(db.collection("users").doc(actor.uid));
   if(!userSnap.exists||!ID.test(userSnap.data()?.companyId))fail();
   const hubCompanyId=userSnap.data().companyId;
   await hubOwner(tx,hubCompanyId,actor.uid);
   tx.create(ref,{
    kind:"partner_company",hubCompanyId,partnerCompanyName:partnerName,
    emailLower:recipientEmail,invitedBy:actor.uid,
    tokenHash,status:"pending",canViewRevenue:false,canViewUnitPrice:false,
    createdAt:FieldValue.serverTimestamp(),expiresAt
   });
  });
  return {token,expiresAt:expiresAt.toMillis(),kind:"partner_company"};
 }
 async function preview(request){
  const actor=await identity(request);
  const ref=await findInvite(clean(request?.data?.token));
  const invite= (await ref.get()).data();
  validInvitation(invite,actor.email);
  const company=(await db.collection("companies").doc(invite.hubCompanyId).get()).data();
  if(!company||company.active!==true||!isInternal(company.companyKind))fail();
  return {kind:"partner_company",fromCompanyName:clean(company.name).slice(0,80),
   partnerCompanyName:invite.partnerCompanyName,expiresAt:invite.expiresAt.toMillis()};
 }
 async function accept(request){
  const actor=await identity(request);
  const ref=await findInvite(clean(request?.data?.token));
  const newRef=db.collection("companies").doc();
  const memberRef=newRef.collection("members").doc(actor.uid);
  const relationRef=db.collection("partnerRelations").doc(newRef.id);
  const userRef=db.collection("users").doc(actor.uid);
  // Secondary association never rewrites a previously assigned primary
  // company, users/{uid}, a historical team or its financial privileges.
  const contextRef=db.collection("partnerWorkspaceContexts").doc(actor.uid);
  let result;
  await db.runTransaction(async tx=>{
   const [inviteSnap,userSnap,companySnap,relationSnap,memberSnap,contextSnap]=await Promise.all([
    tx.get(ref),tx.get(userRef),tx.get(newRef),tx.get(relationRef),tx.get(memberRef),
    tx.get(contextRef)
   ]);
   if(!inviteSnap.exists||companySnap.exists||relationSnap.exists||memberSnap.exists)fail();
   const invite=inviteSnap.data()||{};
   validInvitation(invite,actor.email);
   const user=userSnap.exists?(userSnap.data()||{}):{};
   if(user.active===false||contextSnap.exists||
      (userSnap.exists&&user.uid!=null&&user.uid!==actor.uid)||
      (userSnap.exists&&user.email&&normalizeEmail(user.email)!==actor.email))
     fail("failed-precondition");
   const secondaryCompanyId=clean(user.companyId);
   // A prior email with an existing company is a SECONDARY partner login,
   // not a transfer. Check the user's existing primary membership and markers
   // inside the same transaction; never infer them from email alone.
   if(secondaryCompanyId){
     if(!ID.test(secondaryCompanyId)||secondaryCompanyId===newRef.id)
       fail("failed-precondition");
     const [primaryCompanySnap,primaryMemberSnap]=await Promise.all([
       tx.get(db.collection("companies").doc(secondaryCompanyId)),
       tx.get(db.collection("companies").doc(secondaryCompanyId)
         .collection("members").doc(actor.uid))
     ]);
     const pc=primaryCompanySnap.data()||{},pm=primaryMemberSnap.data()||{};
     if(!primaryCompanySnap.exists||!primaryMemberSnap.exists||
        pc.active===false||pc.companyKind==="partner"||
        (pc.companyKind!=null&&!["internal","direct"].includes(pc.companyKind))||
        pm.active===false||pm.uid!=null&&pm.uid!==actor.uid||
        pm.companyId!=null&&pm.companyId!==secondaryCompanyId||
        (pm.accessKind!=null&&pm.accessKind!=="internal")||
        (user.accessKind!=null&&user.accessKind!=="internal")||
        ["partner","cooperator"].includes(pm.memberType)||
        ["partner","cooperator"].includes(user.memberType))
       fail("failed-precondition");
   }
   // Owner must still be the authorized hub owner at acceptance time.
   await hubOwner(tx,invite.hubCompanyId,invite.invitedBy);
   const time=FieldValue.serverTimestamp();
   tx.create(newRef,{
    name:invite.partnerCompanyName,ownerUid:actor.uid,masterUid:actor.uid,
    companyKind:"partner",hubCompanyId:invite.hubCompanyId,active:true,
    createdBy:actor.uid,createdAt:time,updatedAt:time
   });
   tx.create(memberRef,{
    uid:actor.uid,companyId:newRef.id,
    name:clean(user.name).slice(0,70)||actor.displayName,
    email:actor.email,role:"leader",companyRole:"owner",teamId:null,
    memberType:"cooperator",accessKind:"partner",active:true,
    canViewRevenue:false,canViewUnitPrice:false,canCreateInvite:false,
    joinedAt:time,updatedAt:time
   });
   tx.create(relationRef,{
    partnerCompanyId:newRef.id,hubCompanyId:invite.hubCompanyId,
    active:false,countSharingApproved:false,catalogAccessApproved:false,
    createdAt:time,updatedAt:time
   });
   if(secondaryCompanyId){
     // Only this new server-owned context is created. Existing internal
     // users/{uid}, primary membership and source history remain byte-identical.
     tx.create(contextRef,{
       uid:actor.uid,primaryCompanyId:secondaryCompanyId,
       partnerCompanyId:newRef.id,hubCompanyId:invite.hubCompanyId,
       emailLower:actor.email,role:"owner",kind:"partner_secondary",
       active:true,createdAt:time
     });
   }else{
     tx.set(userRef,{
       uid:actor.uid,name:clean(user.name).slice(0,70)||actor.displayName,
       email:actor.email,companyId:newRef.id,
       role:"leader",companyRole:"owner",teamId:null,
       memberType:"cooperator",accessKind:"partner",active:true,
       canViewRevenue:false,canViewUnitPrice:false,canCreateInvite:false,
       companySetupVersion:1,updatedAt:time
     },{merge:true});
   }
   tx.update(ref,{status:"accepted",acceptedBy:actor.uid,acceptedAt:time});
   result={partnerCompanyId:newRef.id,kind:"partner_company",
    secondaryMembership:Boolean(secondaryCompanyId),
    countReportingEnabled:false,financialAccess:false};
  });
  return result;
 }
 return Object.freeze({create,preview,accept});
}
module.exports={requireFactory};
