"use strict";
/**
 * ISOLATED / FEATURE OFF BY DEFAULT. The hub's verified Owner invites
 * a separately verified email Owner to claim an *unclaimed* existing partner.
 * Current company-code principal, every saved count and every old user record
 * remain unchanged. Never auto-claim or grant any finance access.
 */
const crypto=require("node:crypto");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,30}$/;
const NAME=/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u;
const KEY=/^[A-Za-z0-9_-]{40,100}$/;
const exact=(v,keys)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const safeId=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const data=s=>s?.exists===true&&typeof s.data==="function"?s.data():null;
const validMail=x=>typeof x==="string"&&EMAIL.test(x)&&
 x===x.trim().toLowerCase()&&x.length<=180;
const claimable=x=>x?.ownerUid==null||x.ownerUid==="";
function createPartnerOwnerClaimCallables({
 db,FieldValue,Timestamp,getAuth,HttpsError,
 enabled=()=>false,now=()=>Date.now(),randomBytes=crypto.randomBytes,
 trustedModule=()=>import("./vendor/trusted-combined-ranking-context.mjs")
}={}){
 if(!db?.collection||typeof db.runTransaction!=="function"||
    typeof FieldValue?.serverTimestamp!=="function"||
    typeof Timestamp?.fromMillis!=="function"||
    typeof getAuth!=="function"||typeof HttpsError!=="function"||
    typeof enabled!=="function"||typeof now!=="function"||
    typeof randomBytes!=="function"||typeof trustedModule!=="function")
  throw Error("PARTNER_OWNER_CLAIM_DEPENDENCIES");
 let cached;
 const failure=(code,label)=>{throw new HttpsError(code,label)};
 const off=()=>failure("failed-precondition","partner_owner_claim_not_enabled");
 const invalid=()=>failure("invalid-argument","partner_owner_claim_invalid_request");
 const denied=()=>failure("permission-denied","partner_owner_claim_denied");
 const unauth=()=>failure("unauthenticated","partner_owner_claim_login_required");
 const company=x=>db.collection("companies").doc(x);
 const relation=x=>db.collection("partnerRelations").doc(x);
 const users=x=>db.collection("users").doc(x);
 const contexts=x=>db.collection("partnerWorkspaceContexts").doc(x);
 const pending=x=>company(x).collection("partnerOwnerClaimPending").doc("current");
 const invitation=x=>db.collection("partnerOwnerClaimInvites").doc(x);
 const tokenHash=x=>crypto.createHash("sha256").update(x).digest("hex");
 async function principal(request,keys){
  // This guard MUST run before credential, Firestore or dynamic import access.
  if(enabled()!==true)off();
  if(!exact(request?.data,keys))invalid();
  const uid=request?.auth?.uid,email=request?.auth?.token?.email;
  if(!safeId(uid)||request?.auth?.token?.email_verified!==true||
     typeof email!=="string"||!validMail(email.trim().toLowerCase()))unauth();
  const bearer=request?.rawRequest?.headers?.authorization;
  const token=typeof bearer==="string"?
   bearer.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1]:null;
  if(!token)unauth();
  let actor;
  try{
   const t=await(cached??=(Promise.resolve().then(()=>trustedModule())));
   if(typeof t?.createVerifiedRankTokenReader!=="function")unauth();
   actor=await t.createVerifiedRankTokenReader({auth:getAuth()})(token);
  }catch{unauth()}
  if(actor.uid!==uid||actor.email!==email.trim().toLowerCase()||
     actor.emailVerified!==true)unauth();
  return actor;
 }
 async function hubOwner(tx,actor){
  const [us,secondary]=await Promise.all([
   tx.get(users(actor.uid)),tx.get(contexts(actor.uid))
  ]);
  const u=data(us),ctx=data(secondary);
  if(!u||!safeId(u.companyId)||u.uid!==actor.uid||
     u.active!==true||u.companyRole!=="owner"||
     u.authKind==="partner_code_shared"||
     (u.accessKind!=null&&u.accessKind!=="internal")||
     (u.memberType!=null&&
      !["internal","direct","member","managed"].includes(u.memberType))||
     (typeof u.email==="string"&&u.email.trim().toLowerCase()!==actor.email)||
     (secondary.exists&&ctx?.active!==false))denied();
  const hub=u.companyId;
  const [cs,ms]=await Promise.all([
   tx.get(company(hub)),tx.get(company(hub).collection("members").doc(actor.uid))
  ]);
  const c=data(cs),m=data(ms);
  if(!c||!m||c.ownerUid!==actor.uid||c.active===false||
     ![undefined,null,"internal","direct"].includes(c.companyKind)||
     m.uid!==actor.uid||m.companyRole!=="owner"||m.active!==true||
     (m.companyId!=null&&m.companyId!==hub)||
     m.authKind==="partner_code_shared"||
     (m.accessKind!=null&&m.accessKind!=="internal"))denied();
  return hub;
 }
 async function partnerFromHub(tx,hub,partnerId){
  if(!safeId(partnerId)||partnerId===hub)invalid();
  const [ps,rs]=await Promise.all([
   tx.get(company(partnerId)),tx.get(relation(partnerId))
  ]);
  const p=data(ps),rel=data(rs);
  if(!p||!rel||p.companyKind!=="partner"||p.hubCompanyId!==hub||
     p.active!==true||!claimable(p)||
     rel.partnerCompanyId!==partnerId||rel.hubCompanyId!==hub||
     rel.active!==true||rel.countSharingApproved!==true)denied();
  return p;
 }
 const validDate=x=>Number.isSafeInteger(x)&&x>0&&x<8640000000000000;
 const toMillis=x=>typeof x?.toMillis==="function"?x.toMillis():NaN;
 async function issue(request){
  const actor=await principal(request,["partnerCompanyId","email"]);
  const d=request.data,partnerId=d.partnerCompanyId;
  if(!safeId(partnerId)||!validMail(d.email)||
     d.email===actor.email)invalid();
  const bytes=randomBytes(32);
  if(!Buffer.isBuffer(bytes)||bytes.length!==32)denied();
  const token=bytes.toString("base64url"),hash=tokenHash(token);
  if(!KEY.test(token)||!/^([a-f0-9]{64})$/.test(hash))denied();
  const exp=now()+30*60*1000;
  if(!validDate(exp))denied();
  await db.runTransaction(async tx=>{
   const hub=await hubOwner(tx,actor);
   await partnerFromHub(tx,hub,partnerId);
   const ps=pending(partnerId),inv=invitation(hash);
   const [old,fresh]=await Promise.all([tx.get(ps),tx.get(inv)]);
   if(fresh.exists)denied();
   const previous=data(old);
   if(previous){
    if(previous.partnerCompanyId!==partnerId||previous.hubCompanyId!==hub||
       typeof previous.hash!=="string"||
       !/^[a-f0-9]{64}$/.test(previous.hash)||
       !["pending","accepted"].includes(previous.status)||
       !validDate(toMillis(previous.expiresAt)))denied();
    if(previous.status==="accepted"||
       toMillis(previous.expiresAt)>now())denied();
   }
   const stamp=FieldValue.serverTimestamp();
   const record={
    schema:"nico-partner-owner-invite-v1",hubCompanyId:hub,
    partnerCompanyId:partnerId,emailLower:d.email,
    invitedByUid:actor.uid,status:"pending",
    expiresAt:Timestamp.fromMillis(exp),issuedAt:stamp
   };
   tx.create(inv,record);
   const marker={
    hubCompanyId:hub,partnerCompanyId:partnerId,hash,status:"pending",
    expiresAt:Timestamp.fromMillis(exp),issuedAt:stamp
   };
   if(old.exists)tx.update(ps,marker);
   else tx.create(ps,marker);
   tx.create(company(partnerId).collection("partnerOwnerClaimAudits").doc(),{
    action:"invite_issued",hubCompanyId:hub,partnerCompanyId:partnerId,
    issuedByUid:actor.uid,issuedAt:stamp
   });
  });
  return {issued:true,token,expiresAt:exp,partnerCompanyId:partnerId};
 }
 const parseInvite=async(tx,hash,actor)=>{
  const current=await tx.get(invitation(hash)),i=data(current);
  if(!i||i.schema!=="nico-partner-owner-invite-v1"||
     i.status!=="pending"||!safeId(i.hubCompanyId)||
     !safeId(i.partnerCompanyId)||!safeId(i.invitedByUid)||
     i.partnerCompanyId===i.hubCompanyId||
     !validMail(i.emailLower)||i.emailLower!==actor.email||
     i.invitedByUid===actor.uid||
     !validDate(toMillis(i.expiresAt))||
     toMillis(i.expiresAt)<=now())denied();
  const mark=await tx.get(pending(i.partnerCompanyId)),m=data(mark);
  if(!m||m.hash!==hash||m.hubCompanyId!==i.hubCompanyId||
     m.partnerCompanyId!==i.partnerCompanyId||
     m.status!=="pending"||
     toMillis(m.expiresAt)!==toMillis(i.expiresAt))denied();
  return {i,current,mark,marker:m};
 };
 async function preview(request){
  const actor=await principal(request,["token"]);
  const token=request.data.token;
  if(typeof token!=="string"||!KEY.test(token))invalid();
  return db.runTransaction(async tx=>{
   const {i}=await parseInvite(tx,tokenHash(token),actor);
   const [p,rel]=await Promise.all([
    tx.get(company(i.partnerCompanyId)),tx.get(relation(i.partnerCompanyId))
   ]);
   const companyDoc=data(p),relationDoc=data(rel);
   if(!companyDoc||!relationDoc||companyDoc.companyKind!=="partner"||
      companyDoc.hubCompanyId!==i.hubCompanyId||
      companyDoc.active!==true||!claimable(companyDoc)||
      relationDoc.hubCompanyId!==i.hubCompanyId||
      relationDoc.partnerCompanyId!==i.partnerCompanyId||
      relationDoc.active!==true||relationDoc.countSharingApproved!==true)
    denied();
   const name=companyDoc.name;
   if(typeof name!=="string"||name.trim().length<1||
      name.length>80||/(?:売上|単価|報酬|キャッシュバック|[¥￥$€]|\d{3,}円)/.test(name))
    denied();
   return {schema:"nico-partner-owner-claim-preview-v1",
    companyName:name,expiresAt:toMillis(i.expiresAt),needsConsent:true,
    futureFinancialRoleFlagsFalse:true};
  },{readOnly:true});
 }
 async function accept(request){
  const actor=await principal(request,["token","displayName","confirm"]);
  const {token,displayName,confirm}=request.data;
  if(typeof token!=="string"||!KEY.test(token)||
     typeof displayName!=="string"||!NAME.test(displayName)||
     confirm!==true)invalid();
  return db.runTransaction(async tx=>{
   const hash=tokenHash(token);
   const {i,current,mark}=await parseInvite(tx,hash,actor);
   // Hub owner must STILL be active, uniquely authorized and unchanged
   // since issuing. Never trust the invitation document alone.
   const issuer={uid:i.invitedByUid,email:""};
   const issuerUser=await tx.get(users(issuer.uid));
   const savedUser=data(issuerUser);
   if(!savedUser||!safeId(savedUser.companyId)||
      savedUser.companyId!==i.hubCompanyId||
      savedUser.companyRole!=="owner"||savedUser.active!==true||
      savedUser.authKind==="partner_code_shared"||
      (savedUser.accessKind!=null&&savedUser.accessKind!=="internal"))denied();
   // Legacy hub Owner profiles may have no Firestore email. Never use the
   // invited partner's email as a fallback: resolve the issuer's own
   // verified Auth email, and reject any conflicting stored identity.
   const storedIssuerEmail=typeof savedUser.email==="string"?
    savedUser.email.trim().toLowerCase():null;
   if(storedIssuerEmail!==null&&!validMail(storedIssuerEmail))denied();
   let issuerAuth;
   try{issuerAuth=await getAuth().getUser(issuer.uid);}catch{denied()}
   const verifiedIssuerEmail=typeof issuerAuth?.email==="string"?
    issuerAuth.email.trim().toLowerCase():"";
   if(!issuerAuth||issuerAuth.uid!==issuer.uid||
      issuerAuth.disabled===true||issuerAuth.emailVerified!==true||
      !validMail(verifiedIssuerEmail)||
      verifiedIssuerEmail===actor.email||
      (storedIssuerEmail!==null&&storedIssuerEmail!==verifiedIssuerEmail))
    denied();
   issuer.email=verifiedIssuerEmail;
   if(await hubOwner(tx,issuer)!==i.hubCompanyId)denied();
   const p=await partnerFromHub(tx,i.hubCompanyId,i.partnerCompanyId);
   // Reject ALL existing user/secondary membership, even old internal email:
   // their counts, finance roles and histories must not be rewritten.
   const memberRef=company(i.partnerCompanyId).collection("members").doc(actor.uid);
   const [existingUser,existingMember,existingContext]=await Promise.all([
    tx.get(users(actor.uid)),tx.get(memberRef),tx.get(contexts(actor.uid))
   ]);
   if(existingUser.exists||existingMember.exists||existingContext.exists)denied();
   const nowStamp=FieldValue.serverTimestamp();
   const profile={
    uid:actor.uid,companyId:i.partnerCompanyId,
    email:actor.email,name:displayName,role:"leader",
    companyRole:"owner",teamId:null,active:true,
    authKind:"verified_partner_owner",accessKind:"partner",
    memberType:"cooperator",canViewRevenue:false,
    canViewUnitPrice:false,canCreateInvite:false
   };
   tx.update(company(i.partnerCompanyId),{
    ownerUid:actor.uid,ownerClaimedAt:nowStamp
   });
   tx.create(users(actor.uid),{...profile,createdAt:nowStamp});
   tx.create(memberRef,{...profile,joinedAt:nowStamp});
   tx.update(invitation(hash),{status:"accepted",acceptedByUid:actor.uid,
    acceptedAt:nowStamp});
   tx.update(pending(i.partnerCompanyId),{status:"accepted",acceptedByUid:actor.uid,
    acceptedAt:nowStamp});
   tx.create(company(i.partnerCompanyId).collection("partnerOwnerClaimAudits").doc(),{
    action:"owner_claimed",partnerCompanyId:i.partnerCompanyId,
    hubCompanyId:i.hubCompanyId,acceptedByUid:actor.uid,
    issuedByUid:i.invitedByUid,createdAt:nowStamp
   });
   return {claimed:true,partnerCompanyId:i.partnerCompanyId,
    companyRole:"owner",financialRoleFlagsFalse:true};
  });
 }
 return Object.freeze({issue,preview,accept});
}
module.exports={createPartnerOwnerClaimCallables};
