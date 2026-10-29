/**
 * STAGING ONLY. Transaction-local, trusted context for partner COUNT writes.
 *
 * Use only within an authenticated server gateway, supplying:
 * - authenticateBearer: cryptographically verifies Firebase ID token
 * - loadAuthUser: Firebase Admin account read (incl. token revocation)
 * - readInTransaction: current Firestore document read within ONE transaction
 * - loadCountCatalog: trusted financial-free catalog list in the same transaction
 *
 * Caller cannot specify UID, company, companyKind, team membership or pricing.
 * No Firebase import, network access, writes, deployment or credentials here.
 */
import {createTrustedMembershipLoader} from "./trusted-membership-loader.mjs";

const ID=/^[a-zA-Z0-9_:-]{1,128}$/;
const fail=()=>{throw Error("Trusted count write not authorized");};
const valid=v=>typeof v==="string"&&ID.test(v);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const priceLike=/(?:[¥￥$€]|\d[\d,.]*\s*(?:万|千)?円|(?:CB|cashback|revenue|price|単価|売上)[\s:_=-]*\d)/i;
function trustedCatalog(rows,companyId,hubId){
 if(!Array.isArray(rows)||rows.length>10000)fail();
 const seen=new Set();
 return rows.map(row=>{
  if(!obj(row)||Object.keys(row).sort().join(",")!==
      ["catalogId","ownerCompanyId","active","visibility"].sort().join(",")||
     !valid(row.catalogId)||!valid(row.ownerCompanyId)||
     typeof row.active!=="boolean"||
     !["shared_counts","private"].includes(row.visibility)||
     seen.has(row.catalogId)||priceLike.test(row.catalogId))fail();
  seen.add(row.catalogId);
  const shared=row.catalogId.startsWith("shared:"+hubId+":")&&
    row.ownerCompanyId===hubId&&row.visibility==="shared_counts";
  const custom=row.catalogId.startsWith("custom:"+companyId+":")&&
    row.ownerCompanyId===companyId;
  if(!shared&&!custom)fail();
  return {catalogId:row.catalogId,ownerCompanyId:row.ownerCompanyId,
    active:row.active,visibility:row.visibility};
 });
}
export function createTrustedPartnerWriteContext({
 token,request,authenticateBearer,loadAuthUser,
 readInTransaction,loadCountCatalog
}={}){
 if(typeof token!=="string"||token.length<20||
    !obj(request)||!valid(request.teamId)||
    [authenticateBearer,loadAuthUser,readInTransaction,loadCountCatalog]
      .some(x=>typeof x!=="function"))fail();

 return async function loadTrustedContext(tx){
  // Never accept user-supplied principal claims. Verified token checked on
  // EVERY transactional attempt, then current ACL read again.
  if(!tx||typeof tx!=="object")fail();
  const auth=await authenticateBearer(token);
  if(!obj(auth)||!valid(auth.uid)||auth.emailVerified!==true)fail();
  const readDocument=path=>readInTransaction(tx,path);
  const scope=await createTrustedMembershipLoader({
    loadAuthUser,readDocument
  })(auth.uid,auth);
  const companyId=scope.companyId;
  if(!scope.teamIds.includes(request.teamId))fail();
  const [company,member,team,user,relation]=await Promise.all([
    readDocument("companies/"+companyId),
    readDocument("companies/"+companyId+"/members/"+auth.uid),
    readDocument("teams/"+request.teamId),
    readDocument("users/"+auth.uid),
    readDocument("partnerRelations/"+companyId)
  ]);
  if(!obj(company)||company.active!==true||
     company.companyKind!=="partner"||!valid(company.hubCompanyId)||
     !obj(relation)||relation.active!==true||
     relation.partnerCompanyId!==companyId||
     relation.hubCompanyId!==company.hubCompanyId||
     relation.countSharingApproved!==true||
     relation.catalogAccessApproved!==true||
     !obj(member)||member.active!==true||
     !obj(user)||user.active!==true||
     member.accessKind!=="partner"||user.accessKind!=="partner"||
     member.canSubmit===false||user.canSubmit===false||
     !["member","leader"].includes(member.role)||
     team?.companyId!==companyId||team.active!==true||
     typeof member.name!=="string"||
     typeof team.name!=="string"||
     priceLike.test(member.name)||priceLike.test(team.name))fail();
  const catalog=trustedCatalog(await loadCountCatalog(tx,{
    companyId,hubCompanyId:company.hubCompanyId
  }),companyId,company.hubCompanyId);
  return {
    principal:{
      serverVerified:true,tokenVerified:true,userActive:true,
      memberActive:true,companyActive:true,
      companyKind:"partner",accessKind:"partner",
      partnerRelationApproved:true,canSubmit:true,
      uid:auth.uid,companyId,teamIds:scope.teamIds
    },
    catalog,
    memberName:member.name,teamName:team.name
  };
 };
}
