/**
 * STAGING / NOT DEPLOYED — authenticated, server-owned ranking context.
 *
 * Existing active count-sharing relations authorize linked-company counts.
 * Hub Owner individual-name publication is optional display permission; its
 * absence never blocks counts and never turns a saved name into a public name.
 *
 * All Firestore reads are in a read-only server Admin transaction.
 * No client-provided company, role, consent or "proof" fields are accepted.
 * Unknown/unverified statuses fail closed. No financial collections read.
 */
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RELATIONS=100,MAX_APPROVED=29;
const blocked=()=>{throw Error("RANKING_IDENTITY_OR_OWNER_CONSENT_UNVERIFIED");};
const id=x=>typeof x==="string"&&UID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const read=s=>s?.exists===true&&typeof s.data==="function"?s.data():null;
const isObj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const internal=x=>x==null||x==="internal";
const kindInternal=x=>x==null||x==="internal"||x==="direct";
const internalMemberType=x=>x==null||["internal","direct","member","managed"].includes(x);
function assertOwner({uid,companyId,user,member,company,kind}){
 if(!isObj(user)||!isObj(member)||!isObj(company)||
    user.uid!==uid||member.uid!==uid||
    user.companyId!==companyId||
    (member.companyId!=null&&member.companyId!==companyId)||
    user.active!==true||member.active!==true||
    company.active===false||company.ownerUid!==uid||
    user.companyRole!=="owner"||member.companyRole!=="owner")
   blocked();
 if(kind==="hub"){
  if(!kindInternal(company.companyKind)||
     !internal(user.accessKind)||!internal(member.accessKind)||
     !internalMemberType(user.memberType)||!internalMemberType(member.memberType))
   blocked();
 }else{
  if(company.companyKind!=="partner"||!id(company.hubCompanyId)||
     user.accessKind!=="partner"||member.accessKind!=="partner"||
     user.memberType!=="cooperator"||member.memberType!=="cooperator"||
     user.canViewRevenue!==false||member.canViewRevenue!==false||
     user.canViewUnitPrice!==false||member.canViewUnitPrice!==false)
   blocked();
 }
}
function relationApproved(row,hub,partner) {
 return isObj(row)&&row.hubCompanyId===hub&&
  row.partnerCompanyId===partner&&row.active===true&&
  row.countSharingApproved===true;
}
function publicNameApprovalOk(row,{companyId,hub,partner,owner}){
 return isObj(row)&&row.companyId===companyId&&
  row.hubCompanyId===hub&&row.partnerCompanyId===partner&&
  row.approvedByUid===owner&&row.active===true&&
  row.scope==="combined_rank_only"&&
  Number.isSafeInteger(row.version)&&row.version>=1&&row.version<=999&&
  row.individualNamesApproved===true;
}
// The managing hub Owner alone controls whether another company's individual
// names may be published. This optional display decision never gates counts.
// Preserve the old export name for other read-only callers; its partnerApproval
// input is intentionally ignored, not required or fetched.
export function existingHubOwnerNamePublicationVerified({
 relation,hubCompany,partnerCompany,hubCompanyId,partnerCompanyId,
 hubApproval
}={}){
 if(!id(hubCompanyId)||!id(partnerCompanyId)||hubCompanyId===partnerCompanyId||
    !relationApproved(relation,hubCompanyId,partnerCompanyId)||
    relation.individualNamesApprovedByHub!==true||
    !isObj(hubCompany)||!isObj(partnerCompany)||
    !id(hubCompany.ownerUid)||hubCompany.active===false||
    !kindInternal(hubCompany.companyKind)||
    partnerCompany.active!==true||partnerCompany.companyKind!=="partner"||
    partnerCompany.hubCompanyId!==hubCompanyId)return false;
 return publicNameApprovalOk(hubApproval,{
  companyId:hubCompanyId,hub:hubCompanyId,partner:partnerCompanyId,
  owner:hubCompany.ownerUid
 });
}
export const existingPublicNameApprovalPairVerified=existingHubOwnerNamePublicationVerified;
/**
 * Wrap a real Firebase Admin Auth instance. Each request checks revoked tokens,
 * current Auth profile and exact verified email; never accept request claims.
 */
