"use strict";
/**
 * Manual, opt-in count-only activation AFTER independent production safety
 * approval. Never changes a historical record, price, CB or existing team.
 * New partner company owners have teamId=null and relation.active=false until
 * this guarded transaction completes; no activation during invitation accept.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const HEX=/^[0-9a-f]{64}$/i;
const NAME=/^[\p{L}\p{N} 　・ー（）()_-]{2,40}$/u;
const clean=x=>typeof x==="string"?x.trim():"";
const fail=(HttpsError,reason="permission-denied")=>{
 throw new HttpsError(reason,"協力店の件数利用設定を確認できません。");
};
function makePartnerCountActivation({
 db,getAuth,FieldValue,HttpsError,enabled,releaseId
}={}){
 if(!db||typeof getAuth!=="function"||!FieldValue||!HttpsError||
    typeof enabled!=="function"||typeof releaseId!=="function")
   throw Error("activation_invalid_configuration");
 async function identity(request){
  if(enabled()!==true||!ID.test(clean(releaseId())))
   fail(HttpsError,"unavailable");
  const uid=request?.auth?.uid,email=clean(request?.auth?.token?.email).toLowerCase();
  if(!ID.test(uid)||!email||request.auth.token.email_verified!==true)
   fail(HttpsError,"unauthenticated");
  const bearer=request.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!bearer)fail(HttpsError,"unauthenticated");
  let account,verified;
  try{
   [account,verified]=await Promise.all([
    getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)
   ]);
  }catch{fail(HttpsError,"unauthenticated");}
  if(!account||account.disabled===true||account.emailVerified!==true||
    clean(account.email).toLowerCase()!==email||
    verified?.uid!==uid||verified?.email_verified!==true||
    clean(verified.email).toLowerCase()!==email)
    fail(HttpsError,"unauthenticated");
  return uid;
 }
 async function activate(request){
  const uid=await identity(request);
  const partnerId=clean(request?.data?.partnerCompanyId);
  const teamName=clean(request?.data?.teamName);
  if(!ID.test(partnerId)||!NAME.test(teamName)||
    /(?:[¥￥$€]|\d[\d,]*円|単価|売上|報酬|利益)/i.test(teamName))
    fail(HttpsError,"invalid-argument");
  const userRef=db.collection("users").doc(uid);
  const partnerRef=db.collection("companies").doc(partnerId);
  const relationRef=db.collection("partnerRelations").doc(partnerId);
  const approvalRef=db.collection("partnerCountOnboardingApprovals").doc(partnerId);
  const teamRef=db.collection("teams").doc("partner_"+partnerId);
  const auditRef=db.collection("partnerCountActivationAudits").doc(partnerId);
  let output;
  await db.runTransaction(async tx=>{
   const [actorSnap,pSnap,relSnap,approvalSnap,teamSnap,auditSnap]=
     await Promise.all([
      tx.get(userRef),tx.get(partnerRef),tx.get(relationRef),
      tx.get(approvalRef),tx.get(teamRef),tx.get(auditRef)
     ]);
   if(!actorSnap.exists||!pSnap.exists||!relSnap.exists||
      !approvalSnap.exists||teamSnap.exists||auditSnap.exists)
     fail(HttpsError,"failed-precondition");
   const actor=actorSnap.data()||{},partner=pSnap.data()||{},
     relation=relSnap.data()||{},approval=approvalSnap.data()||{};
   if(!ID.test(actor.companyId)||actor.companyId===partnerId||
      actor.active===false||actor.companyRole!=="owner"||
      actor.accessKind==="partner"||actor.memberType==="cooperator"||
      partner.companyKind!=="partner"||partner.active!==true||
      partner.hubCompanyId!==actor.companyId||!ID.test(partner.ownerUid)||
            relation.hubCompanyId!==actor.companyId||
      relation.partnerCompanyId!==partnerId||
      relation.active!==false||
      relation.countSharingApproved!==false||
      relation.catalogAccessApproved!==false)
     fail(HttpsError);
   const hubRef=db.collection("companies").doc(actor.companyId);
   const actorMemberRef=hubRef.collection("members").doc(uid);
   const partnerOwnerRef=db.collection("users").doc(partner.ownerUid);
   const partnerMemberRef=partnerRef.collection("members").doc(partner.ownerUid);
   const [hubSnap,actorMemberSnap,ownerSnap,ownerMemberSnap,secondarySnap]=
     await Promise.all([
      tx.get(hubRef),tx.get(actorMemberRef),
      tx.get(partnerOwnerRef),tx.get(partnerMemberRef),
       tx.get(db.collection("partnerWorkspaceContexts").doc(partner.ownerUid))
     ]);
   const hub=hubSnap.data()||{},am=actorMemberSnap.data()||{},
     owner=ownerSnap.data()||{},om=ownerMemberSnap.data()||{},
      secondary=secondarySnap.data()||{};
    const secondaryOwner=secondarySnap.exists;
    const secondaryValid=secondaryOwner&&secondarySnap.exists&&
      secondary.kind==="partner_secondary"&&secondary.active===true&&
      secondary.uid===partner.ownerUid&&
      ID.test(secondary.primaryCompanyId)&&
      secondary.partnerCompanyId===partnerId&&
      secondary.hubCompanyId===actor.companyId&&secondary.role==="owner"&&
      secondary.emailLower===clean(owner.email).toLowerCase()&&
      owner.uid===partner.ownerUid&&owner.companyId===secondary.primaryCompanyId&&
      (owner.accessKind==null||owner.accessKind==="internal")&&
      (owner.memberType==null||["internal","direct","member","managed"].includes(owner.memberType));
   if(!hubSnap.exists||hub.active!==true||
      (hub.companyKind!=null&&!["internal","direct"].includes(hub.companyKind))||
      hub.ownerUid!==uid||!actorMemberSnap.exists||
      am.companyRole!=="owner"||am.active!==true||
      am.accessKind==="partner"||am.memberType==="cooperator"||
      !ownerSnap.exists||!ownerMemberSnap.exists||
      owner.uid!==partner.ownerUid||om.uid!==partner.ownerUid||
      (!secondaryOwner&&owner.companyId!==partnerId)||
       (secondaryOwner&&!secondaryValid)||om.companyId!==partnerId||
      owner.active!==true||om.active!==true||
      (!secondaryOwner&&owner.accessKind!=="partner")||om.accessKind!=="partner"||
      (!secondaryOwner&&owner.memberType!=="cooperator")||om.memberType!=="cooperator"||
      (!secondaryOwner&&owner.companyRole!=="owner")||om.companyRole!=="owner"||
      (!secondaryOwner&&owner.role!=="leader")||om.role!=="leader"||
      (!secondaryOwner&&owner.canViewRevenue!==false)||om.canViewRevenue!==false||
      (!secondaryOwner&&owner.canViewUnitPrice!==false)||om.canViewUnitPrice!==false||
      (!secondaryOwner&&owner.teamId!=null)||om.teamId!=null)
     fail(HttpsError);
   // Approval is an ADMIN-only artifact from completed backup/restore,
   // full source-to-projection comparison, locked financial Rules and catalog.
   // It is NOT accepted from the browser or inferred from a successful test.
   if(approval.partnerCompanyId!==partnerId||
      approval.hubCompanyId!==actor.companyId||
      approval.approvedByUid!==uid||
      approval.releaseId!==releaseId()||
      approval.restoreVerified!==true||
      approval.financeRulesVerified!==true||
      approval.catalogVerified!==true||
      approval.projectionVerified!==true||
      !HEX.test(approval.backupDigest)||
      !HEX.test(approval.projectionDigest))
     fail(HttpsError,"failed-precondition");
   const now=FieldValue.serverTimestamp();
   tx.create(teamRef,{
     companyId:partnerId,name:teamName,leaderUids:[partner.ownerUid],
     active:true,createdAt:now
   });
   if(!secondaryOwner){
     tx.update(partnerOwnerRef,{teamId:teamRef.id,updatedAt:now});
     tx.update(partnerMemberRef,{teamId:teamRef.id,updatedAt:now});
   }
   // Secondary partner access never modifies the original user or its team.
   tx.update(relationRef,{
     active:true,countSharingApproved:true,catalogAccessApproved:true,
     updatedAt:now
   });
   tx.create(auditRef,{
     hubCompanyId:actor.companyId,partnerCompanyId:partnerId,
     approvedByUid:uid,partnerOwnerUid:partner.ownerUid,
     teamId:teamRef.id,releaseId:releaseId(),
     backupDigest:approval.backupDigest,
     projectionDigest:approval.projectionDigest,
     activatedAt:now
   });
   output={partnerCompanyId:partnerId,teamId:teamRef.id,
     countReportingEnabled:true};
  });
  return output;
 }
 return Object.freeze({activate});
}
module.exports={makePartnerCountActivation};
