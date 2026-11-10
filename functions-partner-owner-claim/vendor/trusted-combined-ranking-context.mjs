/**
 * STAGING / NOT DEPLOYED — authenticated, server-owned ranking context.
 *
 * Partner count-sharing by itself never authorizes public leaderboards or
 * individual names. Every linked company must have separately approved
 * company-owned consent docs; partnerRelations alone CANNOT forge consent.
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
  row.countSharingApproved===true&&
  row.combinedRankingApprovedByHub===true&&
  row.combinedRankingApprovedByPartner===true&&
  row.individualNamesApprovedByHub===true&&
  row.individualNamesApprovedByPartner===true;
}
function consentOk(row,{companyId,hub,partner,owner}){
 return isObj(row)&&row.companyId===companyId&&
  row.hubCompanyId===hub&&row.partnerCompanyId===partner&&
  row.approvedByUid===owner&&row.active===true&&
  row.scope==="combined_rank_only"&&
  Number.isSafeInteger(row.version)&&row.version>=1&&row.version<=999&&
  row.combinedRankingApproved===true&&
  row.individualNamesApproved===true;
}
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
 * Server-only Auth result -> fresh, reciprocal approvals.
 * Current phase deliberately authorizes OWNER accounts only. This excludes
 * partner-secondary / shared-code principals until their separate secure
 * approval and role scopes can be implemented, NOT a claim that their
 * existing direct finance permissions have already been blocked.
 */
export function createFreshCombinedRankingContext({db}={}){
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function")throw Error("rank DB dependency missing");
 const root=name=>db.collection(name),company=id=>root("companies").doc(id);
 return async function load(auth){
  if(!id(auth?.uid)||auth.emailVerified!==true||
     !EMAIL.test(auth.email||""))blocked();
  return db.runTransaction(async tx=>{
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
   const viewerCompanyId=user.companyId;
   const [viewerCompanySnap,viewerMemberSnap]=await Promise.all([
    tx.get(company(viewerCompanyId)),
    tx.get(company(viewerCompanyId).collection("members").doc(auth.uid))
   ]);
   const viewerCompany=read(viewerCompanySnap),viewerMember=read(viewerMemberSnap);
   const viewerIsPartner=viewerCompany?.companyKind==="partner";
   assertOwner({uid:auth.uid,companyId:viewerCompanyId,
    user,member:viewerMember,company:viewerCompany,
    kind:viewerIsPartner?"partner":"hub"});
   if(user.authKind==="partner_code_shared")blocked();
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
   const found=new Set(),eligible=[];
   for(const snap of relationSnap.docs){
    if(!id(snap.id)||found.has(snap.id))blocked();
    found.add(snap.id);
    const row=read(snap);
    // Any stale, mixed-company or incomplete relations stop rather than
    // leak another company's name/count.
    if(!isObj(row)||row.hubCompanyId!==hubId||
       row.partnerCompanyId!==snap.id)blocked();
    if(relationApproved(row,hubId,snap.id))eligible.push(snap.id);
   }
   if(eligible.length>MAX_APPROVED)blocked();
   if(viewerIsPartner&&!eligible.includes(viewerCompanyId))blocked();
   const verified=[];
   for(const partnerId of eligible){
    const [partnerSnap,hubConsentSnap,partnerConsentSnap]=await Promise.all([
     tx.get(company(partnerId)),
     tx.get(company(hubId).collection("rankingApprovals").doc(partnerId)),
     tx.get(company(partnerId).collection("rankingApprovals").doc(hubId))
    ]);
    const partner=read(partnerSnap);
    if(!isObj(partner)||partner.companyKind!=="partner"||
       partner.active!==true||partner.hubCompanyId!==hubId||
       !id(partner.ownerUid))blocked();
    if(!consentOk(read(hubConsentSnap),{
      companyId:hubId,hub:hubId,partner:partnerId,owner:hub.ownerUid
    })||!consentOk(read(partnerConsentSnap),{
      companyId:partnerId,hub:hubId,partner:partnerId,owner:partner.ownerUid
    }))blocked();
    verified.push(partnerId);
   }
   return Object.freeze({
    serverVerified:true,viewerUid:auth.uid,viewerCompanyId,
    role:viewerIsPartner?"partner_owner":"hub_owner",
    hubCompanyId:hubId,approvedCompanyIds:Object.freeze(
     [hubId,...verified.sort()]),
    userActive:true,memberActive:true,companyActive:true,
    reciprocalOwnersApproved:true,individualNamesApproved:true,
    completeSnapshotBudgetApproved:true
   });
  },{readOnly:true});
 };
}
