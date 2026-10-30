/**
 * STAGING ONLY. Authoritative read scope for the NICO count-only gateway.
 *
 * readDocument and loadAuthUser are SERVER-SUPPLIED functions; never pass
 * browser functions, client roles, caller-supplied company IDs or cached ACLs.
 * Reads are fresh on EVERY request. No direct Firestore/production network I/O.
 *
 * Backend contract:
 *   readDocument(path) -> object|null (decoded trusted Firestore document)
 *   loadAuthUser(uid)  -> Firebase Admin getUser() result, including
 *                         tokensValidAfterTime for revocation checking
 *
 * The response contains only count-access scope, never financial grants.
 */
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const deny=()=>{throw Error("Count-only membership not authorized");};
const valid=x=>typeof x==="string"&&ID.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const active=x=>obj(x)&&x.active===true;
const verifiedAccess=(user,member)=>{
 // Partner/cooperator markers in EITHER authoritative record are restrictive.
 // An old internal accessKind must not override a recently assigned partner
 // memberType (or any unknown accessKind). No finance fields are returned here.
 const u=user.accessKind??"internal",m=member.accessKind??"internal";
 if(u!==m||!["internal","partner"].includes(u))deny();
 for(const row of [user,member]){
  const kind=row.memberType;
  // On real partner accounts these explicit markers are EXPECTED; denying
  // them would break legitimate partner count registration.
  if(u==="internal"&&kind!=null&&
     !["internal","direct","managed","member"].includes(kind))deny();
  if(u==="partner"&&kind!=null&&
     !["partner","cooperator","internal","member"].includes(kind))deny();
 }
 return u;
};
function verifiedAuthAccount(account,uid,auth){
 if(!obj(account)||account.uid!==uid||account.disabled!==false||
    account.emailVerified!==true||!Number.isSafeInteger(auth.authTime)||
    auth.authTime<=0||typeof account.tokensValidAfterTime!=="string")deny();
 const validAfterMs=Date.parse(account.tokensValidAfterTime);
 if(!Number.isFinite(validAfterMs)||
    Math.floor(validAfterMs/1000)>=auth.authTime)deny();
}
function teamScope(user,member,companyId){
 // A recent team transfer must be reflected in BOTH authoritative documents.
 // Past team history is never used to gain CURRENT access to another team.
 const u=user.teamId??null,m=member.teamId??null;
 if(u!==m)deny();
 if(u===null)return [];
 if(!valid(u))deny();
 return [u];
}
export function createTrustedMembershipLoader({readDocument,loadAuthUser}={}){
 if(typeof readDocument!=="function"||typeof loadAuthUser!=="function")deny();
 return async function loadMembership(uid,auth){
  if(!valid(uid)||!obj(auth)||auth.uid!==uid||
     auth.emailVerified!==true)deny();

  // loadAuthUser must be an authenticated Firebase Admin API call and may
  // not rely on the ID token's historical account state.
  const authUser=await loadAuthUser(uid);
  verifiedAuthAccount(authUser,uid,auth);
  const user=await readDocument("users/"+uid);
  if(!active(user)||user.uid!==uid||!valid(user.companyId))deny();
  const companyId=user.companyId;
  const [company,member]=await Promise.all([
   readDocument("companies/"+companyId),
   readDocument("companies/"+companyId+"/members/"+uid)
  ]);
  if(!active(company)||!active(member)||
     member.uid!==uid||member.companyId!==companyId)deny();
  const accessKind=verifiedAccess(user,member);
  const companyKind=company.companyKind??"internal";
  if(!["internal","partner"].includes(companyKind)||
     (companyKind==="partner")!==(accessKind==="partner"))deny();

  const owner=company.ownerUid===uid&&
    user.companyRole==="owner"&&member.companyRole==="owner";
  // Partner company owner is allowed to access counts, NOT finance.
  // Server must not synthesize owner rights from "role":"leader".
  const teams=teamScope(user,member);
  for(const teamId of teams){
   const team=await readDocument("teams/"+teamId);
   if(!active(team)||team.companyId!==companyId)deny();
  }

  if(companyKind==="partner"){
   if(!valid(company.hubCompanyId)||company.hubCompanyId===companyId)deny();
   const [relation,hub]=await Promise.all([
     readDocument("partnerRelations/"+companyId),
     readDocument("companies/"+company.hubCompanyId)
   ]);
   if(!active(relation)||!active(hub)||
      relation.partnerCompanyId!==companyId||
      relation.hubCompanyId!==company.hubCompanyId||
      relation.countSharingApproved!==true||
      relation.catalogAccessApproved!==true||
      hub.companyKind!=="internal"||
      hub.active!==true)deny();
  }
  // Never return raw Firestore documents, money or product catalogs.
  return {
    uid,companyId,userCompanyId:companyId,memberCompanyId:companyId,
    userActive:true,memberActive:true,
    companyOwnerUid:company.ownerUid??"",
    userCompanyRole:user.companyRole??"member",
    memberCompanyRole:member.companyRole??"member",
    serverVerifiedOwner:owner,
    teamIds:teams
  };
 };
}
