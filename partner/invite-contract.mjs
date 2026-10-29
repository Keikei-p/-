/**
 * Pure, staging-only invitation contract. NEVER writes Firestore, creates an
 * account, issues a token, or uses caller-supplied roles as authorization.
 * A trusted backend must verify Firebase identity + original company owner,
 * generate a random one-use token, store its HASH, and transact acceptance.
 */
export const INVITE_KINDS=Object.freeze({
  INTERNAL:"internal_member",PARTNER:"partner_company"
});
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const err=()=>{throw Error("Invitation denied or incomplete");};
const goodId=x=>typeof x==="string"&&ID.test(x);
const goodEmail=x=>typeof x==="string"&&x.length<=254&&EMAIL.test(x);
export function prepareInviteContract({
  kind,inviter,hubCompany,recipientEmail,role="member",nowMs,expiresInMinutes=30
}){
  if(!Object.values(INVITE_KINDS).includes(kind)||
     !inviter||!hubCompany||!goodId(inviter.uid)||
     !goodId(hubCompany.id)||!goodEmail(recipientEmail?.trim().toLowerCase())||
     !Number.isSafeInteger(nowMs)||nowMs<=0||
     !Number.isSafeInteger(expiresInMinutes)||expiresInMinutes!==30 ||
     inviter.active!==true || inviter.companyId!==hubCompany.id ||
     hubCompany.active!==true ||
     inviter.latestMemberVerified!==true ||
     hubCompany.ownerUidVerified!==true)err();
  // Ordinary employees/leaders may invite colleagues only if explicitly
  // granted; they cannot create an external partner organization.
  if(kind===INVITE_KINDS.PARTNER && !(
    inviter.companyRole==="owner" && inviter.uid===hubCompany.ownerUid))err();
  if(kind===INVITE_KINDS.INTERNAL &&
     !(inviter.companyRole==="owner"||inviter.canCreateInvite===true))err();
  if(!["member","leader"].includes(role))err();
  const emailLower=recipientEmail.trim().toLowerCase();
  if(emailLower===inviter.emailLower)err();
  return Object.freeze({
    kind,hubCompanyId:hubCompany.id,emailLower,
    role:kind===INVITE_KINDS.PARTNER?"leader":role,
    invitedByUid:inviter.uid,
    expiresAtMs:nowMs+expiresInMinutes*60_000,
    // No broad access permission is implied by the role label.
    canViewRevenue:false,canViewUnitPrice:false,
    partnerCountOnly:kind===INVITE_KINDS.PARTNER,
    linkStatus:"pending",
    catalogSourceCompanyId:kind===INVITE_KINDS.PARTNER?hubCompany.id:null,
    ownProductDefaultVisibility:"private"
  });
}
export function planInviteAcceptance({contract,recipient,verifiedToken,nowMs,newPartnerCompanyId}){
 if(!contract||!recipient||verifiedToken!==true ||
    !Number.isSafeInteger(nowMs)||nowMs<=0||
    contract.linkStatus!=="pending"||contract.expiresAtMs<=nowMs||
    !goodId(contract.hubCompanyId) ||
    !goodId(recipient.uid)||!goodEmail(recipient.emailLower)||
    recipient.emailVerified!==true||
    recipient.emailLower!==contract.emailLower||
    recipient.active!==true||
    recipient.latestUserVerified!==true)err();
 if(contract.kind===INVITE_KINDS.INTERNAL){
   if(recipient.companyId&&recipient.companyId!==contract.hubCompanyId)err();
   return {
     operation:"join_existing_company",
     targetCompanyId:contract.hubCompanyId,
     userUid:recipient.uid,role:contract.role,
     canViewRevenue:false,canViewUnitPrice:false,
     accessKind:"internal",
     // Existing records and memberships must not be changed by acceptance.
     preserveHistoricalRecords:true
   };
 }
 if(contract.kind!==INVITE_KINDS.PARTNER ||
    recipient.companyId || !goodId(newPartnerCompanyId)||
    newPartnerCompanyId===contract.hubCompanyId ||
    contract.partnerCountOnly!==true ||
    contract.catalogSourceCompanyId!==contract.hubCompanyId)err();
 return {
   operation:"create_isolated_partner_company",
   companyId:newPartnerCompanyId,
   hubCompanyId:contract.hubCompanyId,
   userUid:recipient.uid,
   companyKind:"partner",
   accessKind:"partner",
   role:"leader",
   companyRole:"owner",
   canViewRevenue:false,canViewUnitPrice:false,
   canCreateInvite:false,
   catalogSourceCompanyId:contract.catalogSourceCompanyId,
   // The partner owner does NOT receive financial rights by implication.
   financialAccessDenied:true,
   ownProductDefaultVisibility:"private",
   crossCompanyCountSharingApproved:false,
   preserveHistoricalRecords:true
 };
}
export function validateImmutableInvite(previous,next){
 if(!previous||!next)err();
 const allowed=["status","acceptedBy","acceptedAt"];
 const all=new Set([...Object.keys(previous),...Object.keys(next)]);
 for(const key of all){
   if(allowed.includes(key))continue;
   if(JSON.stringify(previous[key])!==JSON.stringify(next[key]))err();
 }
 if(previous.status!=="pending"||next.status!=="accepted"||
   !goodId(next.acceptedBy))err();
 return true;
}
