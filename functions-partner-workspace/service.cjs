"use strict";
// Isolated partner operations: no reads/writes to sales products, records or prices.
const crypto=require("node:crypto");
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME=/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const money=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const validCompanyName=x=>typeof x==="string"&&x.trim().length>0&&
 x.trim().length<=80&&!money.test(x);
const clean=x=>typeof x==="string"?x.trim():"";
function makeWorkspace({db,getAuth,FieldValue,Timestamp,HttpsError,enabled=()=>false,now=()=>Date.now()}={}){
 if(!db||!getAuth||!FieldValue||!Timestamp||!HttpsError)throw Error("missing_partner_workspace_dependency");
 const fail=(code="permission-denied")=>{throw new HttpsError(code,"権限・入力内容を確認できません。");};
 const validName=x=>typeof x==="string"&&NAME.test(x)&&!money.test(x);
 const validDate=x=>{
  if(typeof x!=="string"||!DATE.test(x))fail("invalid-argument");
  const t=Date.parse(x+"T00:00:00Z"),d=new Date(t);
  if(!Number.isFinite(t)||d.toISOString().slice(0,10)!==x)fail("invalid-argument");
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now());
  if(t>Date.parse(day+"T00:00:00Z")||t<Date.parse(day+"T00:00:00Z")-366*86400000)fail("invalid-argument");
  return x;
 };
 const validateCounts=x=>{
  if(!x||typeof x!=="object"||Array.isArray(x)||
    Object.keys(x).sort().join("|")!==[...KEYS].sort().join("|"))fail("invalid-argument");
  let total=0;const counts={};
  for(const key of KEYS){const n=x[key];if(!Number.isSafeInteger(n)||n<0||n>9999)fail("invalid-argument");counts[key]=n;total+=n;}
  return {counts,total};
 };
 const validPrivateName=x=>typeof x==="string"&&x.trim().length>0&&
 x.trim().length<=80&&!money.test(x);
 const validatePrivateCounts=x=>{
  if(!x||typeof x!=="object"||Array.isArray(x)||Object.keys(x).length>100)
    fail("invalid-argument");
  const result={};let sum=0;
  for(const [id,count] of Object.entries(x)){
   // Firestore document IDs are generated server-side. Never allow object
   // prototype keys to be treated as counts, even in an old saved record.
   if(!ID.test(id)||["__proto__","constructor","prototype"].includes(id)||
      !Number.isSafeInteger(count)||count<0||count>9999)
    fail("invalid-argument");
   result[id]=count;sum+=count;
  }
  return {counts:result,total:sum};
 };
 // Append-only history. Never change old sales, count documents or team snapshots.
 const appendTeamMove=(data,from,to,day)=>{
  if(data.teamHistory!==undefined&&!Array.isArray(data.teamHistory))fail("failed-precondition");
  const history=data.teamHistory||[];
  if(history.length>=100||history.some(e=>!e||
     typeof e.effectiveDate!=="string"||
     !/^\d{4}-\d{2}-\d{2}$/.test(e.effectiveDate)||
     e.effectiveDate>=day))
    fail("failed-precondition");
  return [...history.map(x=>({...x})),{effectiveDate:day,fromTeamId:from,toTeamId:to}];
 };
 const jstToday=()=>new Intl.DateTimeFormat("en-CA",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
 }).format(now());
 const collection=(cid,name)=>db.collection("companies").doc(cid).collection(name);
 const teamRef=(cid,id)=>collection(cid,"partnerWorkTeams").doc(id);
 const staffRef=(cid,id)=>collection(cid,"partnerWorkStaff").doc(id);
 const privateProductRef=(cid,id)=>collection(cid,"partnerPrivateProducts").doc(id);
 const entryRef=(cid,date,id)=>collection(cid,"partnerWorkEntries").doc(date+"__"+id);
 const summaryRef=(hub,date,partner)=>collection(hub,"partnerWorkCountDays").doc(date).collection("reports").doc(partner);
 async function actor(request){
  if(enabled()!==true)fail("unavailable");
  const uid=request?.auth?.uid,email=clean(request?.auth?.token?.email).toLowerCase();
  if(!ID.test(uid||""))fail("unauthenticated");
  const bearer=request?.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!bearer)fail("unauthenticated");
  let a,t;
  try{[a,t]=await Promise.all([getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)]);}
  catch{fail("unauthenticated");}
  if(!a||a.disabled===true||t?.uid!==uid)fail("unauthenticated");
  // Company code identities are allowed ONLY with server-minted custom claims.
  // They never qualify for direct Firestore finance access (no verified email).
  if(request.auth?.token?.partnerCodeAuth===true){
   const companyId=request.auth?.token?.partnerCodeCompanyId;
   const version=request.auth?.token?.partnerCodeVersion;
   if(!ID.test(companyId||"")||!Number.isSafeInteger(version)||version<1||
     t.partnerCodeAuth!==true||t.partnerCodeCompanyId!==companyId||
     t.partnerCodeVersion!==version||a.emailVerified===true)fail("unauthenticated");
   return {uid,email:"",companyId,codeAuth:true};
  }
  if(!EMAIL.test(email)||request.auth?.token?.email_verified!==true||
     a.emailVerified!==true||clean(a.email).toLowerCase()!==email||
     t.email_verified!==true||clean(t.email).toLowerCase()!==email)fail("unauthenticated");
  return {uid,email};
 }
 async function scope(uid,tx=null,workspaceCompanyId=""){
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
  if(!cs.exists||!ms.exists||c.active!==true||m.active!==true||
     m.uid!==uid||m.companyId!==cid||m.companyRole!==u.companyRole)fail();
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
  if(c.ownerUid!==uid||u.companyRole!=="owner"||m.companyRole!=="owner"||
     (u.accessKind!=null&&u.accessKind!=="internal")||
     (m.accessKind!=null&&m.accessKind!=="internal")||
     (u.memberType!=null&&!["internal","direct","member","managed"].includes(u.memberType))||
     (m.memberType!=null&&!["internal","direct","member","managed"].includes(m.memberType)))fail();
  return {kind:"hub",uid,cid,role:"owner"};
 }
 const checkTeam=async(tx,s,id)=>{
  if(!ID.test(id||""))fail("invalid-argument");
  const sn=await tx.get(teamRef(s.cid,id));
  if(!sn.exists||sn.data()?.active!==true)fail("failed-precondition");
  return sn.data();
 };
 // Hub actions only touch registered partner company, team and invitation data.
 // Never access raw sales products, records, revenue or partner private products.
 async function hubPartner(tx,hubId,partnerId){
  if(!ID.test(partnerId||""))fail("invalid-argument");
  const [rs,cs]=await Promise.all([
   tx.get(db.collection("partnerRelations").doc(partnerId)),
   tx.get(db.collection("companies").doc(partnerId))
  ]);
  const rel=rs.data()||{},c=cs.data()||{};
  if(!rs.exists||!cs.exists||rel.partnerCompanyId!==partnerId||
    rel.hubCompanyId!==hubId||c.hubCompanyId!==hubId||
    c.companyKind!=="partner"||c.active!==true||
    !validCompanyName(c.name))fail("failed-precondition");
  return {active:rel.active===true&&rel.countSharingApproved===true};
 }
 const canStaff=(s,staff)=>{
  return s.role==="owner"||
    (s.role==="leader"&&staff.teamId===s.teamId)||
    (s.role==="member"&&staff.uid===s.uid&&staff.kind==="account");
 };
 async function manage(request){
  const {uid}=await actor(request),d=request?.data||{},op=d.action;
  if(!["addTeam","addManaged","createInvite","moveStaff","addPrivateProduct","setPrivateProduct",
   "hubAddTeam","hubCreateInvite"].includes(op))fail("invalid-argument");
  const s=await scope(uid,null,d.workspaceCompanyId);
  if(op==="hubAddTeam"||op==="hubCreateInvite"){
   if(s.kind!=="hub"||s.role!=="owner"||!ID.test(d.partnerCompanyId||""))fail();
   if(op==="hubAddTeam"){
    if(!validName(d.name))fail("invalid-argument");
    const ref=collection(d.partnerCompanyId,"partnerWorkTeams").doc();
    await db.runTransaction(async tx=>{
     const fresh=await scope(uid,tx,d.workspaceCompanyId);
     if(fresh.kind!=="hub"||fresh.cid!==s.cid||fresh.role!=="owner")fail();
     const partner=await hubPartner(tx,s.cid,d.partnerCompanyId);
     if(!partner.active)fail("failed-precondition");
     tx.create(ref,{name:clean(d.name),active:true,companyId:d.partnerCompanyId,
      createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
    });
    return {teamId:ref.id,created:true};
   }
   if(!EMAIL.test(clean(d.email).toLowerCase())||
      !["leader","member"].includes(d.role)||!ID.test(d.teamId||""))
    fail("invalid-argument");
   const token=crypto.randomBytes(32).toString("base64url");
   const hash=crypto.createHash("sha256").update(token).digest("hex");
   const expiresAt=Timestamp.fromMillis(now()+30*60000);
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.kind!=="hub"||fresh.cid!==s.cid||fresh.role!=="owner")fail();
    const partner=await hubPartner(tx,s.cid,d.partnerCompanyId);
    if(!partner.active)fail("failed-precondition");
    await checkTeam(tx,{cid:d.partnerCompanyId},d.teamId);
    tx.create(db.collection("partnerWorkInvites").doc(hash),{
     companyId:d.partnerCompanyId,hubCompanyId:s.cid,teamId:d.teamId,
     role:d.role,emailLower:clean(d.email).toLowerCase(),invitedByUid:uid,
     status:"pending",createdAt:FieldValue.serverTimestamp(),expiresAt
    });
   });
   return {token,expiresAt:expiresAt.toMillis()};
  }
  if(s.kind!=="partner"||s.role==="member")fail();
  if(op==="addPrivateProduct"){
   if(s.kind!=="partner"||s.role!=="owner"||!validPrivateName(d.name))
     fail("invalid-argument");
   const existing=await collection(s.cid,"partnerPrivateProducts").limit(101).get();
   if(existing.size>=100)fail("resource-exhausted");
   const ref=collection(s.cid,"partnerPrivateProducts").doc();
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.kind!=="partner"||fresh.cid!==s.cid||fresh.role!=="owner")fail();
    tx.create(ref,{companyId:s.cid,name:clean(d.name),active:true,
      origin:"partner_custom",visibility:"private",createdByUid:uid,
      createdAt:FieldValue.serverTimestamp()});
   });
   return {productId:ref.id,created:true};
  }
  if(op==="setPrivateProduct"){
   if(s.kind!=="partner"||s.role!=="owner"||!ID.test(d.productId||"")||
      typeof d.active!=="boolean"||!validPrivateName(d.name))fail("invalid-argument");
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.kind!=="partner"||fresh.cid!==s.cid||fresh.role!=="owner")fail();
    const ref=privateProductRef(s.cid,d.productId),sn=await tx.get(ref);
    if(!sn.exists||sn.data()?.companyId!==s.cid||
       sn.data()?.origin!=="partner_custom"||sn.data()?.visibility!=="private")
      fail("failed-precondition");
    tx.update(ref,{name:clean(d.name),active:d.active,
      updatedByUid:uid,updatedAt:FieldValue.serverTimestamp()});
   });
   // Never delete a retired product or its original count history.
   return {productId:d.productId,updated:true};
  }
  if(op==="addTeam"){
   if(s.role!=="owner"||!validName(d.name))fail("invalid-argument");
   const ref=collection(s.cid,"partnerWorkTeams").doc();
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.cid!==s.cid||fresh.role!=="owner")fail();
    tx.create(ref,{name:clean(d.name),active:true,companyId:s.cid,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
   });
   return {teamId:ref.id,created:true};
  }
  if(op==="addManaged"){
   if(!validName(d.name))fail("invalid-argument");
   const ref=collection(s.cid,"partnerWorkStaff").doc();
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.cid!==s.cid||fresh.role==="member")fail();
    const teamId=s.role==="owner"?clean(d.teamId):fresh.teamId;
    await checkTeam(tx,fresh,teamId);
    tx.create(ref,{name:clean(d.name),kind:"managed",role:"member",uid:null,
      teamId,companyId:s.cid,active:true,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
   });
   return {staffId:ref.id,created:true};
  }
  if(op==="moveStaff"){
   if(s.role!=="owner"||!ID.test(d.staffId||"")||!ID.test(d.teamId||""))fail("invalid-argument");
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);if(fresh.role!=="owner")fail();
    await checkTeam(tx,fresh,d.teamId);
    const ref=staffRef(fresh.cid,d.staffId),sn=await tx.get(ref);
    if(!sn.exists||sn.data()?.active!==true||sn.data()?.companyId!==s.cid||
       !ID.test(sn.data()?.teamId||""))fail();
    const current=sn.data();
    if(current.teamId===d.teamId)return; // idempotent, no duplicate history
    const day=jstToday();
    if(current.kind==="account"){
     if(!ID.test(current.uid||"")||current.uid!==d.staffId)fail();
     const ur=db.collection("users").doc(current.uid),mr=collection(s.cid,"members").doc(current.uid);
     const ctxRef=db.collection("partnerWorkspaceContexts").doc(current.uid);
     // All source, partner and context reads happen in this transaction.
     const [us,ms,contextSnap]=await Promise.all([
       tx.get(ur),tx.get(mr),tx.get(ctxRef)
     ]);
     const u=us.data()||{},m=ms.data()||{},ctx=contextSnap.data()||{};
     const secondary=contextSnap.exists;
     if(!us.exists||!ms.exists||u.uid!==current.uid||m.uid!==current.uid||
        u.active!==true||m.active!==true||
        m.companyId!==s.cid||m.companyRole!=="member"||
        m.teamId!==current.teamId||m.accessKind!=="partner"||
        m.memberType!=="cooperator"||
        m.canViewRevenue!==false||m.canViewUnitPrice!==false)fail();
     if(secondary){
       if(ctx.kind!=="partner_secondary"||ctx.active!==true||
          ctx.uid!==current.uid||ctx.partnerCompanyId!==s.cid||
          ctx.hubCompanyId!==s.hubId||
          ctx.primaryCompanyId!==u.companyId||
          !["leader","member"].includes(ctx.role)||ctx.role!==m.role||
          ctx.teamId!==current.teamId||
          (u.accessKind!=null&&u.accessKind!=="internal")||
          (u.memberType!=null&&!["internal","direct","member","managed"].includes(u.memberType)))
         fail();
       const originalCompanyRef=db.collection("companies").doc(u.companyId);
       const originalMemberRef=collection(u.companyId,"members").doc(current.uid);
       const [originalCompanySnap,originalMemberSnap]=await Promise.all([
         tx.get(originalCompanyRef),tx.get(originalMemberRef)
       ]);
       const pc=originalCompanySnap.data()||{},pm=originalMemberSnap.data()||{};
       if(!originalCompanySnap.exists||pc.active===false||
          (pc.companyKind!=null&&!["internal","direct"].includes(pc.companyKind))||
          !originalMemberSnap.exists||pm.active===false||
          (pm.uid!=null&&pm.uid!==current.uid)||
          (pm.companyId!=null&&pm.companyId!==u.companyId)||
          (pm.accessKind!=null&&pm.accessKind!=="internal"))
         fail();
       const contextHistory=appendTeamMove(ctx,current.teamId,d.teamId,day);
       const memberHistory=appendTeamMove(m,current.teamId,d.teamId,day);
       tx.update(ctxRef,{teamId:d.teamId,teamHistory:contextHistory});
       tx.update(mr,{teamId:d.teamId,teamHistory:memberHistory});
     }else{
       if(u.companyId!==s.cid||u.companyRole!=="member"||
          u.teamId!==current.teamId||u.accessKind!=="partner"||
          u.memberType!=="cooperator"||
          u.canViewRevenue!==false||u.canViewUnitPrice!==false)fail();
       const userHistory=appendTeamMove(u,current.teamId,d.teamId,day);
       const memberHistory=appendTeamMove(m,current.teamId,d.teamId,day);
       tx.update(ur,{teamId:d.teamId,teamHistory:userHistory});
       tx.update(mr,{teamId:d.teamId,teamHistory:memberHistory});
     }
    }else if(current.kind!=="managed")fail();
    const staffHistory=appendTeamMove(current,current.teamId,d.teamId,day);
    tx.update(ref,{teamId:d.teamId,teamHistory:staffHistory,
      updatedAt:FieldValue.serverTimestamp()});
   });
   return {moved:true};
  }
  if(!EMAIL.test(clean(d.email).toLowerCase())||
     !["leader","member"].includes(d.role)||!ID.test(d.teamId||"")||
     (s.role!=="owner"&&(d.role!=="member"||d.teamId!==s.teamId)))fail("invalid-argument");
  const token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt=Timestamp.fromMillis(now()+30*60000);
  await db.runTransaction(async tx=>{
   const fresh=await scope(uid,tx,d.workspaceCompanyId);
   if(fresh.kind!=="partner"||(fresh.role!=="owner"&&(fresh.role!=="leader"&&d.role==="member"&&fresh.teamId===d.teamId)))fail();
   await checkTeam(tx,fresh,d.teamId);
   tx.create(db.collection("partnerWorkInvites").doc(hash),{
     companyId:s.cid,hubCompanyId:s.hubId,teamId:d.teamId,role:d.role,
     emailLower:clean(d.email).toLowerCase(),invitedByUid:uid,
     status:"pending",createdAt:FieldValue.serverTimestamp(),expiresAt
   });
  });
  return {token,expiresAt:expiresAt.toMillis()};
 }
 async function accept(request){
  const a=await actor(request),d=request?.data||{},token=clean(d.token);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail("invalid-argument");
  // Migration must be chosen explicitly by the invited, authenticated user.
  // Normal existing-email invitations continue using non-destructive secondary roles.
  const transfer=d.transferCurrentCompany===true;
  if(d.transferCurrentCompany!==undefined&&typeof d.transferCurrentCompany!=="boolean")
   fail("invalid-argument");
  const hash=crypto.createHash("sha256").update(token).digest("hex"),ref=db.collection("partnerWorkInvites").doc(hash);
  const joined=await db.runTransaction(async tx=>{
   const inviteSnap=await tx.get(ref),i=inviteSnap.data()||{};
   if(!inviteSnap.exists||i.status!=="pending"||i.emailLower!==a.email||
      !ID.test(i.companyId||"")||!ID.test(i.teamId||"")||
      !["leader","member"].includes(i.role)||i.expiresAt?.toMillis?.()<=now()||
      !i.expiresAt?.toMillis)fail("failed-precondition");
   const cr=db.collection("companies").doc(i.companyId),ur=db.collection("users").doc(a.uid),
    mr=collection(i.companyId,"members").doc(a.uid),sr=staffRef(i.companyId,a.uid);
   const relationRef=db.collection("partnerRelations").doc(i.companyId);
   const ctxRef=db.collection("partnerWorkspaceContexts").doc(a.uid);
   const [cs,us,ms,ss,rs,ctxSnap]=await Promise.all([
     tx.get(cr),tx.get(ur),tx.get(mr),tx.get(sr),tx.get(relationRef),tx.get(ctxRef)
   ]);
   if(!cs.exists||cs.data()?.companyKind!=="partner"||cs.data()?.active!==true||
      cs.data()?.hubCompanyId!==i.hubCompanyId||
      !rs.exists||rs.data()?.partnerCompanyId!==i.companyId||
      rs.data()?.hubCompanyId!==i.hubCompanyId||
      rs.data()?.active!==true||rs.data()?.countSharingApproved!==true||
      ms.exists||ss.exists||ctxSnap.exists||
      us.data()?.active===false)fail("failed-precondition");
   const original=us.data()||{},primaryCid=clean(original.companyId);
   let formerMemberRef=null,formerMember=null;
   if(primaryCid){
     if(!ID.test(primaryCid)||primaryCid===i.companyId||
        original.uid!==a.uid||clean(original.email).toLowerCase()!==a.email||
        (original.accessKind!=null&&original.accessKind!=="internal")||
        (original.memberType!=null&&!["internal","direct","member","managed"].includes(original.memberType)))
       fail("failed-precondition");
     formerMemberRef=collection(primaryCid,"members").doc(a.uid);
     const [pcSnap,pmSnap]=await Promise.all([
       tx.get(db.collection("companies").doc(primaryCid)),
       tx.get(formerMemberRef)
     ]);
     const pc=pcSnap.data()||{},pm=pmSnap.data()||{};
     if(!pcSnap.exists||!pmSnap.exists||pc.active===false||
        (pc.companyKind!=null&&!["internal","direct"].includes(pc.companyKind))||
        pm.active===false||
        (pm.uid!=null&&pm.uid!==a.uid)||
        (pm.companyId!=null&&pm.companyId!==primaryCid)||
        (pm.accessKind!=null&&pm.accessKind!=="internal")||
        ["partner","cooperator"].includes(pm.memberType))
       fail("failed-precondition");
     formerMember=pm;
     if(transfer){
      // Never orphan a company owner, change another hub's roster or silently
      // re-parent original records. Original records and old member doc stay put.
      if(primaryCid!==i.hubCompanyId||pc.ownerUid===a.uid||
        pc.masterUid===a.uid||original.companyRole==="owner"||
        pm.companyRole==="owner"||
        // Older invited internal members may predate companyRole being stored.
        // An absent companyRole is only accepted for a non-owner/non-master,
        // otherwise transfer would incorrectly reject existing registered mail.
        (original.companyRole!=null&&original.companyRole!=="member")||
        (pm.companyRole!=null&&pm.companyRole!=="member")||
        (original.role!=null&&!["leader","member"].includes(original.role))||
        (pm.role!=null&&!["leader","member"].includes(pm.role)))
       fail("failed-precondition");
     }
   }
   const transferring=transfer&&Boolean(primaryCid);
   const archivedRef=db.collection("partnerHistoricalTransfers").doc(a.uid);
   if(transferring){
    const archive=await tx.get(archivedRef);
    if(archive.exists)fail("failed-precondition");
   }
   await checkTeam(tx,{cid:i.companyId},i.teamId);
   const name=clean(d.name);
   if(!validName(name))fail("invalid-argument");
   const profile={uid:a.uid,companyId:i.companyId,name,email:a.email,
     role:i.role,companyRole:"member",teamId:i.teamId,active:true,
     accessKind:"partner",memberType:"cooperator",
     canViewRevenue:false,canViewUnitPrice:false,canCreateInvite:false,
     updatedAt:FieldValue.serverTimestamp()};
   if(primaryCid&&!transferring){
     tx.create(ctxRef,{uid:a.uid,primaryCompanyId:primaryCid,
       partnerCompanyId:i.companyId,hubCompanyId:i.hubCompanyId,
       emailLower:a.email,role:i.role,teamId:i.teamId,
       kind:"partner_secondary",active:true,createdAt:FieldValue.serverTimestamp()});
   }else if(transferring){
     // Server-owned historical archive is not browser-readable. Preserve the
     // original profile byte-for-byte as data, plus the entire old membership.
     // Existing sales records, prices, snapshots and teamHistory never move.
     tx.create(archivedRef,{uid:a.uid,sourceCompanyId:primaryCid,
       destinationCompanyId:i.companyId,hubCompanyId:i.hubCompanyId,
       originalUser:original,originalMember:formerMember,
       createdAt:FieldValue.serverTimestamp()});
     tx.update(formerMemberRef,{active:false,updatedAt:FieldValue.serverTimestamp()});
     // Update ONLY this authenticated person's current profile. Each former
     // property not part of the new count-only profile is cleared field-by-
     // field AFTER its exact value has been snapshotted in the same transaction.
     // Historical sales, former company memberships and team snapshots remain.
     const cleanup={};
     for(const key of Object.keys(original)){
      if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))fail("failed-precondition");
      if(!Object.hasOwn(profile,key))cleanup[key]=FieldValue.delete();
     }
     tx.update(ur,{...cleanup,...profile});
   }else if(us.exists)tx.update(ur,profile);else tx.create(ur,profile);
   tx.create(mr,{...profile,joinedAt:FieldValue.serverTimestamp()});
   tx.create(sr,{uid:a.uid,name,kind:"account",role:i.role,teamId:i.teamId,
     companyId:i.companyId,active:true,createdAt:FieldValue.serverTimestamp()});
   tx.update(ref,{status:"accepted",acceptedByUid:a.uid,acceptedAt:FieldValue.serverTimestamp()});
   return {secondaryMembership:Boolean(primaryCid&&!transferring),
     transferredFromInternal:transferring,partnerCompanyId:i.companyId};
  });
  return {joined:true,...joined};
 }
 async function view(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date);
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind==="hub"){
   // Registered companies appear before their first daily count report.
   // Unapproved company remains listed but cannot be invited into.
   const relations=await db.collection("partnerRelations").where("hubCompanyId","==",s.cid).limit(101).get();
   if(relations.size>100)fail("resource-exhausted");
   const registeredCompanies=[];
   for(const sn of relations.docs){
    const rel=sn.data()||{};
    if(!ID.test(sn.id)||rel.partnerCompanyId!==sn.id||rel.hubCompanyId!==s.cid)
     fail("data-loss");
    const cs=await db.collection("companies").doc(sn.id).get(),c=cs.data()||{};
    if(!cs.exists||c.hubCompanyId!==s.cid||c.companyKind!=="partner"||
       !validCompanyName(c.name))fail("data-loss");
    const active=rel.active===true&&rel.countSharingApproved===true&&c.active===true;
    const teams=[];
    if(active){
     const teamSnaps=await collection(sn.id,"partnerWorkTeams").limit(151).get();
     if(teamSnaps.size>150)fail("resource-exhausted");
     for(const team of teamSnaps.docs){
      const item=team.data()||{};
      if(!ID.test(team.id)||item.companyId!==sn.id||!validName(item.name)||
         typeof item.active!=="boolean")fail("data-loss");
      if(item.active)teams.push({id:team.id,name:clean(item.name)});
     }
     teams.sort((a,b)=>a.name.localeCompare(b.name,"ja"));
    }
    registeredCompanies.push({partnerCompanyId:sn.id,name:clean(c.name),active,teams});
   }
   registeredCompanies.sort((a,b)=>a.name.localeCompare(b.name,"ja"));
   // Explicitly scoped, on-demand shared-count breakdown. Never read
   // financial originals, private products, or reveal staff identities.
   let partnerTeamDetails=null;
   const selectedPartnerId=clean(d.partnerCompanyId);
   if(selectedPartnerId){
    if(!ID.test(selectedPartnerId))fail("invalid-argument");
    const chosen=registeredCompanies.find(x=>x.partnerCompanyId===selectedPartnerId);
    if(!chosen||chosen.active!==true)fail();
    const [teamSnaps,entrySnaps]=await Promise.all([
     collection(selectedPartnerId,"partnerWorkTeams").limit(151).get(),
     collection(selectedPartnerId,"partnerWorkEntries").where("date","==",date).limit(201).get()
    ]);
    if(teamSnaps.size>150||entrySnaps.size>200)fail("resource-exhausted");
    const rows=new Map();
    for(const sn of teamSnaps.docs){
     const t=sn.data()||{};
     if(!ID.test(sn.id)||t.companyId!==selectedPartnerId||
        !validName(t.name)||typeof t.active!=="boolean")fail("data-loss");
     if(t.active)rows.set(sn.id,{
      teamId:sn.id,name:clean(t.name),
      counts:Object.fromEntries(KEYS.map(k=>[k,0])),
      totalCount:0,reportedStaffCount:0
     });
    }
    let unverifiedTeamCount=0,verifiedSharedCount=0;
    for(const sn of entrySnaps.docs){
     const e=sn.data()||{};
     if(e.companyId!==selectedPartnerId||e.hubCompanyId!==s.cid||
        e.date!==date||!ID.test(e.staffId||"")||
        !Number.isSafeInteger(e.version)||e.version<1)fail("data-loss");
     const item=validateCounts(e.counts);
     if(item.total!==e.totalCount)fail("data-loss");
     const row=rows.get(e.teamIdSnapshot||"");
     if(!row){
      // Never fabricate an old team based on someone's current membership.
      unverifiedTeamCount+=item.total;
      continue;
     }
     row.reportedStaffCount++;
     row.totalCount+=item.total;
     verifiedSharedCount+=item.total;
     for(const k of KEYS)row.counts[k]+=item.counts[k];
    }
    partnerTeamDetails={
     partnerCompanyId:selectedPartnerId,companyName:chosen.name,date,
     teams:[...rows.values()].sort((a,b)=>a.name.localeCompare(b.name,"ja")),
     verifiedSharedCount,unverifiedTeamCount,scope:"shared_counts_only"
    };
   }
   const qs=await collection(s.cid,"partnerWorkCountDays").doc(date)
    .collection("reports").limit(201).get();
   if(qs.size>200)fail("resource-exhausted");
   const partners=[];
   for(const sn of qs.docs){
    const x=sn.data()||{};
    if(x.hubCompanyId!==s.cid||x.partnerCompanyId!==sn.id||
       !ID.test(sn.id)||!validCompanyName(x.partnerName)||!Number.isSafeInteger(x.totalCount)||
       x.totalCount<0)fail("data-loss");
    const {counts,total}=validateCounts(x.counts);
    if(total!==x.totalCount)fail("data-loss");
    // A partner may revoke count-sharing after this daily report was saved.
    // Never disclose that saved data without current server-owned approval.
    const relSnap=await db.collection("partnerRelations").doc(sn.id).get();
    const rel=relSnap.data()||{};
    if(!relSnap.exists||rel.hubCompanyId!==s.cid||
       rel.partnerCompanyId!==sn.id||rel.active!==true||
       rel.countSharingApproved!==true)continue;
    partners.push({partnerCompanyId:sn.id,name:x.partnerName,totalCount:total,counts});
   }
   partners.sort((x,y)=>x.name.localeCompare(y.name,"ja"));
   if(partnerTeamDetails){
    const report=partners.find(x=>x.partnerCompanyId===partnerTeamDetails.partnerCompanyId);
    partnerTeamDetails.unreconciledWithCompanyReport=Boolean(report&&
     report.totalCount!==partnerTeamDetails.verifiedSharedCount+
       partnerTeamDetails.unverifiedTeamCount);
   }
   // Extra Firestore reads are opt-in. Default report/dashboard calls retain
   // their existing cost. Only approved hub Owner can invoke this branch.
   let teamReports;
   if(d.includeTeamStatus===true){
    const selectedCompany=clean(d.partnerCompanyId);
    if(selectedCompany&&!ID.test(selectedCompany))fail("invalid-argument");
    const targets=registeredCompanies.filter(x=>x.active&&
      (!selectedCompany||x.partnerCompanyId===selectedCompany));
    if(selectedCompany&&targets.length!==1)fail();
    if(targets.length>20)fail("resource-exhausted");
    teamReports=[];
    for(const company of targets){
     const cid=company.partnerCompanyId;
     const [staffSnap,entriesSnap]=await Promise.all([
      collection(cid,"partnerWorkStaff").limit(151).get(),
      collection(cid,"partnerWorkEntries").where("date","==",date).limit(201).get()
     ]);
     if(staffSnap.size>150||entriesSnap.size>200)fail("resource-exhausted");
     const status=new Map(company.teams.map(t=>[t.id,{
      id:t.id,name:t.name,staffCount:0,reportedStaffCount:0,
      totalCount:0,counts:Object.fromEntries(KEYS.map(k=>[k,0]))
     }]));
     for(const doc of staffSnap.docs){
      const person=doc.data()||{};
      if(!ID.test(doc.id)||person.companyId!==cid)fail("data-loss");
      if(person.active===true&&status.has(person.teamId))
       status.get(person.teamId).staffCount++;
     }
     const seenStaff=new Set();
     let unattributedEntries=0,reportedTotal=0;
     for(const doc of entriesSnap.docs){
      const row=doc.data()||{};
      if(!ID.test(doc.id)||!ID.test(row.staffId||"")||
         row.companyId!==cid||row.date!==date||
         seenStaff.has(row.staffId))fail("data-loss");
      seenStaff.add(row.staffId);
      const normalized=validateCounts(row.counts);
      if(row.totalCount!==normalized.total)fail("data-loss");
      reportedTotal+=normalized.total;
      const team=status.get(row.teamIdSnapshot);
      if(!team){unattributedEntries++;continue;}
      // A saved zero-count row counts as submitted, not missing.
      team.reportedStaffCount++;
      team.totalCount+=normalized.total;
      for(const key of KEYS)team.counts[key]+=normalized.counts[key];
     }
     const aggregate=partners.find(p=>p.partnerCompanyId===cid);
     const consistent=unattributedEntries===0 &&
      (aggregate?aggregate.totalCount===reportedTotal:seenStaff.size===0);
     const teams=[...status.values()].map(team=>({
      ...team,status:team.reportedStaffCount>0?"submitted":
       !consistent?"unverified":
       team.staffCount>0?"missing":"not_expected"
     }));
     teamReports.push({partnerCompanyId:cid,name:company.name,
      date,verified:consistent,unattributedEntries,teams});
    }
   }
   return {role:"hub",date,partners,registeredCompanies,categories:KEYS,
    ...(partnerTeamDetails?{partnerTeamDetails}:{}),
    ...(teamReports?{teamReports,teamStatusComplete:true}:{})};
  }
  // Company-wide partner breakdown is reserved for a verified internal hub
  // Owner; do not silently ignore forged hub options in a partner session.
  if(d.includeTeamStatus===true||d.partnerCompanyId!=null)fail();
  const [teams,staff,entries,privateProducts]=await Promise.all([
    collection(s.cid,"partnerWorkTeams").limit(151).get(),
    collection(s.cid,"partnerWorkStaff").limit(151).get(),
    collection(s.cid,"partnerWorkEntries").where("date","==",date).limit(201).get(),
    collection(s.cid,"partnerPrivateProducts").limit(101).get()
  ]);
  if(teams.size>150||staff.size>150||entries.size>200||privateProducts.size>100)fail("resource-exhausted");
  const productList=privateProducts.docs.map(sn=>{
   const x=sn.data()||{};
   if(!ID.test(sn.id)||x.companyId!==s.cid||x.origin!=="partner_custom"||
      x.visibility!=="private"||!validPrivateName(x.name)||typeof x.active!=="boolean")
     fail("data-loss");
   return {id:sn.id,name:clean(x.name),active:x.active};
  });
  const privateIdSet=new Set(productList.map(x=>x.id));
  const allowed=new Map();
  for(const sn of staff.docs){
   const x=sn.data()||{};
   if(x.companyId!==s.cid||!ID.test(sn.id))fail("data-loss");
   if(!canStaff(s,x))continue;
   allowed.set(sn.id,{id:sn.id,name:clean(x.name),teamId:x.teamId,
     kind:x.kind,role:x.role,uid:x.uid||null,active:x.active===true});
  }
  const rows=[];
  for(const sn of entries.docs){
   const x=sn.data()||{};
   if(x.companyId!==s.cid||x.date!==date||!ID.test(x.staffId||""))fail("data-loss");
   if(!allowed.has(x.staffId))continue;
   const {counts,total}=validateCounts(x.counts);
   if(total!==x.totalCount)fail("data-loss");
   // Return only saved, immutable attribution metadata from the original entry.
   // Never infer a historical team from the member's current teamId.
   // Old entries without a snapshot stay unverified in the dashboard.
   const teamIdSnapshot=ID.test(x.teamIdSnapshot||"")?x.teamIdSnapshot:null;
   const privateCounts=validatePrivateCounts(x.privateCounts||{});
   if(Object.keys(privateCounts.counts).some(id=>!privateIdSet.has(id))||
      (x.privateTotalCount??0)!==privateCounts.total)fail("data-loss");
   rows.push({staffId:x.staffId,counts,totalCount:total,version:x.version,
     teamIdSnapshot,privateCounts:privateCounts.counts,privateTotalCount:privateCounts.total});
  }
  const visibleTeams=teams.docs.map(sn=>({id:sn.id,name:clean(sn.data().name),active:sn.data().active===true}))
   .filter(team=>s.role==="owner"||team.id===s.teamId);
  return {role:s.role,date,companyName:clean(s.companyName),teamId:s.teamId,
    teams:visibleTeams,staff:[...allowed.values()],records:rows,categories:KEYS,
    privateProducts:productList};
 }
 async function submit(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date),staffId=clean(d.staffId);
  if(!ID.test(staffId)||!Number.isSafeInteger(d.expectedVersion)||d.expectedVersion<0)fail("invalid-argument");
  const {counts,total}=validateCounts(d.counts);
  const hasPrivateCounts=Object.prototype.hasOwnProperty.call(d,"privateCounts");
  const requestedPrivate=hasPrivateCounts?validatePrivateCounts(d.privateCounts).counts:null;
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner")fail();
  return db.runTransaction(async tx=>{
   const fresh=await scope(a.uid,tx,d.workspaceCompanyId);
   if(fresh.kind!=="partner"||fresh.cid!==s.cid)fail();
   const sr=staffRef(s.cid,staffId),ss=await tx.get(sr),person=ss.data()||{};
   if(!ss.exists||person.active!==true||person.companyId!==s.cid||
      !validName(person.name)||!canStaff(fresh,person))fail();
   const er=entryRef(s.cid,date,staffId),summary=summaryRef(s.hubId,date,s.cid);
   const privateProductIds=Object.keys(requestedPrivate||{});
   // All reads happen before writes. Do not infer product ownership from IDs.
   const [oldSnap,totalSnap,...productSnapshots]=await Promise.all([
    tx.get(er),tx.get(summary),
    ...privateProductIds.map(id=>tx.get(privateProductRef(s.cid,id)))
   ]);
   for(let i=0;i<privateProductIds.length;i++){
    const doc=productSnapshots[i],x=doc?.data()||{};
    if(!doc?.exists||x.companyId!==s.cid||x.origin!=="partner_custom"||
       x.visibility!=="private"||(x.active!==true&&requestedPrivate[privateProductIds[i]]>0))
      fail("failed-precondition");
   }
   const old=oldSnap.data()||{},existing=totalSnap.data()||{};
   if(oldSnap.exists&&old.version!==d.expectedVersion||!oldSnap.exists&&d.expectedVersion!==0)
     fail("aborted");
   if(d.expectedVersion>=999)fail("resource-exhausted");
   // Never mix per-person entries with the earlier one-total-per-partner UI.
   if(totalSnap.exists&&existing.source!=="staff-entries-v1")fail("failed-precondition");
   const previousPrivate=oldSnap.exists?validatePrivateCounts(old.privateCounts||{}).counts:{};
   const privateNext={...previousPrivate,...(requestedPrivate||{})};
   const privateValidated=validatePrivateCounts(privateNext);
   const prior=oldSnap.exists?validateCounts(old.counts).counts:
     Object.fromEntries(KEYS.map(key=>[key,0]));
   const previous=totalSnap.exists?validateCounts(existing.counts).counts:
     Object.fromEntries(KEYS.map(key=>[key,0]));
   const aggregate={};let aggregateTotal=0;
   for(const key of KEYS){
    const n=previous[key]+counts[key]-prior[key];
    if(!Number.isSafeInteger(n)||n<0)fail("data-loss");
    aggregate[key]=n;aggregateTotal+=n;
   }
   if(totalSnap.exists&&existing.totalCount!==Object.values(previous).reduce((x,y)=>x+y,0))
     fail("data-loss");
   // An edit cannot reassign a previously saved day to the current team.
   // Missing historical attribution remains unverified rather than inferred.
   const teamIdSnapshot=oldSnap.exists?
     (Object.prototype.hasOwnProperty.call(old,"teamIdSnapshot")?old.teamIdSnapshot:null):
     person.teamId;
   const staffNameSnapshot=oldSnap.exists?
     (Object.prototype.hasOwnProperty.call(old,"staffNameSnapshot")?old.staffNameSnapshot:null):
     person.name;
   if(teamIdSnapshot!==null&&!ID.test(teamIdSnapshot))fail("data-loss");
   if(staffNameSnapshot!==null&&!validName(staffNameSnapshot))fail("data-loss");
   const nowStamp=FieldValue.serverTimestamp(),nextVersion=d.expectedVersion+1;
   const row={companyId:s.cid,hubCompanyId:s.hubId,staffId,date,counts,totalCount:total,
     privateCounts:privateValidated.counts,privateTotalCount:privateValidated.total,
     version:nextVersion,staffNameSnapshot,teamIdSnapshot,
     updatedByUid:a.uid,updatedAt:nowStamp};
   if(oldSnap.exists)tx.update(er,row);else tx.create(er,{...row,createdAt:nowStamp});
   const sum={source:"staff-entries-v1",hubCompanyId:s.hubId,partnerCompanyId:s.cid,
     partnerName:clean(s.companyName),date,counts:aggregate,totalCount:aggregateTotal,
     updatedAt:nowStamp};
   if(!validCompanyName(sum.partnerName))fail();
   if(totalSnap.exists)tx.update(summary,sum);else tx.create(summary,{...sum,createdAt:nowStamp});
   const audit=collection(s.cid,"partnerWorkAudits").doc(date+"__"+staffId+"__v"+nextVersion);
   tx.create(audit,{...row,previousCounts:prior,previousPrivateCounts:previousPrivate,
     createdAt:nowStamp});
   return {saved:true,staffId,date,version:nextVersion,totalCount:total,
     privateTotalCount:privateValidated.total};
  });
 }
 return Object.freeze({manage,accept,view,submit});
}
module.exports={makeWorkspace,KEYS};
