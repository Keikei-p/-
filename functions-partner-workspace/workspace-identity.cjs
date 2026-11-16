"use strict";
// Existing workspace identity checks, shared with the read-only count ranking.
// No business-data writes or financial collection access exist in this module.
const crypto=require("node:crypto");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean=x=>typeof x==="string"?x.trim():"";
function makeWorkspaceIdentity({db,getAuth,HttpsError,enabled=()=>false,now=()=>Date.now()}={}){
 if(!db||!getAuth||!HttpsError)throw Error("missing_workspace_identity_dependency");
 const fail=(code="permission-denied")=>{throw new HttpsError(code,"権限・入力内容を確認できません。");};
 const collection=(cid,name)=>db.collection("companies").doc(cid).collection(name);
 async function actor(request,tx=null){
  if(enabled()!==true)fail("unavailable");
  const read=ref=>tx?tx.get(ref):ref.get();
  const opaque=clean(request?.data?.codeSessionToken);
  if(opaque){
   if(request?.auth?.uid||!/^[A-Za-z0-9_-]{43}$/.test(opaque))fail("unauthenticated");
   const hash=crypto.createHash("sha256").update(opaque).digest("hex");
   const ss=await read(db.collection("partnerCodeSessions").doc(hash));
   const session=ss.data()||{},uid=session.principalUid,cid=session.companyId;
   if(!ss.exists||session.active!==true||!ID.test(uid||"")||
      !ID.test(cid||"")||!Number.isSafeInteger(session.version)||
      session.version<1||typeof session.expiresAt?.toMillis!=="function"||
      session.expiresAt.toMillis()<=now()||
      !/^NICO-[A-F0-9]{24}$/.test(session.companyCode||""))fail("unauthenticated");
   const [credentials,login]=await Promise.all([
    read(db.collection("partnerCodeCredentials").doc(cid)),
    read(db.collection("partnerCodeLogins").doc(session.companyCode))
   ]);
   const c=credentials.data()||{},l=login.data()||{};
   if(!credentials.exists||!login.exists||c.active!==true||
      c.companyId!==cid||c.principalUid!==uid||c.companyCode!==session.companyCode||
      c.version!==session.version||l.status!=="active"||
      l.principalUid!==uid||l.partnerCompanyId!==cid||
      l.version!==session.version)fail("unauthenticated");
   return {uid,email:"",codeAuth:true,companyId:cid};
  }
  const uid=request?.auth?.uid,email=clean(request?.auth?.token?.email).toLowerCase();
  if(!ID.test(uid||""))fail("unauthenticated");
  const bearer=request?.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!bearer)fail("unauthenticated");
  let a,t;
  try{[a,t]=await Promise.all([getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)]);}
  catch{fail("unauthenticated");}
  if(!a||a.disabled===true||t?.uid!==uid)fail("unauthenticated");
  if(!EMAIL.test(email)||request.auth?.token?.email_verified!==true||
     a.emailVerified!==true||clean(a.email).toLowerCase()!==email||
     t.email_verified!==true||clean(t.email).toLowerCase()!==email)fail("unauthenticated");
  return {uid,email};
 }
 async function scope(uid,tx=null,workspaceCompanyId="",countReadOnly=false){
  const read=ref=>tx?tx.get(ref):ref.get();
  const us=await read(db.collection("users").doc(uid));
  const u=us.data()||{},cid=clean(u.companyId);
  if(!us.exists||!ID.test(cid)||u.uid!==uid||u.active!==true)fail();
  // An isolated count-only company principal can manage its own staff/counts.
  // Never promote an old internal user or alter their company / finance flags.
  if(u.authKind==="partner_code_shared"){
   if(workspaceCompanyId||u.accessKind!=="partner"||u.memberType!=="cooperator"||
      u.companyRole!=="owner"||u.canViewRevenue!==false||u.canViewUnitPrice!==false)
    fail();
   const companyRef=db.collection("companies").doc(cid);
   const [cs,ms,rs,credentials]=await Promise.all([
    read(companyRef),read(collection(cid,"members").doc(uid)),
    read(db.collection("partnerRelations").doc(cid)),
    read(db.collection("partnerCodeCredentials").doc(cid))
   ]);
   const c=cs.data()||{},m=ms.data()||{},rel=rs.data()||{},cred=credentials.data()||{};
   if(!cs.exists||!ms.exists||!rs.exists||!credentials.exists||
      c.active!==true||c.companyKind!=="partner"||
      c.companyCodePrincipalUid!==uid||!ID.test(c.hubCompanyId||"")||
      m.uid!==uid||m.companyId!==cid||m.active!==true||
      m.authKind!=="partner_code_shared"||m.accessKind!=="partner"||
      m.memberType!=="cooperator"||m.companyRole!=="owner"||
      m.canViewRevenue!==false||m.canViewUnitPrice!==false||
      rel.active!==true||rel.countSharingApproved!==true||
      rel.hubCompanyId!==c.hubCompanyId||rel.partnerCompanyId!==cid||
      cred.active!==true||cred.principalUid!==uid||cred.companyId!==cid)
    fail();
   return {kind:"partner",uid,cid,hubId:c.hubCompanyId,
     companyName:c.name,role:"owner",teamId:null};
  }
  // Existing-email secondary partner role, without touching original primary
  // company, revenue flags, financial originals, or stored user document.
  if(workspaceCompanyId){
   if(!ID.test(workspaceCompanyId)||workspaceCompanyId===cid||
      (u.accessKind!=null&&u.accessKind!=="internal")||
      (u.memberType!=null&&!["internal","direct","member","managed"].includes(u.memberType)))fail();
   const [ctxSnap,partnerSnap,memberSnap,relationSnap,primaryCompanySnap,primaryMemberSnap]=await Promise.all([
     read(db.collection("partnerWorkspaceContexts").doc(uid)),
     read(db.collection("companies").doc(workspaceCompanyId)),
     read(collection(workspaceCompanyId,"members").doc(uid)),
     read(db.collection("partnerRelations").doc(workspaceCompanyId)),
     read(db.collection("companies").doc(cid)),
     read(collection(cid,"members").doc(uid))
   ]);
   const ctx=ctxSnap.data()||{},pc=partnerSnap.data()||{},
     pm=memberSnap.data()||{},rel=relationSnap.data()||{},
     originalCompany=primaryCompanySnap.data()||{},originalMember=primaryMemberSnap.data()||{};
   // The original identity must still be current and internally verified.
   if(!primaryCompanySnap.exists||!primaryMemberSnap.exists||
      originalCompany.active===false||
      (originalCompany.companyKind!=null&&!["internal","direct"].includes(originalCompany.companyKind))||
      originalMember.active===false||
      (originalMember.uid!=null&&originalMember.uid!==uid)||
      (originalMember.companyId!=null&&originalMember.companyId!==cid)||
      (originalMember.accessKind!=null&&originalMember.accessKind!=="internal")||
      ["partner","cooperator"].includes(originalMember.memberType))fail();
   const partnerOwner=ctx.role==="owner"&&pc.ownerUid===uid&&pc.masterUid===uid&&
      pm.companyRole==="owner"&&pm.role==="leader"&&pm.teamId==null;
   const partnerWorker=["leader","member"].includes(ctx.role)&&
      pm.companyRole==="member"&&pm.role===ctx.role&&
      ID.test(ctx.teamId||"")&&pm.teamId===ctx.teamId&&pc.ownerUid!==uid;
   if(!partnerOwner&&!partnerWorker)fail();
   if(!ctxSnap.exists||!partnerSnap.exists||!memberSnap.exists||
      !relationSnap.exists||ctx.active!==true||
      ctx.kind!=="partner_secondary"||ctx.uid!==uid||
      ctx.primaryCompanyId!==cid||ctx.partnerCompanyId!==workspaceCompanyId||
      ctx.hubCompanyId!==pc.hubCompanyId||
      (u.email&&ctx.emailLower!==clean(u.email).toLowerCase())||
      pc.active!==true||
      pc.companyKind!=="partner"||!ID.test(pc.hubCompanyId||"")||
      pm.active!==true||pm.uid!==uid||
      pm.companyId!==workspaceCompanyId||
      pm.accessKind!=="partner"||pm.memberType!=="cooperator"||
      pm.canViewRevenue!==false||pm.canViewUnitPrice!==false||
      rel.hubCompanyId!==pc.hubCompanyId||
      rel.partnerCompanyId!==workspaceCompanyId||
      rel.active!==true||rel.countSharingApproved!==true)fail();
   return {kind:"partner",uid,cid:workspaceCompanyId,
     hubId:pc.hubCompanyId,companyName:pc.name,
     role:partnerOwner?"owner":ctx.role,teamId:partnerOwner?null:ctx.teamId};
  }
  const [cs,ms]=await Promise.all([
    read(db.collection("companies").doc(cid)),
    read(collection(cid,"members").doc(uid))
  ]);
  const c=cs.data()||{},m=ms.data()||{};
  // Existing internal memberships can predate the optional companyId field.
  // The document path and live Owner role still bind authorization; any
  // present conflicting companyId must remain an explicit denial.
  if(!cs.exists||!ms.exists||c.active!==true||m.active!==true||
     m.uid!==uid||(m.companyId!=null&&m.companyId!==cid)||
     m.companyRole!==u.companyRole)fail();
  if(c.companyKind==="partner"){
   if(!ID.test(c.hubCompanyId||"")||c.hubCompanyId===cid||
      u.accessKind!=="partner"||m.accessKind!=="partner"||
      u.memberType!=="cooperator"||m.memberType!=="cooperator"||
      u.canViewRevenue!==false||m.canViewRevenue!==false||
      u.canViewUnitPrice!==false||m.canViewUnitPrice!==false)fail();
   const owner=c.ownerUid===uid&&u.companyRole==="owner"&&m.companyRole==="owner";
   if(!owner&&!(u.companyRole==="member"&&
      ["leader","member"].includes(u.role)&&m.role===u.role&&
      ID.test(u.teamId||"")&&u.teamId===m.teamId))fail();
   const relation=await read(db.collection("partnerRelations").doc(cid));
   if(!relation.exists||relation.data()?.hubCompanyId!==c.hubCompanyId||
      relation.data()?.partnerCompanyId!==cid||relation.data()?.active!==true||
      relation.data()?.countSharingApproved!==true)fail();
   return {kind:"partner",uid,cid,hubId:c.hubCompanyId,companyName:c.name,
     role:owner?"owner":u.role,teamId:owner?null:u.teamId};
  }
  if(c.companyKind!=null&&!["internal","direct"].includes(c.companyKind))fail();
  // This opt-in is used ONLY by the count-ranking GET, never workspace
  // management, corrections, publication settings or finance readers.
  if(countReadOnly===true&&u.companyRole==="member"&&
     ["leader","member"].includes(u.role)&&m.role===u.role&&
     ID.test(u.teamId||"")&&m.teamId===u.teamId&&
     c.ownerUid!==uid&&
     (u.accessKind==null||u.accessKind==="internal")&&
     (m.accessKind==null||m.accessKind==="internal")&&
     (u.memberType==null||["internal","direct","member","managed"].includes(u.memberType))&&
     (m.memberType==null||["internal","direct","member","managed"].includes(m.memberType))){
   const team=await read(db.collection("teams").doc(u.teamId));
   if(!team.exists||team.data()?.companyId!==cid||team.data()?.active===false)fail();
   return {kind:"hub",uid,cid,role:u.role};
  }
  if(c.ownerUid!==uid||u.companyRole!=="owner"||m.companyRole!=="owner"||
     (u.accessKind!=null&&u.accessKind!=="internal")||
     (m.accessKind!=null&&m.accessKind!=="internal")||
     (u.memberType!=null&&!["internal","direct","member","managed"].includes(u.memberType))||
     (m.memberType!=null&&!["internal","direct","member","managed"].includes(m.memberType)))fail();
  return {kind:"hub",uid,cid,role:"owner"};
 }
 async function readCountViewer({token,workspaceCompanyId="",tx}={}){
  if(!tx||typeof tx.get!=="function"||typeof token!=="string"||
     !/^[A-Za-z0-9._-]{20,12000}$/.test(token)||
     (workspaceCompanyId!==""&&!ID.test(workspaceCompanyId)))fail("unauthenticated");
  const code=/^[A-Za-z0-9_-]{43}$/.test(token);
  const request={data:code?{codeSessionToken:token}:{workspaceCompanyId},
   rawRequest:{headers:{authorization:"Bearer "+token}}};
  if(!code){
   let claim;
   try{claim=await getAuth().verifyIdToken(token,true);}catch{fail("unauthenticated");}
   request.auth={uid:claim?.uid,token:claim};
  }else if(workspaceCompanyId)fail();
  const a=await actor(request,tx);
  const [userSnap,secondarySnap]=await Promise.all([
   tx.get(db.collection("users").doc(a.uid)),
   tx.get(db.collection("partnerWorkspaceContexts").doc(a.uid))
  ]);
  // A secondary partner never falls back to its old internal membership.
  // Selection is only a hint; scope() independently verifies every binding.
  if(secondarySnap.exists&&secondarySnap.data()?.active!==false&&
     !workspaceCompanyId)fail();
  if((userSnap.data()?.authKind==="partner_code_shared")!==!!a.codeAuth)fail();
  const s=await scope(a.uid,tx,workspaceCompanyId,true);
  if(a.codeAuth&&(s.kind!=="partner"||s.cid!==a.companyId))fail();
  return Object.freeze(s);
 }
 return Object.freeze({actor,scope,readCountViewer});
}
module.exports={makeWorkspaceIdentity};
