/**
 * STAGING ONLY / NO DEPLOY — the owner panel's FRESH server status source.
 * Requires a real verified Firebase Auth principal (see
 * createVerifiedRankTokenReader). No browser proof, company IDs or roles.
 * One read-only Admin Firestore transaction. No financial collections read.
 *
 * Includes unapproved companies so both owners can opt in independently.
 * Only the actual owner may view the associated company's status and version.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONEY=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|cashback)\s*[:=_-]?\s*[0-9０-９]|\d[\d,.]*円)/i;
const STOP=()=>{throw Error("RANKING_OWNER_STATUS_UNAUTHORIZED_OR_INCOMPLETE");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const doc=s=>s?.exists===true&&typeof s.data==="function"?s.data():null;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const oldType=x=>x==null||["internal","direct","member","managed"].includes(x);
const oldAccess=x=>x==null||x==="internal";
const hubKind=x=>x==null||x==="internal"||x==="direct";
const name=x=>typeof x==="string"&&x.trim().length>0&&x.length<=80&&!MONEY.test(x);
function owner({uid,email,user,member,company,companyId}){
 if(!obj(user)||!obj(member)||!obj(company)||
    user.uid!==uid||member.uid!==uid||user.companyId!==companyId||
    (member.companyId!=null&&member.companyId!==companyId)||
    user.companyRole!=="owner"||member.companyRole!=="owner"||
    user.active!==true||member.active!==true||company.active===false||
    company.ownerUid!==uid||
    (typeof user.email==="string"&&user.email.trim().toLowerCase()!==email))
  STOP();
 const partner=company.companyKind==="partner";
 if(partner){
  if(!id(company.hubCompanyId)||user.authKind==="partner_code_shared"||
     member.authKind==="partner_code_shared"||
     user.accessKind!=="partner"||member.accessKind!=="partner"||
     user.memberType!=="cooperator"||member.memberType!=="cooperator"||
     user.canViewRevenue!==false||member.canViewRevenue!==false||
     user.canViewUnitPrice!==false||member.canViewUnitPrice!==false)STOP();
 }else if(!hubKind(company.companyKind)||
   !oldAccess(user.accessKind)||!oldAccess(member.accessKind)||
   !oldType(user.memberType)||!oldType(member.memberType))STOP();
 return partner;
}
function checkedApproval(s,{companyId,hubId,partnerId,ownerUid}){
 const x=doc(s);
 if(!s?.exists)return {approved:false,version:0};
 if(!obj(x)||x.companyId!==companyId||
    x.hubCompanyId!==hubId||x.partnerCompanyId!==partnerId||
    x.approvedByUid!==ownerUid||x.scope!=="combined_rank_only"||
    !Number.isSafeInteger(x.version)||x.version<1||x.version>999||
    typeof x.active!=="boolean"||
    typeof x.combinedRankingApproved!=="boolean"||
    typeof x.individualNamesApproved!=="boolean"||
    x.active!==x.combinedRankingApproved||
    x.active!==x.individualNamesApproved)STOP();
 return {approved:x.active,version:x.version};
}
function matchFlags(rel,hub,partner){
 if((rel.combinedRankingApprovedByHub===true)!==hub.approved||
    (rel.individualNamesApprovedByHub===true)!==hub.approved||
    (rel.combinedRankingApprovedByPartner===true)!==partner.approved||
    (rel.individualNamesApprovedByPartner===true)!==partner.approved)STOP();
}
/**
 * @param db Firebase Admin Firestore, never a browser client.
 * Returns exact fields consumed by the client-only owner settings panel.
 * Status alone never grants leaderboard access or write authorization.
 */
