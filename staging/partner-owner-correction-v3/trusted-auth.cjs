"use strict";
/**
 * STAGING ONLY / NO DEPLOY: bind the staged owner count correction service
 * to an actual server-verified Firebase principal and live internal company
 * ownership. Client-supplied uid, company IDs, roles and finance flags
 * are not treated as authorization.
 *
 * This is a separate, default-disabled adapter. It changes no published
 * workspace exports, Firestore Rules, Firebase configuration or stored data.
 */
const {makeHubCountCorrections}=require("./service.cjs");

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BEARER=/^Bearer ([A-Za-z0-9._-]{20,12000})$/i;
const INTERNAL_MEMBER_TYPES=new Set(["internal","direct","member","managed"]);
const safeId=value=>typeof value==="string"&&ID.test(value);
const internalFlag=value=>value==null||value==="internal";
const internalMember=value=>value==null||INTERNAL_MEMBER_TYPES.has(value);

function makeTrustedHubOwnerVerifier({db,getAuth,HttpsError,enabled=()=>false}={}){
 if(!db||typeof getAuth!=="function"||typeof HttpsError!=="function"||
    typeof enabled!=="function")
  throw Error("TRUSTED_OWNER_AUTH_DEPENDENCIES");
 const fail=(code="permission-denied")=>{
  throw new HttpsError(code,"この自社オーナーの本人確認・所属を検証できません。");
 };
 return async function verifyHubOwner(request,tx=null){
  if(enabled()!==true)fail("unavailable");
  const uid=request?.auth?.uid;
  const jwtEmail=request?.auth?.token?.email;
  const header=request?.rawRequest?.headers?.authorization;
  const bearer=typeof header==="string"?header.match(BEARER)?.[1]:null;
  // Company-code and switched partner roles must never gain hub privileges.
  if(!safeId(uid)||typeof jwtEmail!=="string"||
     !EMAIL.test(jwtEmail)||jwtEmail!==jwtEmail.trim()||
     request?.auth?.token?.email_verified!==true||!bearer||
     request?.data?.codeSessionToken!==undefined||
     request?.data?.workspaceCompanyId!==undefined)
   fail("unauthenticated");
  let token,user;
  try{
   const auth=getAuth();
   [token,user]=await Promise.all([
    auth.verifyIdToken(bearer,true),auth.getUser(uid)
   ]);
  }catch{fail("unauthenticated");}
  const email=jwtEmail.toLowerCase();
  if(token?.uid!==uid||token?.email_verified!==true||
     typeof token.email!=="string"||token.email.toLowerCase()!==email||
     !user||user.uid!==uid||user.disabled===true||
     user.emailVerified!==true||typeof user.email!=="string"||
     user.email.toLowerCase()!==email)
   fail("unauthenticated");

  const read=ref=>tx?tx.get(ref):ref.get();
  const us=await read(db.collection("users").doc(uid));
  const u=us.data()||{},hubId=u.companyId;
  if(!us.exists||u.uid!==uid||u.active!==true||!safeId(hubId)||
     u.authKind==="partner_code_shared"||u.companyRole!=="owner"||
     !internalFlag(u.accessKind)||!internalMember(u.memberType))
   fail();

  const [cs,ms]=await Promise.all([
   read(db.collection("companies").doc(hubId)),
   read(db.collection("companies").doc(hubId).collection("members").doc(uid))
  ]);
  const c=cs.data()||{},m=ms.data()||{};
  if(!cs.exists||!ms.exists||c.active!==true||
     (c.companyKind!=null&&!["internal","direct"].includes(c.companyKind))||
     c.ownerUid!==uid||m.active!==true||m.uid!==uid||
     (m.companyId!=null&&m.companyId!==hubId)||
     m.companyRole!=="owner"||m.companyRole!==u.companyRole||
     !internalFlag(m.accessKind)||!internalMember(m.memberType))
   fail();

  return Object.freeze({kind:"hub",role:"owner",uid,hubId});
 };
}

function makeAuthenticatedOwnerCorrectionV3({
 db,getAuth,FieldValue,HttpsError,enabled=()=>false,now
}={}){
 const verifyHubOwner=makeTrustedHubOwnerVerifier({
  db,getAuth,HttpsError,enabled
 });
 return makeHubCountCorrections({
  db,FieldValue,HttpsError,verifyHubOwner,enabled,
  ...(now===undefined?{}:{now})
 });
}

module.exports={makeTrustedHubOwnerVerifier,makeAuthenticatedOwnerCorrectionV3};
