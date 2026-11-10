/**
 * STAGING ONLY / NO ROUTE / NO DEPLOY.
 * Write exactly ONE company's separate ranking consent when its currently
 * authenticated real Firebase Owner authorizes (or revokes) publication.
 *
 * The hub owner cannot approve for a partner; a partner owner cannot approve
 * for the hub. The partnerRelations flags are mirrors only, never proof alone.
 * No financial documents, old sales, invitations, counts or memberships are
 * updated. An append-only audit preserves every actual change.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const stop=()=>{throw Error("RANKING_OWNER_CONSENT_NOT_AUTHORIZED_OR_STALE");};
const id=v=>typeof v==="string"&&ID.test(v)&&
 !["__proto__","prototype","constructor"].includes(v);
const obj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const doc=s=>s?.exists===true&&typeof s.data==="function"?s.data():null;
const internal=x=>x==null||x==="internal";
const typeInternal=x=>x==null||["internal","direct","member","managed"].includes(x);
function ownerVerified({auth,user,member,company,companyId}){
 if(!obj(user)||!obj(member)||!obj(company)||
    user.uid!==auth.uid||member.uid!==auth.uid||
    user.companyId!==companyId||
    (member.companyId!=null&&member.companyId!==companyId)||
    user.companyRole!=="owner"||member.companyRole!=="owner"||
    company.ownerUid!==auth.uid||user.active!==true||
    member.active!==true||company.active===false||
    (typeof user.email==="string"&&
      user.email.trim().toLowerCase()!==auth.email.trim().toLowerCase()))stop();
 if(company.companyKind==="partner"){
  if(user.accessKind!=="partner"||member.accessKind!=="partner"||
     user.memberType!=="cooperator"||member.memberType!=="cooperator"||
     user.canViewRevenue!==false||member.canViewRevenue!==false||
     user.canViewUnitPrice!==false||member.canViewUnitPrice!==false||
     user.authKind==="partner_code_shared")stop();
 }else if(!["internal","direct",undefined].includes(company.companyKind)||
          !internal(user.accessKind)||!internal(member.accessKind)||
          !typeInternal(user.memberType)||!typeInternal(member.memberType))
  stop();
}
function priorVersion(s){
 if(!s?.exists)return 0;
 const d=doc(s);
 if(!obj(d)||d.scope!=="combined_rank_only"||
    !Number.isSafeInteger(d.version)||d.version<1||d.version>998)
   stop();
 return d.version;
}
export function createRankingOwnerConsentService({db,FieldValue}={}){
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function"||
    !FieldValue||typeof FieldValue.serverTimestamp!=="function")
  throw Error("ranking consent server-only dependencies missing");
 return async function setOwnerRankingConsent({
  auth,partnerCompanyId,enable,expectedVersion
 }={}){
  if(!id(auth?.uid)||auth.emailVerified!==true||
     typeof auth.email!=="string"||!EMAIL.test(auth.email)||
     !id(partnerCompanyId)||typeof enable!=="boolean"||
     !Number.isSafeInteger(expectedVersion)||expectedVersion<0||
     expectedVersion>998)stop();
  const companies=id=>db.collection("companies").doc(id);
  const users=db.collection("users").doc(auth.uid);
  return db.runTransaction(async tx=>{
   const [userSnap,secondarySnap]=await Promise.all([
    tx.get(users),tx.get(db.collection("partnerWorkspaceContexts").doc(auth.uid))
   ]);
   const user=doc(userSnap),secondary=doc(secondarySnap);
   if(!obj(user)||!id(user.companyId)||
      (secondarySnap.exists&&secondary?.active!==false))stop();
   const companyId=user.companyId;
   const [viewerSnap,memberSnap]=await Promise.all([
    tx.get(companies(companyId)),
    tx.get(companies(companyId).collection("members").doc(auth.uid))
   ]);
   const viewer=doc(viewerSnap);
   ownerVerified({auth,user,member:doc(memberSnap),company:viewer,companyId});
   const partnerViewer=viewer.companyKind==="partner";
   const hubId=partnerViewer?viewer.hubCompanyId:companyId;
   if(!id(hubId)||hubId===partnerCompanyId&&partnerViewer===false||
      partnerViewer&&companyId!==partnerCompanyId)stop();
   const [hubSnap,partnerSnap,relationSnap]=await Promise.all([
    tx.get(companies(hubId)),tx.get(companies(partnerCompanyId)),
    tx.get(db.collection("partnerRelations").doc(partnerCompanyId))
   ]);
   const hub=doc(hubSnap),partner=doc(partnerSnap),rel=doc(relationSnap);
   // Hub-approved partner workspaces are often created before a distinct
   // email Owner has accepted an invitation. The Hub Owner may approve
   // ONLY the Hub's own side; the absent Partner Owner can NEVER consent.
   const partnerOwnerUnclaimed=partner.ownerUid==null||partner.ownerUid==="";
   if(!obj(hub)||!obj(partner)||!obj(rel)||!id(hub.ownerUid)||
      (!partnerOwnerUnclaimed&&!id(partner.ownerUid))||
      (partnerViewer&&partnerOwnerUnclaimed)||hub.active===false||
      ![undefined,"internal","direct"].includes(hub.companyKind)||
      partner.active!==true||partner.companyKind!=="partner"||
      partner.hubCompanyId!==hubId||
      rel.hubCompanyId!==hubId||rel.partnerCompanyId!==partnerCompanyId||
      rel.active!==true||rel.countSharingApproved!==true)stop();
   if(partnerViewer?partner.ownerUid!==auth.uid:hub.ownerUid!==auth.uid)
    stop();
   const approvalRef=companies(companyId).collection("rankingApprovals")
    .doc(partnerViewer?hubId:partnerCompanyId);
   const [consentSnap,partnerConsentSnap]=await Promise.all([
    tx.get(approvalRef),
    ...(!partnerViewer&&partnerOwnerUnclaimed?[
     tx.get(companies(partnerCompanyId).collection("rankingApprovals").doc(hubId))
    ]:[])
   ]);
   // Never ignore fabricated or orphaned Partner-side approvals on an
   // unclaimed workspace, even when the request comes from a real Hub Owner.
   if(partnerOwnerUnclaimed&&(
      partnerConsentSnap?.exists===true||
      rel.combinedRankingApprovedByPartner===true||
      rel.individualNamesApprovedByPartner===true))stop();
   const old=doc(consentSnap),version=priorVersion(consentSnap);
   if(version!==expectedVersion)stop();
   const side=partnerViewer?"Partner":"Hub";
   const flag="combinedRankingApprovedBy"+side;
   const nameFlag="individualNamesApprovedBy"+side;
   const oldEnabled=old?.active===true&&
      old?.combinedRankingApproved===true&&
      old?.individualNamesApproved===true;
   if(old){
    if(old.companyId!==companyId||old.hubCompanyId!==hubId||
       old.partnerCompanyId!==partnerCompanyId||
       old.approvedByUid!==auth.uid)stop();
    if((rel[flag]===true)!==oldEnabled||
       (rel[nameFlag]===true)!==oldEnabled)stop();
   }else if(rel[flag]===true||rel[nameFlag]===true)stop();
   // No need to write a new Audit for repeated same-state actions, but
   // if old document is missing disabling must be an explicit version 1.
   if(old&&oldEnabled===enable)
    return {saved:false,partnerCompanyId,enabled:enable,version};
   const stamp=FieldValue.serverTimestamp(),nextVersion=version+1;
   const newConsent={
    companyId,hubCompanyId:hubId,partnerCompanyId,
    approvedByUid:auth.uid,active:enable,
    scope:"combined_rank_only",version:nextVersion,
    combinedRankingApproved:enable,individualNamesApproved:enable,
    updatedAt:stamp
   };
   if(consentSnap.exists)tx.update(approvalRef,newConsent);
   else tx.create(approvalRef,{...newConsent,createdAt:stamp});
   tx.update(db.collection("partnerRelations").doc(partnerCompanyId),{
    [flag]:enable,[nameFlag]:enable,rankingApprovalUpdatedAt:stamp
   });
   // Only server-side write creates append-only provenance. No amount data.
   const audit=companies(companyId).collection("rankingApprovalAudits").doc();
   tx.create(audit,{
    companyId,hubCompanyId:hubId,partnerCompanyId,
    approvedByUid:auth.uid,previousVersion:version,version:nextVersion,
    previousApproved:oldEnabled,approved:enable,
    createdAt:stamp,kind:"combined_rank_only"
   });
   return {saved:true,partnerCompanyId,enabled:enable,version:nextVersion};
  });
 };
}