export function createOwnerRankingConsentStatusReader({db}={}){
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function")
  throw Error("ranking owner server Firestore dependency missing");
 const root=x=>db.collection(x);
 const company=id=>root("companies").doc(id);
 return async function loadOwnerRankingConsentStatus(auth){
  if(!id(auth?.uid)||auth.emailVerified!==true||
     typeof auth.email!=="string"||
     !EMAIL.test(auth.email.toLowerCase()))STOP();
  return db.runTransaction(async tx=>{
   const [userSnap,secondarySnap]=await Promise.all([
    tx.get(root("users").doc(auth.uid)),
    tx.get(root("partnerWorkspaceContexts").doc(auth.uid))
   ]);
   const profile=doc(userSnap),secondary=doc(secondarySnap);
   if(!obj(profile)||!id(profile.companyId)||
      (secondarySnap.exists&&secondary?.active!==false))STOP();
   const viewerId=profile.companyId;
   const [viewerSnap,memberSnap]=await Promise.all([
    tx.get(company(viewerId)),
    tx.get(company(viewerId).collection("members").doc(auth.uid))
   ]);
   const viewer=doc(viewerSnap);
   const partnerViewer=owner({
    uid:auth.uid,email:auth.email.trim().toLowerCase(),
    user:profile,member:doc(memberSnap),company:viewer,companyId:viewerId
   });
   const hubId=partnerViewer?viewer.hubCompanyId:viewerId;
   if(!id(hubId))STOP();
   const hubSnap=partnerViewer?await tx.get(company(hubId)):viewerSnap;
   const hub=doc(hubSnap);
   if(!obj(hub)||!hubKind(hub.companyKind)||
      hub.active===false||!id(hub.ownerUid))STOP();
   const relationResult=partnerViewer
    ?[await tx.get(root("partnerRelations").doc(viewerId))]
    :(await tx.get(root("partnerRelations").where("hubCompanyId","==",hubId)
     .limit(101))).docs;
   if(!Array.isArray(relationResult)||relationResult.length>100||
      partnerViewer&&relationResult.length!==1)STOP();
   const seen=new Set(),partners=[];
   for(const relSnap of relationResult){
    if(!id(relSnap?.id)||seen.has(relSnap.id))STOP();
    seen.add(relSnap.id);
    const rel=doc(relSnap),partnerId=relSnap.id;
    if(!obj(rel)||rel.hubCompanyId!==hubId||
       rel.partnerCompanyId!==partnerId||
       partnerViewer&&partnerId!==viewerId)STOP();
    const partnerSnap=partnerViewer?viewerSnap:await tx.get(company(partnerId));
    const partner=doc(partnerSnap);
    if(!obj(partner)||partner.companyKind!=="partner"||
       partner.hubCompanyId!==hubId||
       (partner.ownerUid!=null&&partner.ownerUid!==""&&!id(partner.ownerUid))||
       !name(partner.name))STOP();
    // Hub-created partner workspaces initially have NO ownerUid by design.
    // Return their count-sharing relationship as read-only setup status.
    // Never infer a partner owner, allow approval, or fabricate consent.
    const ownerClaimed=id(partner.ownerUid);
    if(partnerViewer&&!ownerClaimed)STOP();
    const [hubApprovalSnap,partnerApprovalSnap]=await Promise.all([
     tx.get(company(hubId).collection("rankingApprovals").doc(partnerId)),
     tx.get(company(partnerId).collection("rankingApprovals").doc(hubId))
    ]);
    const hubApproval=checkedApproval(hubApprovalSnap,{
     companyId:hubId,hubId,partnerId,ownerUid:hub.ownerUid
    });
    const partnerApproval=ownerClaimed?
     checkedApproval(partnerApprovalSnap,{
      companyId:partnerId,hubId,partnerId,ownerUid:partner.ownerUid
     }):(()=>{
      // A consent document/flag without a real, verified partner owner is
      // NEVER proof. Treat as potential tampering instead of ignoring it.
      if(partnerApprovalSnap.exists||
         rel.combinedRankingApprovedByPartner===true||
         rel.individualNamesApprovedByPartner===true)STOP();
      return {approved:false,version:0};
     })();
    matchFlags(rel,hubApproval,partnerApproval);
    const own=partnerViewer?partnerApproval:hubApproval;
    const other=partnerViewer?hubApproval:partnerApproval;
    partners.push({
     partnerCompanyId:partnerId,companyName:partner.name,
     ownApproved:own.approved,otherApproved:other.approved,
     version:own.version,
     canEdit:rel.active===true&&rel.countSharingApproved===true&&
      partner.active===true&&(!partnerViewer||ownerClaimed)
    });
   }
   if(partnerViewer&&partners.length!==1)STOP();
   partners.sort((a,b)=>a.companyName.localeCompare(b.companyName,"ja")||
    a.partnerCompanyId.localeCompare(b.partnerCompanyId));
   return Object.freeze({
    schema:"nico-ranking-owner-consent-v1",
    role:partnerViewer?"partner_owner":"hub_owner",
    partners:Object.freeze(partners.map(x=>Object.freeze(x)))
   });
  },{readOnly:true});
 };
}
