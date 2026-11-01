"use strict";
const crypto=require("node:crypto");
const {promisify}=require("node:util");
const scrypt=promisify(crypto.scrypt);
const CODE=/^NICO-[A-F0-9]{24}$/,ID=/^[A-Za-z0-9_-]{1,128}$/;
const clean=x=>typeof x==="string"?x.trim():"";
const newCode=()=>("NICO-"+crypto.randomBytes(12).toString("hex").toUpperCase());
const passwordValid=x=>typeof x==="string"&&x.length>=12&&x.length<=128&&Buffer.byteLength(x,"utf8")<=256;
const secretHash=async(secret,salt)=>(await scrypt(secret,Buffer.from(salt,"base64url"),64)).toString("base64url");
const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const salt=()=>crypto.randomBytes(24).toString("base64url");

function makeCompanyCodeAuth({db,getAuth,FieldValue,Timestamp,HttpsError,enabled=()=>false,now=()=>Date.now()}){
 if(!db||!getAuth||!FieldValue||!Timestamp||!HttpsError)throw Error("missing dependencies");
 const fail=(code="permission-denied")=>{throw new HttpsError(code,"会社コードまたは認証情報を確認してください。")};
 const gate=()=>{if(!enabled())fail("unavailable")};
 const doc=(collection,id)=>db.collection(collection).doc(id);
 const field=()=>FieldValue.serverTimestamp();
 async function verifyHubOwner(request){
  gate();
  const uid=request?.auth?.uid,email=clean(request?.auth?.token?.email).toLowerCase();
  const bearer=request?.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!ID.test(uid||"")||!email||request.auth.token.email_verified!==true||!bearer)fail("unauthenticated");
  let user,verified;
  try{[user,verified]=await Promise.all([getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)])}
  catch{fail("unauthenticated")}
  if(user.disabled||user.emailVerified!==true||clean(user.email).toLowerCase()!==email||
   verified.uid!==uid||verified.email_verified!==true||clean(verified.email).toLowerCase()!==email)
   fail("unauthenticated");
  const us=await doc("users",uid).get(),profile=us.data()||{},cid=clean(profile.companyId);
  if(!us.exists||!ID.test(cid)||profile.uid!==uid||profile.companyRole!=="owner"||
     profile.active!==true||(profile.accessKind!=null&&profile.accessKind!=="internal"))fail();
  const companyRef=doc("companies",cid);
  const [cs,ms]=await Promise.all([companyRef.get(),companyRef.collection("members").doc(uid).get()]);
  const company=cs.data()||{},member=ms.data()||{};
  if(!cs.exists||!ms.exists||company.ownerUid!==uid||company.active!==true||
   (company.companyKind!=null&&!["internal","direct"].includes(company.companyKind))||
   member.uid!==uid||member.companyRole!=="owner"||member.active!==true||
   (member.accessKind!=null&&member.accessKind!=="internal"))fail();
  return {uid,hub:cid};
 }
 async function issue(request){
  const owner=await verifyHubOwner(request),d=request.data||{};
  const partnerId=clean(d.partnerCompanyId);
  const companyName=clean(d.companyName).replace(/\s+/g," ");
  if(partnerId&&!ID.test(partnerId)||!partnerId&&
     (companyName.length<2||companyName.length>80))fail("invalid-argument");
  if(partnerId){
   const [cs,rs]=await Promise.all([doc("companies",partnerId).get(),doc("partnerRelations",partnerId).get()]);
   const c=cs.data()||{},rel=rs.data()||{};
   if(!cs.exists||!rs.exists||c.companyKind!=="partner"||c.active!==true||
     c.hubCompanyId!==owner.hub||rel.partnerCompanyId!==partnerId||
     rel.hubCompanyId!==owner.hub||rel.active!==true||
     rel.countSharingApproved!==true)fail();
  }
  const code=newCode(),expiresAt=now()+7*86400000;
  await doc("partnerCodeLogins",code).create({
   companyCode:code,status:"pending",hubCompanyId:owner.hub,
   partnerCompanyId:partnerId||null,companyName:partnerId?null:companyName,
   issuedByUid:owner.uid,expiresAt:Timestamp.fromMillis(expiresAt),
   createdAt:field()
  });
  return {companyCode:code,expiresAt};
 }

module.exports={CODE,ID,clean,newCode,passwordValid,secretHash,safeEqual,salt,makeCompanyCodeAuth};
