"use strict";
/**
 * NO DEPLOY. Authenticated SELF-only account removal, deliberately isolated
 * from partner/member administrative removal. No callable that deletes a
 * different UID. Never deletes financial records, products or team history.
 *
 * A partner-secondary context and a historical transfer archive are both
 * absolute vetoes, even if inactive. A partner primary account is also
 * disallowed: its cross-company relations must be handled separately.
 * The Firestore active=false transaction is the concurrency barrier:
 * partner invite acceptance also reads users/{uid}, so simultaneous accepts
 * conflict/retry and cannot create a new secondary partner login in between.
 *
 * If the final Admin Auth delete fails, active=false is retained as a safe
 * lock; do not claim success, and require owner recovery/review. Enabling
 * this requires tested failure recovery and a signed production review.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const isId=x=>typeof x==="string"&&ID.test(x);
const mail=x=>typeof x==="string"?x.trim().toLowerCase():"";
function makeInternalSelfAccountExit({
 db,getAuth,FieldValue,HttpsError,enabled=()=>false,nowSeconds=()=>Math.floor(Date.now()/1000)
}={}){
 if(typeof db?.collection!=="function"||typeof db?.runTransaction!=="function"||
    typeof getAuth!=="function"||typeof FieldValue?.serverTimestamp!=="function"||
    typeof HttpsError!=="function"||typeof nowSeconds!=="function")
  throw Error("SELF_EXIT_DEPENDENCIES_MISSING");
 const fail=(code="permission-denied")=>{
  throw new HttpsError(code,"アカウント削除の安全確認ができませんでした。");
 };
 async function remove(request){
  if(enabled()!==true)fail("unavailable");
  const uid=request?.auth?.uid,data=request?.data;
  if(!isId(uid)||!data||typeof data!=="object"||Array.isArray(data)||
     Object.keys(data).sort().join("|")!=="confirmed"||data.confirmed!==true)
   fail("invalid-argument");
  const authorization=request?.rawRequest?.headers?.authorization;
  const bearer=typeof authorization==="string"?
   authorization.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1]:null;
  if(!bearer||request?.auth?.token?.email_verified!==true)fail("unauthenticated");
  let a,token;
  const auth=getAuth();
  if(typeof auth?.getUser!=="function"||
     typeof auth?.verifyIdToken!=="function"||
     typeof auth?.deleteUser!=="function")fail("unavailable");
  try{
   [a,token]=await Promise.all([
    auth.getUser(uid),auth.verifyIdToken(bearer,true)
   ]);
  }catch{fail("unauthenticated");}
  const email=mail(request.auth.token.email);
  const now=nowSeconds();
  // This call MUST immediately follow the client's password reauth.
  if(!email||a?.uid!==uid||a.disabled===true||a.emailVerified!==true||
     mail(a.email)!==email||token?.uid!==uid||
     token.email_verified!==true||mail(token.email)!==email||
     !Number.isSafeInteger(now)||!Number.isSafeInteger(token.auth_time)||
     token.auth_time>now||now-token.auth_time>300)fail("unauthenticated");
  await db.runTransaction(async tx=>{
   const ref=db.collection("users").doc(uid);
   const userSnap=await tx.get(ref),user=userSnap.data()||{};
   const cid=user.companyId;
   if(!userSnap.exists||user.uid!==uid||!isId(cid)||
      user.active!==true||user.companyRole!=="member"||
      ![undefined,"internal"].includes(user.accessKind)||
      ![undefined,"internal","direct","member","managed"].includes(user.memberType))
     fail("failed-precondition");
   const memberRef=db.collection("companies").doc(cid).collection("members").doc(uid);
   const companyRef=db.collection("companies").doc(cid);
   const secondaryRef=db.collection("partnerWorkspaceContexts").doc(uid);
   const transferRef=db.collection("partnerHistoricalTransfers").doc(uid);
   const [memberSnap,companySnap,secondarySnap,archiveSnap]=await Promise.all([
    tx.get(memberRef),tx.get(companyRef),tx.get(secondaryRef),tx.get(transferRef)
   ]);
   const member=memberSnap.data()||{},company=companySnap.data()||{};
   if(!memberSnap.exists||!companySnap.exists||
      secondarySnap.exists||archiveSnap.exists||
      company.active!==true||
      ![undefined,"internal","direct"].includes(company.companyKind)||
      company.ownerUid===uid||company.masterUid===uid||
      member.active!==true||member.companyRole!=="member"||
      (member.uid!=null&&member.uid!==uid)||
      (member.companyId!=null&&member.companyId!==cid)||
      ![undefined,"internal"].includes(member.accessKind)||
      ![undefined,"internal","direct","member","managed"].includes(member.memberType))
     fail("failed-precondition");
   const stamp=FieldValue.serverTimestamp();
   // Atomic lock: any concurrent partner-join transaction touching users
   // now conflicts. Nothing money-bearing or historic is deleted/modified.
   tx.update(ref,{
    active:false,accountRemovalStatus:"auth_pending",
    accountRemovalRequestedAt:stamp,updatedAt:stamp
   });
   tx.update(memberRef,{active:false,updatedAt:stamp});
  });
  try{
   await auth.deleteUser(uid);
  }catch{
   // Do not unlock an account after an ambiguous external Auth failure:
   // deleteUser() may have succeeded on the server before transport failed.
   // Flagged root user is safely quarantined for human-assisted recovery.
   fail("internal");
  }
  return {deleted:true,uid,financeAndHistoryPreserved:true};
 }
 return Object.freeze({remove});
}
module.exports={makeInternalSelfAccountExit};
