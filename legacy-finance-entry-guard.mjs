/**
 * Source-only safeguard for the legacy all-in-one sales page.
 *
 * This is defense in depth, NOT a substitute for Firestore Security Rules.
 * A compromised client can bypass JS. The official Hosting cutover still
 * requires server-enforced raw-finance denial and API-only data paths.
 *
 * All three inputs MUST be fetched from the server in the current session,
 * never accepted from the browser's role input, ID-token custom claims,
 * saved profile cache or a stale offline snapshot.
 */
const INTERNAL_ACCESS=new Set(["internal"]);
const INTERNAL_MEMBER=new Set(["internal","direct","member","managed"]);
const COMPANY_KIND=new Set(["internal","partner"]);
const ACCESS_KIND=new Set(["internal","partner"]);
const MEMBER_KIND=new Set(["internal","direct","member","managed","partner","cooperator"]);
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
function validObj(value){return value!==null&&typeof value==="object"&&!Array.isArray(value);}
const allowedValue=(value,valid,fallback)=>{
 const checked=value==null?fallback:value;
 return typeof checked==="string"&&valid.has(checked)?checked:null;
};
const allowActive=obj=>obj.active!==false;
function fail(reason="unverified"){
 return Object.freeze({mode:"blocked",reason});
}
export function classifyLegacySalesEntrypoint({uid,user,member,company,authEmailVerified}={}){
 if(typeof uid!=="string"||!ID.test(uid)||authEmailVerified!==true||
    !validObj(user)||!validObj(member)||!validObj(company)||
    !allowActive(user)||!allowActive(member)||!allowActive(company))
  return fail();
 const companyId=user.companyId;
 if(typeof companyId!=="string"||!ID.test(companyId)||
    member.uid!==uid||member.companyId!==companyId||
    user.uid!==uid)return fail("membership_mismatch");
 // An old missing internal marker may be allowed; unknown strings fail closed.
 const companyKind=allowedValue(company.companyKind,COMPANY_KIND,"internal");
 const userAccess=allowedValue(user.accessKind,ACCESS_KIND,"internal");
 const memberAccess=allowedValue(member.accessKind,ACCESS_KIND,"internal");
 const userType=allowedValue(user.memberType,MEMBER_KIND,"internal");
 const memberType=allowedValue(member.memberType,MEMBER_KIND,"internal");
 if(!companyKind||!userAccess||!memberAccess||!userType||!memberType)
  return fail("unknown_role");
 if(user.teamId!=null&&member.teamId!=null&&user.teamId!==member.teamId)
  return fail("team_mismatch");
 if(user.companyRole!=null&&member.companyRole!=null&&
    user.companyRole!==member.companyRole)
  return fail("role_mismatch");
 // All three administrative records have veto power: accidental Owner/Master
 // grants or mismatched partner markers cannot turn a partner into internal.
 if(companyKind==="partner"||userAccess==="partner"||
    memberAccess==="partner"||userType==="partner"||
    memberType==="partner"||userType==="cooperator"||
    memberType==="cooperator")
  return Object.freeze({mode:"partner",reason:"count_only_required"});
 if(!INTERNAL_ACCESS.has(userAccess)||!INTERNAL_ACCESS.has(memberAccess)||
    !INTERNAL_MEMBER.has(userType)||!INTERNAL_MEMBER.has(memberType))
  return fail("not_internal");
 return Object.freeze({mode:"internal",reason:"verified"});
}
