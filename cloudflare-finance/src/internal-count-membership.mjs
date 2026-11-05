/**
 * Normalize legacy Firestore company membership safely.
 *
 * Firestore's document name is server-authored. Old NICO users and members
 * sometimes omit redundant fields (uid, active, companyId) although their
 * document paths are still correct. Blocking those legitimate accounts
 * would silently break their count screens during a Finance cutover.
 *
 * We only fill values proven by the server-read document paths; a stored
 * conflicting identity/role or an explicit deactivation is DENIED.
 * The result must only be passed to a server-side COUNT projection and never
 * used to grant finance or owner rights.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const denied=()=>{const e=new Error("legacy_count_membership_denied");e.status=403;throw e;};
const isId=x=>typeof x==="string"&&ID.test(x);
export function normalizeInternalCountMembership({
  uid,companyId,user,member,company,secondaryContext
}={}){
 // The trusted server must explicitly query the secondary context.
 // Undefined means the check was skipped; any existing context, including
 // inactive/old partner context, revokes historic internal count access.
 if(secondaryContext!==null)denied();
 if(!isId(uid)||!isId(companyId)||!user||!member||!company ||
   user.id!==uid||member.id!==uid||company.id!==companyId ||
   user.companyId!==companyId ||
   (user.uid!=null&&user.uid!==uid) ||
   (member.uid!=null&&member.uid!==uid) ||
   (member.companyId!=null&&member.companyId!==companyId) ||
   user.active===false||member.active===false||company.active===false ||
   user.companyRole!==member.companyRole ||
   ![undefined,"internal","direct"].includes(company.companyKind) ||
   [user.accessKind,member.accessKind].some(k=>
     k!=null&&k!=="internal") ||
   [user.memberType,member.memberType].some(k=>
     k!=null&&!["internal","direct","member","managed"].includes(k)))
  denied();
 return {
  uid,companyId,
  // Historical absence of active is a legacy-active member, not a new grant:
  // explicit false always denies.
  user:{...user,uid,active:true},
  member:{...member,uid,companyId,active:true},
  company:{...company,active:true},
  firebaseIdTokenVerified:true,emailVerified:true,
  serverMembershipVerified:true,serverVerifiedInternalCompany:true
 };
}