export function createVerifiedRankTokenReader({auth}={}){
 if(!auth||typeof auth.verifyIdToken!=="function"||
    typeof auth.getUser!=="function")throw Error("rank Auth dependency missing");
 return async token=>{
  if(typeof token!=="string"||token.length<20||token.length>12000)blocked();
  let claim,user;
  try{
   claim=await auth.verifyIdToken(token,true);
   if(!id(claim?.uid))blocked();
   user=await auth.getUser(claim.uid);
  }catch{blocked();}
  const email=typeof claim.email==="string"?claim.email.trim().toLowerCase():"";
  if(!isObj(claim)||!id(claim.uid)||!isObj(user)||
     user.uid!==claim.uid||user.disabled===true||
     claim.email_verified!==true||user.emailVerified!==true||
     !EMAIL.test(email)||typeof user.email!=="string"||
     user.email.trim().toLowerCase()!==email)blocked();
  return Object.freeze({uid:claim.uid,email,emailVerified:true});
 };
}
/**
 * Server-only Auth result -> fresh active count-sharing scope and optional
 * existing public-name permissions, independently verified by the server.
 * The default remains Owner-only for the existing settings callers. The
 * canonical count GET injects the existing workspace identity authorizer for
 * active members, secondary workspaces and opaque company-code sessions.
 * Response roles describe count audiences; they never grant Owner actions.
 */
