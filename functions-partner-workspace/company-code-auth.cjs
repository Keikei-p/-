"use strict";
const crypto=require("node:crypto");
const {promisify}=require("node:util");
const scrypt=promisify(crypto.scrypt);
const CODE=/^NICO-[A-F0-9]{24}$/,ID=/^[A-Za-z0-9_-]{1,128}$/;
const clean=x=>typeof x==="string"?x.trim():"";
const invalidCompanyName=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
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
     (companyName.length<2||companyName.length>80||invalidCompanyName.test(companyName)))fail("invalid-argument");
  if(partnerId){
   const [cs,rs,cred]=await Promise.all([
    doc("companies",partnerId).get(),doc("partnerRelations",partnerId).get(),
    doc("partnerCodeCredentials",partnerId).get()
   ]);
   if(cred.exists)fail("already-exists");
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

 async function activate(request){
  gate();
  const d=request?.data||{},code=clean(d.companyCode).toUpperCase(),pass=d.password;
  if(!CODE.test(code)||!passwordValid(pass))fail("invalid-argument");
  const loginRef=doc("partnerCodeLogins",code),newPartnerRef=db.collection("companies").doc();
  const principalUid="pc_"+crypto.randomBytes(18).toString("base64url");
  const principalRef=doc("users",principalUid),keySalt=salt(),hash=await secretHash(pass,keySalt);
  let companyId="";
  await db.runTransaction(async tx=>{
   const [inviteSnap,principalSnap]=await Promise.all([tx.get(loginRef),tx.get(principalRef)]);
   const invite=inviteSnap.data()||{};
   if(!inviteSnap.exists||invite.status!=="pending"||!ID.test(invite.hubCompanyId||"")||
      !ID.test(invite.issuedByUid||"")||typeof invite.expiresAt?.toMillis!=="function"||
      invite.expiresAt.toMillis()<=now()||principalSnap.exists)
    fail("failed-precondition");
   const hubRef=doc("companies",invite.hubCompanyId);
   const [hubSnap,issuerSnap,issuerMember]=await Promise.all([
    tx.get(hubRef),tx.get(doc("users",invite.issuedByUid)),
    tx.get(hubRef.collection("members").doc(invite.issuedByUid))
   ]);
   const hub=hubSnap.data()||{},issuer=issuerSnap.data()||{},hm=issuerMember.data()||{};
   if(!hubSnap.exists||!issuerSnap.exists||!issuerMember.exists||
      hub.ownerUid!==invite.issuedByUid||hub.active!==true||
      (hub.companyKind!=null&&!["internal","direct"].includes(hub.companyKind))||
      issuer.companyId!==invite.hubCompanyId||issuer.active!==true||
      issuer.companyRole!=="owner"||hm.active!==true||
      hm.companyRole!=="owner"||hm.uid!==invite.issuedByUid)fail();
   companyId=invite.partnerCompanyId||newPartnerRef.id;
   if(!ID.test(companyId))fail();
   const companyRef=doc("companies",companyId);
   const relationRef=doc("partnerRelations",companyId);
   const memberRef=companyRef.collection("members").doc(principalUid);
   const credentialRef=doc("partnerCodeCredentials",companyId);
   const [cs,rs,ms,credentialsSnap]=await Promise.all([
    tx.get(companyRef),tx.get(relationRef),tx.get(memberRef),tx.get(credentialRef)
   ]);
   if(ms.exists||credentialsSnap.exists)fail("already-exists");
   const partner=cs.data()||{},relation=rs.data()||{};
   if(invite.partnerCompanyId){
    if(!cs.exists||!rs.exists||partner.active!==true||
     partner.companyKind!=="partner"||partner.hubCompanyId!==invite.hubCompanyId||
     partner.companyCodePrincipalUid!=null||
     relation.partnerCompanyId!==companyId||
     relation.hubCompanyId!==invite.hubCompanyId||
     relation.active!==true||relation.countSharingApproved!==true)fail();
   }else if(cs.exists||rs.exists||clean(invite.companyName).length<2||invalidCompanyName.test(invite.companyName)){
    fail("failed-precondition");
   }
   const common={uid:principalUid,companyId,companyRole:"owner",role:"leader",
    teamId:null,active:true,authKind:"partner_code_shared",
    accessKind:"partner",memberType:"cooperator",
    canViewRevenue:false,canViewUnitPrice:false,canCreateInvite:false};
   if(invite.partnerCompanyId){
    tx.update(companyRef,{companyCodePrincipalUid:principalUid});
   }else{
    tx.create(companyRef,{name:invite.companyName,ownerUid:principalUid,
      masterUid:principalUid,companyCodePrincipalUid:principalUid,
      hubCompanyId:invite.hubCompanyId,companyKind:"partner",active:true,
      createdBy:invite.issuedByUid,createdAt:field()});
    tx.create(relationRef,{partnerCompanyId:companyId,hubCompanyId:invite.hubCompanyId,
      active:true,countSharingApproved:true,catalogAccessApproved:false,createdAt:field()});
   }
   tx.create(principalRef,{...common,createdAt:field()});
   tx.create(memberRef,{...common,joinedAt:field()});
   tx.create(credentialRef,{companyId,companyCode:code,principalUid,active:true,version:1});
   tx.update(loginRef,{status:"active",partnerCompanyId:companyId,
      principalUid,hash,salt:keySalt,version:1,failedAttempts:0,lockedUntil:0,
      activatedAt:field()});
  });
  return {activated:true,companyId,companyCode:code};
 }

 async function login(request){
  gate();
  const d=request?.data||{},code=clean(d.companyCode).toUpperCase(),pass=d.password;
  if(!CODE.test(code)||typeof pass!=="string"||pass.length>128||
      Buffer.byteLength(pass,"utf8")>256)fail("invalid-argument");
  const loginRef=doc("partnerCodeLogins",code);
  const sn=await loginRef.get(),record=sn.data()||{};
  if(!sn.exists||record.status!=="active"||!ID.test(record.principalUid||"")||
    !ID.test(record.partnerCompanyId||"")||typeof record.salt!=="string"||
    typeof record.hash!=="string"||Number(record.lockedUntil||0)>now())fail();
  const hashed=await secretHash(pass,record.salt);
  let authenticated=false;
  await db.runTransaction(async tx=>{
   const fresh=await tx.get(loginRef),f=fresh.data()||{};
   const cid=clean(f.partnerCompanyId);
   if(!fresh.exists||f.status!=="active"||!ID.test(cid)||
      f.principalUid!==record.principalUid||f.hash!==record.hash||
      f.salt!==record.salt||f.version!==record.version||
      Number(f.lockedUntil||0)>now())fail();
   const [cs,rs,us,ms,credSnap]=await Promise.all([
    tx.get(doc("companies",cid)),tx.get(doc("partnerRelations",cid)),
    tx.get(doc("users",f.principalUid)),
    tx.get(doc("companies",cid).collection("members").doc(f.principalUid)),
    tx.get(doc("partnerCodeCredentials",cid))
   ]);
   const c=cs.data()||{},rel=rs.data()||{},u=us.data()||{},
    m=ms.data()||{},cred=credSnap.data()||{};
   if(!cs.exists||!rs.exists||!us.exists||!ms.exists||!credSnap.exists||
     c.active!==true||c.companyKind!=="partner"||
     c.companyCodePrincipalUid!==f.principalUid||
     rel.active!==true||rel.countSharingApproved!==true||
     rel.hubCompanyId!==c.hubCompanyId||rel.partnerCompanyId!==cid||
     cred.active!==true||cred.companyCode!==code||cred.companyId!==cid||
     cred.principalUid!==f.principalUid||cred.version!==f.version||
     u.authKind!=="partner_code_shared"||m.authKind!=="partner_code_shared"||
     u.active!==true||m.active!==true||
     u.canViewRevenue!==false||u.canViewUnitPrice!==false||
     m.canViewRevenue!==false||m.canViewUnitPrice!==false||
     u.companyId!==cid||m.companyId!==cid)fail();
   if(!passwordValid(pass)||!safeEqual(hashed,f.hash)){
    const attempts=Number(f.failedAttempts||0)+1;
    tx.update(loginRef,{failedAttempts:attempts>=8?0:attempts,
      lockedUntil:attempts>=8?now()+15*60000:0});
    return;
   }
   tx.update(loginRef,{failedAttempts:0,lockedUntil:0});
   authenticated=true;
  });
  if(!authenticated)fail();
  // A server-only session intentionally does NOT create a Firebase Auth
  // account or ID token; Firestore Rules therefore cannot be bypassed.
  const sessionToken=crypto.randomBytes(32).toString("base64url");
  const expiresAt=now()+12*60*60*1000;
  const sessionHash=crypto.createHash("sha256").update(sessionToken).digest("hex");
  await doc("partnerCodeSessions",sessionHash).create({
   principalUid:record.principalUid,companyId:record.partnerCompanyId,
   companyCode:code,version:record.version,active:true,
   expiresAt:Timestamp.fromMillis(expiresAt),createdAt:field()
  });
  return {sessionToken,expiresAt};
 }
 async function logout(request){
  gate();
  const token=clean(request?.data?.codeSessionToken);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail("unauthenticated");
  const hash=crypto.createHash("sha256").update(token).digest("hex");
  const sr=doc("partnerCodeSessions",hash);
  await db.runTransaction(async tx=>{
   const sn=await tx.get(sr);
   if(sn.exists&&sn.data()?.active===true)
    tx.update(sr,{active:false,revokedAt:field()});
  });
  return {ended:true};
 }
 return Object.freeze({issue,activate,login,logout});
}

module.exports={CODE,ID,clean,newCode,passwordValid,secretHash,safeEqual,salt,makeCompanyCodeAuth};
