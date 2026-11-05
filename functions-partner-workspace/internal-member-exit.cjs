"use strict";
/**
 * NO DEPLOY. Owner-only company exit, not account erasure.
 * Secondary partner access depends on original active primary membership:
 * refuse to deactivate either until a reviewed full-transfer process exists.
 * Preserve Auth UID, all records, prices, counts, corrections and teamHistory.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const isId=x=>typeof x==="string"&&ID.test(x);
const email=x=>typeof x==="string"?x.trim().toLowerCase():"";
function makeInternalMemberExit({db,getAuth,FieldValue,HttpsError,enabled=()=>false}={}){
 if(typeof db?.collection!=="function"||typeof getAuth!=="function"||
    typeof FieldValue?.serverTimestamp!=="function"||
    typeof HttpsError!=="function")throw Error("SAFE_EXIT_ADAPTER_MISSING");
 const reject=(code="permission-denied")=>{
  throw new HttpsError(code,"安全な所属情報を確認できませんでした。");
 };
 async function authorize(request){
  const uid=request?.auth?.uid;
  const bearer=request?.rawRequest?.headers?.authorization?.
   match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!isId(uid)||!bearer||request?.auth?.token?.email_verified!==true)
   reject("unauthenticated");
  let user,verified;
  try {
   [user,verified]=await Promise.all([
    getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)
   ]);
  }catch{reject("unauthenticated");}
  const expected=email(request.auth.token.email);
  if(!expected||user?.uid!==uid||user.disabled===true||
     user.emailVerified!==true||email(user.email)!==expected||
     verified?.uid!==uid||verified.email_verified!==true||
     email(verified.email)!==expected)reject("unauthenticated");
  return uid;
 }
 async function remove(request){
  if(enabled()!==true)reject("unavailable");
  const uid=await authorize(request),d=request?.data||{};
  if(!d||typeof d!=="object"||Array.isArray(d)||
     Object.keys(d).sort().join("|")!=="confirmed|memberId"||
     d.confirmed!==true||!isId(d.memberId)||d.memberId===uid)
    reject("invalid-argument");
  const targetId=d.memberId;
  return db.runTransaction(async tx=>{
   const userRef=db.collection("users").doc(uid);
   const userSnap=await tx.get(userRef),actor=userSnap.data()||{};
   const cid=actor.companyId;
   if(!userSnap.exists||actor.uid!==uid||!isId(cid)||
      actor.active!==true||actor.companyRole!=="owner"||
      ![undefined,"internal"].includes(actor.accessKind)||
      ![undefined,"internal","direct","member","managed"].includes(actor.memberType))
     reject();
   const companyRef=db.collection("companies").doc(cid);
   const ownerRef=companyRef.collection("members").doc(uid);
   const ownerContextRef=db.collection("partnerWorkspaceContexts").doc(uid);
   const [companySnap,ownerSnap,ownerContextSnap]=await Promise.all([
    tx.get(companyRef),tx.get(ownerRef),tx.get(ownerContextRef)
   ]);
   const company=companySnap.data()||{},owner=ownerSnap.data()||{};
   if(!companySnap.exists||!ownerSnap.exists||ownerContextSnap.exists||
      company.active!==true||
      ![undefined,"internal","direct"].includes(company.companyKind)||
      company.ownerUid!==uid||owner.companyRole!=="owner"||
      owner.active===false||
      (owner.uid!=null&&owner.uid!==uid)||
      (owner.companyId!=null&&owner.companyId!==cid))
     reject();
   const memberRef=companyRef.collection("members").doc(targetId);
   const targetRef=db.collection("users").doc(targetId);
   const ctxRef=db.collection("partnerWorkspaceContexts").doc(targetId);
   const archiveRef=db.collection("partnerHistoricalTransfers").doc(targetId);
   const [memberSnap,targetSnap,ctxSnap,archiveSnap]=await Promise.all([
    tx.get(memberRef),tx.get(targetRef),tx.get(ctxRef),tx.get(archiveRef)
   ]);
   const member=memberSnap.data()||{},target=targetSnap.data()||{};
   if(!memberSnap.exists||member.companyRole==="owner"||
      // Legacy master selection may exist even when the member role is stale.
      // Never revoke a master login through a regular member exit.
      company.masterUid===targetId||
      member.active===false||
      (member.uid!=null&&member.uid!==targetId)||
      (member.companyId!=null&&member.companyId!==cid))
     reject("failed-precondition");
   // Any present secondary context (even inactive) vetoes disabling the
   // original internal user OR member: both are required by partner scope.
   if(ctxSnap.exists)reject("failed-precondition");
   // A leftover historical-transfer archive with a direct root user
   // means the identity state is not settled. Never guess it is internal.
   if(archiveSnap.exists&&target.companyId===cid)
    reject("failed-precondition");
   let updateRoot=false,mode;
   if(targetSnap.exists){
    if(target.uid!==targetId||target.companyRole==="owner"||
       target.active!==true)reject("failed-precondition");
    if(target.companyId===cid){
     if(![undefined,"internal"].includes(target.accessKind)||
        ![undefined,"internal","direct","member","managed"].includes(target.memberType))
      reject("failed-precondition");
     updateRoot=true;mode="internal";
    }else{
     // Full transfer already changed root user to a partner identity.
     // Retire ONLY the stale old company member; keep partner login alive.
     const partnerId=target.companyId;
     if(!isId(partnerId)||target.accessKind!=="partner"||
        target.memberType!=="cooperator")reject("failed-precondition");
     const [partnerSnap,partnerMemberSnap,relationSnap]=await Promise.all([
      tx.get(db.collection("companies").doc(partnerId)),
      tx.get(db.collection("companies").doc(partnerId).collection("members").doc(targetId)),
      tx.get(db.collection("partnerRelations").doc(partnerId))
     ]);
     const partner=partnerSnap.data()||{},
      destinationMember=partnerMemberSnap.data()||{},
      relation=relationSnap.data()||{},
      archive=archiveSnap.data()||{};
     if(!partnerSnap.exists||!partnerMemberSnap.exists||
        !relationSnap.exists||!archiveSnap.exists||
        partner.active!==true||partner.companyKind!=="partner"||
        partner.hubCompanyId!==cid||
        destinationMember.uid!==targetId||
        destinationMember.companyId!==partnerId||
        destinationMember.active!==true||
        destinationMember.accessKind!=="partner"||
        destinationMember.memberType!=="cooperator"||
        relation.active!==true||relation.countSharingApproved!==true||
        relation.partnerCompanyId!==partnerId||relation.hubCompanyId!==cid||
        archive.uid!==targetId||archive.sourceCompanyId!==cid||
        archive.destinationCompanyId!==partnerId||
        archive.hubCompanyId!==cid||
        archive.originalUser?.companyId!==cid)
      reject("failed-precondition");
     mode="already_transferred";
    }
   }else{
    if(archiveSnap.exists||member.memberType!=="managed"&&member.hasAccount!==false)
     reject("failed-precondition");
    mode="managed";
   }
   // Every transaction read is complete before any update.
   const stamp=FieldValue.serverTimestamp();
   tx.update(memberRef,{active:false,updatedAt:stamp});
   if(updateRoot)tx.update(targetRef,{active:false,updatedAt:stamp});
   return {removed:true,memberId:targetId,mode,loginAccountDeleted:false};
  });
 }
 return Object.freeze({remove});
}
module.exports={makeInternalMemberExit};