export function createFreshCombinedRankingContext({db,loadCountViewer}={}){
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function")throw Error("rank DB dependency missing");
 const root=name=>db.collection(name),company=id=>root("companies").doc(id);
 return async function load(auth){
  if(loadCountViewer!==undefined&&typeof loadCountViewer!=="function")blocked();
  if(!loadCountViewer&&(!id(auth?.uid)||auth.emailVerified!==true||
     !EMAIL.test(auth.email||"")))blocked();
  return db.runTransaction(async tx=>{
   let viewerCompanyId,viewerCompanySnap,viewerMemberSnap,viewerCompany,viewerIsPartner,uid;
   if(loadCountViewer){
    // Only the canonical count GET injects this server-owned authorizer.
    // The result selects a count-response audience, never an Owner privilege.
    const s=await loadCountViewer(tx);
    if(!s||!id(s.uid)||!id(s.cid)||!["hub","partner"].includes(s.kind)||
       !["owner","leader","member"].includes(s.role))blocked();
    uid=s.uid;viewerCompanyId=s.cid;viewerIsPartner=s.kind==="partner";
    viewerCompanySnap=await tx.get(company(viewerCompanyId));
    viewerCompany=read(viewerCompanySnap);
    if(!isObj(viewerCompany)||viewerCompany.active!==true||
       (viewerIsPartner?(viewerCompany.companyKind!=="partner"||
         viewerCompany.hubCompanyId!==s.hubId):!kindInternal(viewerCompany.companyKind)))blocked();
   }else{
   const [userSnap,secondarySnap]=await Promise.all([
    tx.get(root("users").doc(auth.uid)),
    tx.get(root("partnerWorkspaceContexts").doc(auth.uid))
   ]);
   const user=read(userSnap),secondary=read(secondarySnap);
   if(!isObj(user)||!id(user.companyId)||user.uid!==auth.uid||
      user.active!==true||
      (typeof user.email==="string"&&
       user.email.trim().toLowerCase()!==auth.email))
    blocked();
   // An old internal membership in a partner-secondary account MUST NEVER
   // turn into an internal-owner authorization.
   if(secondarySnap.exists&&secondary?.active!==false)blocked();
   uid=auth.uid;viewerCompanyId=user.companyId;
   [viewerCompanySnap,viewerMemberSnap]=await Promise.all([
    tx.get(company(viewerCompanyId)),
    tx.get(company(viewerCompanyId).collection("members").doc(auth.uid))
   ]);
   viewerCompany=read(viewerCompanySnap);
   const viewerMember=read(viewerMemberSnap);
   viewerIsPartner=viewerCompany?.companyKind==="partner";
   assertOwner({uid:auth.uid,companyId:viewerCompanyId,
    user,member:viewerMember,company:viewerCompany,
    kind:viewerIsPartner?"partner":"hub"});
   if(user.authKind==="partner_code_shared")blocked();
   }
   const hubId=viewerIsPartner?viewerCompany.hubCompanyId:viewerCompanyId;
   if(!id(hubId))blocked();
   const hubSnap=viewerIsPartner?await tx.get(company(hubId)):viewerCompanySnap;
   const hub=read(hubSnap);
   if(!isObj(hub)||!kindInternal(hub.companyKind)||
      hub.active===false||!id(hub.ownerUid))blocked();
   const relationSnap=await tx.get(
    root("partnerRelations").where("hubCompanyId","==",hubId).limit(MAX_RELATIONS+1)
   );
   if(!Array.isArray(relationSnap?.docs)||
      relationSnap.docs.length>MAX_RELATIONS)blocked();
   const found=new Set(),eligible=[],relations=new Map();
   for(const snap of relationSnap.docs){
    if(!id(snap.id)||found.has(snap.id))blocked();
    found.add(snap.id);
    const row=read(snap);
    // Any stale, mixed-company or incomplete relations stop rather than
    // leak another company's name/count.
    if(!isObj(row)||row.hubCompanyId!==hubId||
       row.partnerCompanyId!==snap.id)blocked();
    if(relationApproved(row,hubId,snap.id)){
     eligible.push(snap.id);relations.set(snap.id,row);
    }
   }
   if(eligible.length>MAX_APPROVED)blocked();
   if(viewerIsPartner&&!eligible.includes(viewerCompanyId))blocked();
   const verified=[],nameApprovals=new Map();
   for(const partnerId of eligible){
    const partnerSnap=await tx.get(company(partnerId));
    const partner=read(partnerSnap);
    if(!isObj(partner)||partner.companyKind!=="partner"||
       partner.active!==true||partner.hubCompanyId!==hubId||
       (partner.ownerUid!=null&&partner.ownerUid!==""&&
        !id(partner.ownerUid)))blocked();
    let publicNamesVerified=false;
    const relation=relations.get(partnerId);
    if(relation.individualNamesApprovedByHub===true){
     const hubApprovalSnap=await tx.get(
      company(hubId).collection("rankingApprovals").doc(partnerId)
     );
     publicNamesVerified=existingHubOwnerNamePublicationVerified({
      relation,hubCompany:hub,partnerCompany:partner,
      hubCompanyId:hubId,partnerCompanyId:partnerId,
      hubApproval:read(hubApprovalSnap)
     });
    }
    nameApprovals.set(partnerId,publicNamesVerified);
    verified.push(partnerId);
   }
   const publicNameCompanyIds=new Set([viewerCompanyId]);
   // A partner audience must itself have the existing network-name permission
   // before receiving any other company's approved names. Own-company display
   // continues under the independently authenticated Owner membership.
   if(!viewerIsPartner||nameApprovals.get(viewerCompanyId)===true){
    if(viewerIsPartner)publicNameCompanyIds.add(hubId);
    for(const partnerId of verified)if(nameApprovals.get(partnerId)===true)
     publicNameCompanyIds.add(partnerId);
   }
   return Object.freeze({
    serverVerified:true,viewerUid:uid,viewerCompanyId,
    role:viewerIsPartner?"partner_owner":"hub_owner",
    hubCompanyId:hubId,approvedCompanyIds:Object.freeze(
     [hubId,...verified.sort()]),
    userActive:true,memberActive:true,companyActive:true,
    activeCountSharingVerified:true,
    publicNameCompanyIds:Object.freeze([...publicNameCompanyIds].sort()),
    completeSnapshotBudgetApproved:true
   });
  },{readOnly:true});
 };
}
