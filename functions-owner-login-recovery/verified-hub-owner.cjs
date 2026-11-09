"use strict";
/**
 * STAGING ONLY / NEVER ENABLED BY THIS MODULE.
 * An additive, explicitly-approved secondary internal Owner authorization
 * strategy. Preserves companies.ownerUid (sole primary Owner). Secondary
 * Owners require ALL existing Owner Auth and live Firestore identity checks
 * PLUS an explicit company-level allowlist issued by primary Owner.
 *
 * This module does not grant roles, write Firestore or expose financial data.
 * No production Functions import it until a separately reviewed release.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const BEARER=/^Bearer ([A-Za-z0-9._-]{20,12000})$/i;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEMBER_TYPES=new Set(["internal","direct","member","managed"]);
const validId=value=>typeof value==="string"&&ID.test(value);
const isInternal=x=>x==null||x==="internal";
const isMemberType=x=>x==null||MEMBER_TYPES.has(x);
function makeExplicitHubOwnerVerifier({db,getAuth,HttpsError,enabled=()=>false}={}){
 if(!db?.collection||typeof getAuth!=="function"||
    typeof HttpsError!=="function"||typeof enabled!=="function")
  throw Error("EXPLICIT_HUB_OWNER_VERIFIER_DEPENDENCIES");
 const fail=(code="permission-denied")=>{
  throw new HttpsError(code,"Owner権限・承認状態を確認できません。");
 };
 function validateActorDocuments({uid,cid,us,ms}){
  const u=us?.data?.()||{},m=ms?.data?.()||{};
  if(!us?.exists||!ms?.exists||
    u.uid!==uid||u.companyId!==cid||u.active!==true||
    u.companyRole!=="owner"||u.authKind==="partner_code_shared"||
    !isInternal(u.accessKind)||!isMemberType(u.memberType)||
    m.uid!==uid||m.active!==true||m.companyRole!=="owner"||
    (m.companyId!=null&&m.companyId!==cid)||
    !isInternal(m.accessKind)||!isMemberType(m.memberType)||
    m.authKind==="partner_code_shared"||
    u.canViewRevenue===false&&u.accessKind==="partner"||
    m.canViewRevenue===false&&m.accessKind==="partner")
    fail();
  return true;
 }
 const verifyIdentity=(record,decoded,uid,email)=>{
  if(!record||record.uid!==uid||record.disabled===true||
     record.emailVerified!==true||
     typeof record.email!=="string"||record.email.toLowerCase()!==email||
     decoded?.uid!==uid||decoded.email_verified!==true||
     typeof decoded.email!=="string"||decoded.email.toLowerCase()!==email)
   fail("unauthenticated");
 };
 return async function verifyHubOwner(request,tx=null){
  if(enabled()!==true)fail("unavailable");
  const uid=request?.auth?.uid;
  const jwtEmail=request?.auth?.token?.email;
  const header=request?.rawRequest?.headers?.authorization;
  const match=typeof header==="string"?header.match(BEARER):null;
  if(!validId(uid)||typeof jwtEmail!=="string"||
     !EMAIL.test(jwtEmail)||jwtEmail!==jwtEmail.trim()||
     request?.auth?.token?.email_verified!==true||
     !match||request?.data?.workspaceCompanyId!==undefined||
     request?.data?.codeSessionToken!==undefined||
     request?.data?.uid!==undefined||
     request?.data?.ownerUid!==undefined)
   fail("unauthenticated");
  const auth=getAuth();
  let decoded,authUser;
  try{[decoded,authUser]=await Promise.all([
   auth.verifyIdToken(match[1],true),auth.getUser(uid)
  ])}catch{fail("unauthenticated")}
  const email=jwtEmail.toLowerCase();
  verifyIdentity(authUser,decoded,uid,email);
  const read=ref=>tx?tx.get(ref):ref.get();
  const us=await read(db.collection("users").doc(uid));
  const u=us?.data?.()||{},cid=u.companyId;
  if(!validId(cid)||u.uid!==uid||u.active!==true||
     u.companyRole!=="owner"||u.authKind==="partner_code_shared")
   fail();
  const [cs,ms]=await Promise.all([
   read(db.collection("companies").doc(cid)),
   read(db.collection("companies").doc(cid).collection("members").doc(uid))
  ]);
  const c=cs?.data?.()||{};
  if(!cs?.exists||c.active!==true||
     (c.companyKind!=null&&!["internal","direct"].includes(c.companyKind))||
     !validId(c.ownerUid))fail();
  validateActorDocuments({uid,cid,us,ms});
  if(c.ownerUid===uid)
   return Object.freeze({kind:"hub",role:"owner",uid,hubId:cid,
     ownerGrant:"primary"});
  // Never infer authorization from the two owner-role documents alone.
  // Explicit delegated privilege must be written by a separately reviewed
  // primary-Owner-only transaction, not by the client or this verifier.
  const delegates=c.approvedHubOwnerUids;
  if(!Array.isArray(delegates)||delegates.length<1||delegates.length>10||
     new Set(delegates).size!==delegates.length||
     delegates.some(x=>!validId(x)||x===c.ownerUid)||
     !delegates.includes(uid))fail();
  const [pus,pms]=await Promise.all([
   read(db.collection("users").doc(c.ownerUid)),
   read(db.collection("companies").doc(cid).collection("members").doc(c.ownerUid))
  ]);
  validateActorDocuments({uid:c.ownerUid,cid,us:pus,ms:pms});
  let primaryAuth;
  try{primaryAuth=await auth.getUser(c.ownerUid)}catch{fail()};
  if(!primaryAuth||primaryAuth.uid!==c.ownerUid||primaryAuth.disabled===true||
     primaryAuth.emailVerified!==true)fail();
  return Object.freeze({kind:"hub",role:"owner",uid,hubId:cid,
   ownerGrant:"explicit-delegate"});
 };
}
module.exports={makeExplicitHubOwnerVerifier};
