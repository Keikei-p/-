"use strict";
// Isolated partner operations: no reads/writes to sales products, records or prices.
const crypto=require("node:crypto");
const {enforceLegacyPublication}=require("./legacy-publication-guard.cjs");
const {jointCountRankings}=require("./count-only-rankings.cjs");
const {loadPublication,projectMasterProducts,projectOwnerPublicationRows,changePublication,validId,nameOnly}=require("./catalog-publication.cjs");
const {redactCashbackTiers}=require("./count-only-response.cjs");
const {readLinks,addLink,projectLinks}=require("./catalog-count-links.cjs");
const {normalizeExtraCounts,applyExtraCounts,projectedExtraRead}=require("./additional-counts.cjs");
const {projectExtraRankDocs}=require("./extra-rank-projection.cjs");
const {ownerPublishedExtraBreakdown}=require("./owner-published-extra-breakdown.cjs");
const {projectPartnerMonth}=require("./monthly-shared-projection.cjs");
const {projectPartnerProductMonth}=require("./partner-product-monthly.cjs");
const {decodeGroups,saveGroups,groupPersonalScores,canPublishSharedPersonalRankings}=require("./shared-ranking-groups.cjs");
const {readDirectDayCounts,readDirectRangeCounts}=require("./shared-direct-counts.cjs");
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
// Cashback is a product variant label, NOT a sales unit price or revenue.
const PARTNER_CB_OPTIONS=Object.freeze({"NURO":Object.freeze(["0","20000","40000","60000","80000","unclassified"])});
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
 const validateCbCounts=(raw,counts)=>{
  // Legacy records without a breakdown remain unchanged and unclassified.
  if(raw==null)return null;
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).length!==1||!Object.hasOwn(raw,"NURO"))fail("invalid-argument");
  const tiers=raw.NURO;
  if(!tiers||typeof tiers!=="object"||Array.isArray(tiers)||
     Object.keys(tiers).length>PARTNER_CB_OPTIONS.NURO.length)fail("invalid-argument");
  const normalized=Object.create(null);let sum=0;
  for(const [key,value] of Object.entries(tiers)){
   if(!PARTNER_CB_OPTIONS.NURO.includes(key)||
      !Number.isSafeInteger(value)||value<0||value>9999)fail("invalid-argument");
   normalized[key]=value;sum+=value;
  }
  if(sum!==counts.NURO)fail("invalid-argument");
  return {NURO:{...normalized}};
 };
 // Cashback tiers are metadata, never prices or revenues.
 // Legacy saved NURO without a CB breakdown remains explicitly unclassified.
 const tierCounts=(raw,counts)=>{
  const source=validateCbCounts(raw,counts)?.NURO;
  const out=Object.fromEntries(PARTNER_CB_OPTIONS.NURO.map(k=>[k,0]));
  if(source)for(const k of PARTNER_CB_OPTIONS.NURO)out[k]=source[k]||0;
  else out.unclassified=counts.NURO;
  return out;
 };
 const sumTiers=(target,source)=>{
  for(const tier of PARTNER_CB_OPTIONS.NURO)target[tier]+=source[tier]||0;
 };
 const blankTiers=()=>Object.fromEntries(PARTNER_CB_OPTIONS.NURO.map(k=>[k,0]));
 const validateWorkLocation=x=>{
  if(x===undefined||x===null)return "";
  if(typeof x!=="string"||x.length>100||/[\x00-\x1f\x7f]/.test(x))
   fail("invalid-argument");
  return x.trim();
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
 // New dynamic-count documents are intentionally disjoint from all original
 // fixed-9 product ledgers, daily reports, price histories and audits.
 const extraEntryRef=(cid,date,id)=>collection(cid,"partnerAdditionalCountEntries").doc(date+"__"+id);
 const extraUsageRef=(hub,productId)=>collection(hub,"partnerAdditionalProductUsage").doc(productId);
 const summaryRef=(hub,date,partner)=>collection(hub,"partnerWorkCountDays").doc(date).collection("reports").doc(partner);
 async function actor(request){
  if(enabled()!==true)fail("unavailable");
  const opaque=clean(request?.data?.codeSessionToken);
  if(opaque){
   if(request?.auth?.uid||!/^[A-Za-z0-9_-]{43}$/.test(opaque))fail("unauthenticated");
   const hash=crypto.createHash("sha256").update(opaque).digest("hex");
   const ss=await db.collection("partnerCodeSessions").doc(hash).get();
   const session=ss.data()||{},uid=session.principalUid,cid=session.companyId;
   if(!ss.exists||session.active!==true||!ID.test(uid||"")||
      !ID.test(cid||"")||!Number.isSafeInteger(session.version)||
      session.version<1||typeof session.expiresAt?.toMillis!=="function"||
      session.expiresAt.toMillis()<=now()||
      !/^NICO-[A-F0-9]{24}$/.test(session.companyCode||""))fail("unauthenticated");
   const [credentials,login]=await Promise.all([
    db.collection("partnerCodeCredentials").doc(cid).get(),
    db.collection("partnerCodeLogins").doc(session.companyCode).get()
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
  if(c.ownerUid!==uid||u.companyRole!=="owner"||m.companyRole!=="owner"||
     (u.accessKind!=null&&u.accessKind!=="internal")||
     (m.accessKind!=null&&m.accessKind!=="internal")||
     (u.memberType!=null&&!["internal","direct","member","managed"].includes(u.memberType))||
     (m.memberType!=null&&!["internal","direct","member","managed"].includes(m.memberType)))fail();
  return {kind:"hub",uid,cid,role:"owner"};
 }

 // The raw sales product master is read on the trusted backend only.
 // No pricing, sales history, or financial fields reach partner clients.
 async function viewCatalog(request){
  const a=await actor(request),d=request?.data||{};
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner"&&s.kind!=="hub")fail();
  const hubId=s.kind==="hub"?s.cid:s.hubId;
  if(!ID.test(hubId||""))fail();
  const [master,settings]=await Promise.all([
   db.collection("products").where("companyId","==",hubId).limit(1001).get(),
   collection(hubId,"partnerCatalogSettings").doc("publication").get()
  ]);
  if(master.size>1000)fail("resource-exhausted");
  if(master.docs.some(doc=>doc.data()?.companyId!==hubId))fail("data-loss");
  let state,rows;
  try{
   state=loadPublication(settings.exists?settings.data():null);
   const originals=master.docs.map(doc=>({...doc.data(),id:doc.id}));
   rows=s.kind==="partner"?
    projectMasterProducts(originals,state.productIds,true)
     .map(({id,name,sortOrder})=>({id,name,sortOrder})):
    projectOwnerPublicationRows(originals,state.productIds);
  }catch{fail("data-loss");}
  return {role:s.kind,revision:state.revision,products:rows};
 }
 // One product flag per transaction; optimistic version guards concurrent owners.
 // Existing products, price metadata and history are never written.
 async function setCatalogPublication(request){
  const a=await actor(request),d=request?.data||{};
  if(d.workspaceCompanyId!=null)fail();
  const s=await scope(a.uid);
  if(s.kind!=="hub"||s.role!=="owner"||
     !validId(d.productId)||typeof d.published!=="boolean"||
     !Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0)
    fail("permission-denied");
  const productRef=db.collection("products").doc(d.productId);
  const stateRef=collection(s.cid,"partnerCatalogSettings").doc("publication");
  return db.runTransaction(async tx=>{
   // Revalidate live Owner membership INSIDE the transaction, guarding a role revocation.
   const fresh=await scope(a.uid,tx);
   if(fresh.kind!=="hub"||fresh.role!=="owner"||fresh.cid!==s.cid)fail();
   const [productDoc,stateDoc]=await Promise.all([tx.get(productRef),tx.get(stateRef)]);
   const product=productDoc.data()||{};
   // Retired products may be unpublished; publishing requires active, safe master data.
   if(!productDoc.exists||product.companyId!==s.cid||
      (d.published&&product.active===false))fail("failed-precondition");
   if(d.published){
    try{nameOnly(product.name);}catch{fail("failed-precondition");}
   }
   let next;
   try{next=changePublication(stateDoc.exists?stateDoc.data():null,
     d.productId,d.published,d.expectedRevision);}
   catch{fail("aborted");}
   tx.set(stateRef,{...next,updatedByUid:a.uid,updatedAt:FieldValue.serverTimestamp()});
   return {saved:true,revision:next.revision,productId:d.productId,published:d.published};
  });
 }

 // Share the original group editor's definitions with other approved members.
 // The source remains hub-owned; partner users may only read redacted settings.
 const groupSettingsRef=hub=>collection(hub,"partnerRankingSettings").doc("shared");
 const publicationRef=hub=>collection(hub,"partnerCatalogSettings").doc("publication");
 async function readRankingSettings(hub){
  const [groups,publication]=await Promise.all([
   groupSettingsRef(hub).get(),publicationRef(hub).get()
  ]);
  try{
   const pub=loadPublication(publication.exists?publication.data():null);
   return decodeGroups(groups.exists?groups.data():null,
    {allowedProducts:pub.productIds,categories:KEYS});
  }catch{fail("data-loss");}
 }
 async function getPartnerRankingGroups(request){
  const a=await actor(request),d=request?.data||{};
  const s=await sharedRankScope(a.uid,d.workspaceCompanyId);
  const hub=s.kind==="hub"?s.cid:s.hubId;
  if(!validId(hub))fail();
  const config=await readRankingSettings(hub);
  return {scope:"shared_count_rank_groups",revision:config.revision,groups:config.groups};
 }
 async function setPartnerRankingGroups(request){
  const a=await actor(request),d=request?.data||{};
  if(d.workspaceCompanyId!=null||!Number.isSafeInteger(d.expectedRevision)||
     d.expectedRevision<0||!Array.isArray(d.groups))fail("invalid-argument");
  const s=await scope(a.uid);
  if(s.kind!=="hub"||s.role!=="owner")fail();
  return db.runTransaction(async tx=>{
   const fresh=await scope(a.uid,tx);
   if(fresh.kind!=="hub"||fresh.role!=="owner"||fresh.cid!==s.cid)fail();
   const configRef=groupSettingsRef(s.cid),pubRef=publicationRef(s.cid);
   const [existing,pubSnap]=await Promise.all([tx.get(configRef),tx.get(pubRef)]);
   let next;
   try{
    const pub=loadPublication(pubSnap.exists?pubSnap.data():null);
    next=saveGroups(existing.exists?existing.data():null,d.groups,d.expectedRevision,
     {allowedProducts:pub.productIds,categories:KEYS});
   }catch{fail("failed-precondition");}
   tx.set(configRef,{...next,updatedAt:FieldValue.serverTimestamp(),
     updatedByUid:a.uid});
   return {saved:true,revision:next.revision,groups:next.groups};
  });
 }

 // Explicit links apply only from the NEXT day onward. No past entry,
 // summary, ranking or saved CB tier is reinterpreted or overwritten.
 const countLinksRef=hub=>collection(hub,"partnerCatalogSettings").doc("countLinks");
 async function getPartnerCountLinks(request){
  const a=await actor(request),d=request?.data||{};
  if(Object.keys(d).some(key=>!["workspaceCompanyId","codeSessionToken"].includes(key)))
   fail("invalid-argument");
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  const hubId=s.kind==="hub"?s.cid:s.hubId;
  if(!validId(hubId))fail();
  const [linkSnap,pubSnap]=await Promise.all([
   countLinksRef(hubId).get(),publicationRef(hubId).get()
  ]);
  try{
   const pub=loadPublication(pubSnap.exists?pubSnap.data():null);
   const result=projectLinks(linkSnap.exists?linkSnap.data():null,{
    categories:KEYS,publishedIds:pub.productIds,audience:s.kind,
    date:s.kind==="partner"?jstToday():null
   });
   return {scope:"partner_count_category_links",...result};
  }catch{fail("data-loss");}
 }
 async function setPartnerCountLink(request){
  const a=await actor(request),d=request?.data||{};
  if(Object.keys(d).sort().join("|")!=="category|expectedRevision|productId"||
     !validId(d.productId)||!KEYS.includes(d.category)||
     !Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0)
   fail("invalid-argument");
  const s=await scope(a.uid);
  if(s.kind!=="hub"||s.role!=="owner")fail();
  const productRef=db.collection("products").doc(d.productId);
  const ref=countLinksRef(s.cid),pubRef=publicationRef(s.cid);
  const effectiveFrom=new Date(Date.parse(jstToday()+"T00:00:00Z")+86400000)
   .toISOString().slice(0,10);
  return db.runTransaction(async tx=>{
   const live=await scope(a.uid,tx);
   if(live.kind!=="hub"||live.role!=="owner"||live.cid!==s.cid)fail();
   const [productSnap,pubSnap,linkSnap,usageSnap]=await Promise.all([
    tx.get(productRef),tx.get(pubRef),tx.get(ref),tx.get(extraUsageRef(s.cid,d.productId))
   ]);
   // Refuse to reclassify a product that already has extra-count history.
   if(usageSnap.exists)fail("failed-precondition");
   const item=productSnap.data()||{};
   if(!productSnap.exists||item.companyId!==s.cid||item.active!==true)
    fail("failed-precondition");
   try{nameOnly(item.name);}catch{fail("failed-precondition");}
   let next;
   try{
    const pub=loadPublication(pubSnap.exists?pubSnap.data():null);
    next=addLink({existing:linkSnap.exists?linkSnap.data():null,
     productId:d.productId,category:d.category,effectiveFrom,
     expectedRevision:d.expectedRevision,publishedIds:pub.productIds,categories:KEYS});
   }catch{fail("failed-precondition");}
   // Never write productRef, entryRef, summaryRef, audit or revenue fields.
   tx.set(ref,{...next,updatedByUid:a.uid,updatedAt:FieldValue.serverTimestamp()});
   return {linked:true,revision:next.revision,productId:d.productId,
    category:d.category,effectiveFrom};
  });
 }

 // Product filtering is exclusively performed on the trusted service:
 // neither originals nor pricing fields are sent to partner browsers.
 async function approvedExtraCatalog(s,tx=null){
  if(s.kind!=="partner")fail();
  const get=ref=>tx?tx.get(ref):ref.get(),hub=s.hubId;
  const [master,pubDoc,linksDoc]=await Promise.all([
   get(db.collection("products").where("companyId","==",hub).limit(1001)),
   get(publicationRef(hub)),get(countLinksRef(hub))
  ]);
  if(master.size>1000)fail("resource-exhausted");
  if(master.docs.some(doc=>doc.data()?.companyId!==hub))fail("data-loss");
  let products,linked;
  try{
   const pub=loadPublication(pubDoc.exists?pubDoc.data():null);
   const links=readLinks(linksDoc.exists?linksDoc.data():null,KEYS);
   linked=new Set(links.links.map(link=>link.productId));
   products=projectMasterProducts(master.docs.map(doc=>({...doc.data(),id:doc.id})),
    pub.productIds,true).filter(product=>!linked.has(product.id))
    .map(({id,name,sortOrder})=>({id,name,sortOrder}));
  }catch{fail("data-loss");}
  return {products,blockedIds:[...linked]};
 }
 async function viewAdditionalCounts(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date);
  if(Object.keys(d).some(key=>!["date","workspaceCompanyId","codeSessionToken"].includes(key)))
   fail("invalid-argument");
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner")fail();
  const catalog=await approvedExtraCatalog(s);
  const [staffSnap,extraSnap]=await Promise.all([
   collection(s.cid,"partnerWorkStaff").limit(151).get(),
   collection(s.cid,"partnerAdditionalCountEntries").where("date","==",date)
    .limit(201).get()
  ]);
  if(staffSnap.size>150||extraSnap.size>200)fail("resource-exhausted");
  const accessible=new Set();
  for(const doc of staffSnap.docs){
   const person=doc.data()||{};
   if(!ID.test(doc.id)||person.companyId!==s.cid||!validName(person.name))
    fail("data-loss");
   if(canStaff(s,person))accessible.add(doc.id);
  }
  const ids=catalog.products.map(p=>p.id);
  const records=[];
  for(const doc of extraSnap.docs){
   const row=doc.data()||{};
   if(row.companyId!==s.cid||row.hubCompanyId!==s.hubId||
    row.date!==date||!ID.test(row.staffId||"")||
    doc.id!==date+"__"+row.staffId||
    !Number.isSafeInteger(row.version)||row.version<1||
    !Number.isSafeInteger(row.totalCount)||row.totalCount<0)fail("data-loss");
   if(!accessible.has(row.staffId))continue;
   let result;
   try{result=projectedExtraRead(row.counts,{visibleIds:ids});}
   catch{fail("data-loss");}
   if(result.totalCount!==row.totalCount)fail("data-loss");
   records.push({staffId:row.staffId,version:row.version,
    counts:result.counts,archivedTotal:result.archivedTotal,
    totalCount:result.totalCount,teamIdSnapshot:row.teamIdSnapshot||null});
  }
  return {scope:"partner_extra_counts",date,role:s.role,
   companyName:s.companyName,products:catalog.products,records};
 }
 async function submitAdditionalCounts(request){
  const a=await actor(request),d=request?.data||{},
   date=validDate(d.date),staffId=clean(d.staffId);
  if(!ID.test(staffId)||!Number.isSafeInteger(d.expectedVersion)||
     d.expectedVersion<0||d.expectedVersion>=999||
     !d.changes||Object.keys(d.changes).length===0)fail("invalid-argument");
  let patch;
  try{patch=normalizeExtraCounts(d.changes);}
  catch{fail("invalid-argument");}
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner")fail();
  return db.runTransaction(async tx=>{
   const live=await scope(a.uid,tx,d.workspaceCompanyId);
   if(live.kind!=="partner"||live.cid!==s.cid||live.hubId!==s.hubId)fail();
   const sr=staffRef(s.cid,staffId),er=extraEntryRef(s.cid,date,staffId);
   const [staffSnap,prevSnap,legacySnap,catalog]=await Promise.all([
    tx.get(sr),tx.get(er),tx.get(entryRef(s.cid,date,staffId)),
    approvedExtraCatalog(live,tx)
   ]);
   const person=staffSnap.data()||{},previous=prevSnap.data()||{};
   if(!staffSnap.exists||person.active!==true||person.companyId!==s.cid||
      !validName(person.name)||!canStaff(live,person))fail();
   if(prevSnap.exists){
    if(previous.date!==date||previous.companyId!==s.cid||
       previous.hubCompanyId!==s.hubId||previous.staffId!==staffId||
       !Number.isSafeInteger(previous.version)||previous.version<1||
       previous.version!==d.expectedVersion)fail("aborted");
   }else if(d.expectedVersion!==0)fail("aborted");
   let old,next;
   try{
    old=normalizeExtraCounts(prevSnap.exists?previous.counts:{});
    if(prevSnap.exists&&old.total!==previous.totalCount)
     fail("data-loss");
    next=applyExtraCounts({previous:old.counts,changes:patch.counts,
     allowedIds:catalog.products.map(p=>p.id),blockedLegacyIds:catalog.blockedIds});
   }catch(e){if(e?.code==="data-loss")throw e;fail("failed-precondition");}
   if(JSON.stringify(old.counts)===JSON.stringify(next.counts))
    return {saved:false,unchanged:true,staffId,date,
     version:prevSnap.exists?previous.version:0,totalCount:old.total};
   if(Object.keys(next.counts).length>100)fail("resource-exhausted");
   const usedIds=Object.keys(next.counts).filter(id=>next.counts[id]>0);
   // Permanent usage marker prevents an Owner mapping an already-counted
   // extra product into a legacy bucket (which would double-count it).
   const usedSnaps=await Promise.all(usedIds.map(id=>tx.get(extraUsageRef(s.hubId,id))));
   for(let i=0;i<usedIds.length;i++){
    const doc=usedSnaps[i],value=doc.data()||{};
    if(doc.exists&&(value.hubCompanyId!==s.hubId||value.productId!==usedIds[i]))
     fail("data-loss");
   }
   // A saved historical sales-team snapshot is authoritative. Never attach
   // extra counts for an old date to the worker\u0027s CURRENT team.
   const legacy=legacySnap.data()||{};
   if(legacySnap.exists&&(legacy.companyId!==s.cid||
      legacy.staffId!==staffId||legacy.date!==date))fail("data-loss");
   const teamIdSnapshot=prevSnap.exists?previous.teamIdSnapshot:
    legacySnap.exists?legacy.teamIdSnapshot:
    date===jstToday()?person.teamId:null;
   const staffNameSnapshot=prevSnap.exists?previous.staffNameSnapshot:
    legacySnap.exists?legacy.staffNameSnapshot:
    date===jstToday()?person.name:null;
   if(!ID.test(teamIdSnapshot||"")||!validName(staffNameSnapshot))fail("data-loss");
   if(!prevSnap.exists){
    const team=await tx.get(teamRef(s.cid,teamIdSnapshot));
    if(!team.exists||team.data()?.companyId!==s.cid||team.data()?.active!==true)
      fail("failed-precondition");
   }
   const nowStamp=FieldValue.serverTimestamp(),version=d.expectedVersion+1;
   const row={companyId:s.cid,hubCompanyId:s.hubId,date,staffId,
    counts:next.counts,totalCount:next.total,version,
    staffNameSnapshot,teamIdSnapshot,updatedByUid:a.uid,updatedAt:nowStamp};
   if(prevSnap.exists)tx.update(er,row);
   else tx.create(er,{...row,createdAt:nowStamp});
   const audit=collection(s.cid,"partnerAdditionalCountAudits")
    .doc(date+"__"+staffId+"__v"+version);
   tx.create(audit,{...row,previousCounts:old.counts,
    previousTotalCount:old.total,createdAt:nowStamp});
   for(let i=0;i<usedIds.length;i++){
    if(!usedSnaps[i].exists)
     tx.create(extraUsageRef(s.hubId,usedIds[i]),
      {hubCompanyId:s.hubId,productId:usedIds[i],
       firstCompanyId:s.cid,firstDate:date,createdAt:nowStamp});
   }
   return {saved:true,staffId,date,version,totalCount:next.total};
  });
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
  return ["owner","leader"].includes(s.role)||
    (s.role==="member"&&staff.uid===s.uid&&staff.kind==="account");
 };
 async function manage(request){
  const {uid}=await actor(request),d=request?.data||{},op=d.action;
  if(!["addTeam","addManaged","removeManaged","createInvite","moveStaff","addPrivateProduct","setPrivateProduct",
   "hubAddTeam","hubCreateInvite"].includes(op))fail("invalid-argument");
  const s=await scope(uid,null,d.workspaceCompanyId);
  if(op==="hubAddTeam"||op==="hubCreateInvite"){
   const newCompany=op==="hubCreateInvite"&&d.partnerCompanyId==null;
   if(s.kind!=="hub"||s.role!=="owner")fail();
   if(newCompany){
    if(!validCompanyName(d.companyName)||d.teamId!=null)fail("invalid-argument");
   }else if(!ID.test(d.partnerCompanyId||""))fail("invalid-argument");
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
      !["leader","member"].includes(d.role)||(!newCompany&&!ID.test(d.teamId||"")))
    fail("invalid-argument");
   const companyName=clean(d.companyName).normalize("NFKC");
   if(newCompany&&!validCompanyName(companyName))fail("invalid-argument");
   const partnerId=newCompany?"partner_"+crypto.createHash("sha256")
    .update(s.cid+"\n"+companyName.toLowerCase()).digest("hex"):d.partnerCompanyId;
   const teamId=newCompany?"initial":d.teamId;
   const token=crypto.randomBytes(32).toString("base64url");
   const hash=crypto.createHash("sha256").update(token).digest("hex");
   const expiresAt=Timestamp.fromMillis(now()+30*60000);
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.kind!=="hub"||fresh.cid!==s.cid||fresh.role!=="owner")fail();
    if(newCompany){
     const cr=db.collection("companies").doc(partnerId);
     const rr=db.collection("partnerRelations").doc(partnerId);
     const [existing,relation,relations]=await Promise.all([
      tx.get(cr),tx.get(rr),tx.get(db.collection("partnerRelations").where("hubCompanyId","==",s.cid).limit(101))
     ]);
     if(existing.exists||relation.exists)fail("already-exists");
     if(relations.size>=100)fail("resource-exhausted");
     // Only the internal owner explicitly creates a count-sharing workspace.
     // No representative, owner account, financial access or existing data edits.
     const stamp={createdByUid:uid,createdAt:FieldValue.serverTimestamp()};
     tx.create(cr,{name:companyName,companyKind:"partner",hubCompanyId:s.cid,active:true,...stamp});
     tx.create(rr,{partnerCompanyId:partnerId,hubCompanyId:s.cid,active:true,
      countSharingApproved:true,...stamp});
     tx.create(collection(partnerId,"partnerWorkTeams").doc(teamId),{
      name:"1班",companyId:partnerId,active:true,...stamp});
    }else{
     const partner=await hubPartner(tx,s.cid,partnerId);
     if(!partner.active)fail("failed-precondition");
     await checkTeam(tx,{cid:partnerId},teamId);
    }
    tx.create(db.collection("partnerWorkInvites").doc(hash),{
     companyId:partnerId,hubCompanyId:s.cid,teamId,
     role:d.role,emailLower:clean(d.email).toLowerCase(),invitedByUid:uid,
     status:"pending",createdAt:FieldValue.serverTimestamp(),expiresAt
    });
   });
   return {token,expiresAt:expiresAt.toMillis(),partnerCompanyId:partnerId,teamId};
  }
  if(s.kind!=="partner"||s.role==="member")fail();
  if(op==="addPrivateProduct"){
   if(s.kind!=="partner"||!["owner","leader"].includes(s.role)||!validPrivateName(d.name))
     fail("invalid-argument");
   const existing=await collection(s.cid,"partnerPrivateProducts").limit(101).get();
   if(existing.size>=100)fail("resource-exhausted");
   const ref=collection(s.cid,"partnerPrivateProducts").doc();
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.kind!=="partner"||fresh.cid!==s.cid||!["owner","leader"].includes(fresh.role))fail();
    tx.create(ref,{companyId:s.cid,name:clean(d.name),active:true,
      origin:"partner_custom",visibility:"private",createdByUid:uid,
      createdAt:FieldValue.serverTimestamp()});
   });
   return {productId:ref.id,created:true};
  }
  if(op==="setPrivateProduct"){
   if(s.kind!=="partner"||!["owner","leader"].includes(s.role)||!ID.test(d.productId||"")||
      typeof d.active!=="boolean"||!validPrivateName(d.name))fail("invalid-argument");
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.kind!=="partner"||fresh.cid!==s.cid||!["owner","leader"].includes(fresh.role))fail();
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
   if(!["owner","leader"].includes(s.role)||!validName(d.name))fail("invalid-argument");
   const ref=collection(s.cid,"partnerWorkTeams").doc();
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.cid!==s.cid||!["owner","leader"].includes(fresh.role))fail();
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
    const teamId=clean(d.teamId);
    await checkTeam(tx,fresh,teamId);
    tx.create(ref,{name:clean(d.name),kind:"managed",role:"member",uid:null,
      teamId,companyId:s.cid,active:true,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
   });
   return {staffId:ref.id,created:true};
  }
  if(op==="removeManaged"){
   // Reversible archive for manually registered (email-less) staff only.
   // Never remove Firebase Auth, memberships, financial data or past counts.
   // Logged-in accounts require a separate reviewed membership revocation.
   if(!["owner","leader"].includes(s.role)||!ID.test(d.staffId||""))
    fail("invalid-argument");
   const archived=await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.kind!=="partner"||fresh.cid!==s.cid||
       !["owner","leader"].includes(fresh.role))fail();
    const ref=staffRef(s.cid,d.staffId),snap=await tx.get(ref);
    const person=snap.data()||{};
    if(!snap.exists||person.companyId!==s.cid||
       person.kind!=="managed"||person.uid!=null||
       person.role!=="member"||!validName(person.name)||
       !ID.test(person.teamId||""))fail("failed-precondition");
    if(person.active===false)return false; // idempotent, never erase
    if(person.active!==true)fail("failed-precondition");
    tx.update(ref,{active:false,deactivatedByUid:uid,
     deactivatedAt:FieldValue.serverTimestamp(),
     updatedByUid:uid,updatedAt:FieldValue.serverTimestamp()});
    return true;
   });
   return {staffId:d.staffId,archived:true,changed:archived};
  }
  if(op==="moveStaff"){
   if(!["owner","leader"].includes(s.role)||!ID.test(d.staffId||"")||!ID.test(d.teamId||""))fail("invalid-argument");
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx,d.workspaceCompanyId);
    if(fresh.cid!==s.cid||!["owner","leader"].includes(fresh.role))fail();
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
     !["owner","leader"].includes(s.role))fail("invalid-argument");
  const token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt=Timestamp.fromMillis(now()+30*60000);
  await db.runTransaction(async tx=>{
   const fresh=await scope(uid,tx,d.workspaceCompanyId);
   if(fresh.kind!=="partner"||fresh.cid!==s.cid||!["owner","leader"].includes(fresh.role))fail();
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
  if(d.previewOnly!==undefined&&d.previewOnly!==true)fail("invalid-argument");
  if(d.previewOnly===true){
   // The verified invitee may preview without joining or changing data.
   const sn=await ref.get(),i=sn.data()||{};
   if(!sn.exists||i.status!=="pending"||
      !i.expiresAt?.toMillis||i.expiresAt.toMillis()<=now())
    fail("failed-precondition");
   if(i.emailLower!==a.email)fail("permission-denied");
   if(!ID.test(i.companyId||"")||!ID.test(i.teamId||"")||
      !["leader","member"].includes(i.role))fail("failed-precondition");
   const [company,relation,team]=await Promise.all([
    db.collection("companies").doc(i.companyId).get(),
    db.collection("partnerRelations").doc(i.companyId).get(),
    teamRef(i.companyId,i.teamId).get()
   ]);
   if(!company.exists||company.data()?.active!==true||
      company.data()?.companyKind!=="partner"||
      company.data()?.hubCompanyId!==i.hubCompanyId||
      !relation.exists||relation.data()?.hubCompanyId!==i.hubCompanyId||
      relation.data()?.partnerCompanyId!==i.companyId||
      relation.data()?.active!==true||relation.data()?.countSharingApproved!==true||
      !team.exists||team.data()?.active!==true)
    fail("failed-precondition");
   return {valid:true,companyName:clean(company.data()?.name),
     teamName:clean(team.data()?.name),role:i.role};
  }
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
        original.uid!==a.uid||
        (clean(original.email)&&clean(original.email).toLowerCase()!==a.email)||
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
        (clean(pm.email)&&clean(pm.email).toLowerCase()!==a.email)||
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
   // A pending link cannot retain a revoked inviter's authority.
   if(!ID.test(i.invitedByUid||""))fail("failed-precondition");
   const inviterContext=await tx.get(db.collection("partnerWorkspaceContexts").doc(i.invitedByUid));
   const inviter=await scope(i.invitedByUid,tx,
     inviterContext.exists&&inviterContext.data()?.partnerCompanyId===i.companyId?i.companyId:"");
   if(!((inviter.kind==="hub"&&inviter.cid===i.hubCompanyId&&inviter.role==="owner")||
        (inviter.kind==="partner"&&inviter.cid===i.companyId&&
         ["owner","leader"].includes(inviter.role))))fail();
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
 // Shared count-only standings do not grant finance or management rights.
 // Internal members already joined to the same live company may READ ranks.
 // All other endpoints still use strict Owner-only scope().
 async function sharedRankScope(uid,workspaceCompanyId=""){
  if(workspaceCompanyId)return scope(uid,null,workspaceCompanyId);
  const us=await db.collection("users").doc(uid).get(),u=us.data()||{};
  if(!us.exists||u.uid!==uid||u.active!==true||!ID.test(u.companyId||""))fail();
  const cid=u.companyId;
  const [cs,ms]=await Promise.all([
   db.collection("companies").doc(cid).get(),
   collection(cid,"members").doc(uid).get()
  ]);
  const c=cs.data()||{},m=ms.data()||{};
  if(!cs.exists||!ms.exists||c.active!==true||
     m.active!==true||m.uid!==uid||(m.companyId!=null&&m.companyId!==cid)||
     u.companyRole!==m.companyRole)fail();
  if(c.companyKind==="partner")return scope(uid);
  if(c.companyKind!=null&&!["internal","direct"].includes(c.companyKind))fail();
  if((u.accessKind!=null&&u.accessKind!=="internal")||
     (m.accessKind!=null&&m.accessKind!=="internal")||
     ["partner","cooperator"].includes(u.memberType)||
     ["partner","cooperator"].includes(m.memberType)||
     !["owner","member"].includes(u.companyRole)||
     !["leader","member"].includes(u.role)||m.role!==u.role)
   fail();
  return {kind:"hub",uid,cid,role:u.companyRole};
 }
 async function viewProductMonthly(request){
  const a=await actor(request),d=request?.data||{};
  if(Object.keys(d).some(key=>!["month","workspaceCompanyId"].includes(key))||
    typeof d.month!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month)||
    d.month>jstToday().slice(0,7))fail("invalid-argument");
  const [year,num]=d.month.split("-").map(Number);
  const first=d.month+"-01";
  const monthEnd=new Date(Date.UTC(year,num,0)).toISOString().slice(0,10);
  const last=monthEnd<jstToday()?monthEnd:jstToday();
  // The partner may query ONLY its own approved workspace: no hub financial
  // records, cross-partner collections, names or prices enter this endpoint.
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner"||!ID.test(s.cid)||!ID.test(s.hubId))fail();
  const [work,extra,linksSnap]=await Promise.all([
   collection(s.cid,"partnerWorkEntries")
    .where("date",">=",first).where("date","<=",last).limit(2001).get(),
   collection(s.cid,"partnerAdditionalCountEntries")
    .where("date",">=",first).where("date","<=",last).limit(2001).get(),
   countLinksRef(s.hubId).get()
  ]);
  // Avoid displaying incomplete months as authoritative totals when capped.
  if(work.size>2000||extra.size>2000)fail("resource-exhausted");
  let summary;
  try{
   const linked=readLinks(linksSnap.exists?linksSnap.data():null,KEYS).links;
   summary=projectPartnerProductMonth({
    hubId:s.hubId,cid:s.cid,month:d.month,keys:KEYS,
    workDocs:work.docs,extraDocs:extra.docs,
    linkedIds:linked.map(link=>link.productId)
   });
  }catch{fail("data-loss");}
  return {scope:"partner_product_monthly_counts_only",month:d.month,
   role:s.role,companyName:clean(s.companyName),...summary};
 }
 async function viewMonthly(request){
  const a=await actor(request),d=request?.data||{};
  if(Object.keys(d).some(k=>!["month","workspaceCompanyId"].includes(k))||
     typeof d.month!=="string"||!/^\d{4}-\d{2}$/.test(d.month))
   fail("invalid-argument");
  const first=validDate(d.month+"-01"),current=jstToday();
  const [year,monthNum]=d.month.split("-").map(Number);
  const last=new Date(Date.UTC(year,monthNum,0)).toISOString().slice(0,10);
  const lastDate=last<current?last:current;
  const s=await sharedRankScope(a.uid,d.workspaceCompanyId);
  const hubId=s.kind==="hub"?s.cid:s.hubId;
  if(!ID.test(hubId||""))fail();
  const relations=await db.collection("partnerRelations")
   .where("hubCompanyId","==",hubId).limit(21).get();
  if(relations.size>20)fail("resource-exhausted");
  const [pubDoc,linksDoc]=await Promise.all([
   publicationRef(hubId).get(),countLinksRef(hubId).get()
  ]);
  let publishedIds,allLinks;
  try{
   publishedIds=loadPublication(pubDoc.exists?pubDoc.data():null).productIds;
   allLinks=readLinks(linksDoc.exists?linksDoc.data():null,KEYS).links;
  }catch{fail("data-loss");}
  const linkedIds=allLinks.map(x=>x.productId);
  const extraVerifiedIds=publishedIds.filter(id=>!linkedIds.includes(id));
  // Monthly reads are intentionally bounded; never send incomplete data as a
  // "complete" ranking or pass any raw original financial fields to clients.
  let direct;
  try{
   direct=await readDirectRangeCounts(db,hubId,first,lastDate,KEYS,{
    maxRecords:10000,approvedExtraProductIds:extraVerifiedIds
   });
  }catch{fail("failed-precondition");}
  const companies=[],people=[],teams=[],productCounts=Object.fromEntries(KEYS.map(k=>[k,0]));
  let additionalTotalCount=0,partnerRowsRead=0;
  for(const relSnap of relations.docs){
   const rel=relSnap.data()||{},cid=relSnap.id;
   if(!ID.test(cid)||rel.partnerCompanyId!==cid||rel.hubCompanyId!==hubId)
    fail("data-loss");
   if(rel.active!==true||rel.countSharingApproved!==true)continue;
   const companySnap=await db.collection("companies").doc(cid).get();
   const company=companySnap.data()||{};
   if(!companySnap.exists||company.companyKind!=="partner"||
      company.hubCompanyId!==hubId||!validCompanyName(company.name))
    fail("data-loss");
   if(company.active!==true)continue;
   const [legacy,extra,teamDocs]=await Promise.all([
    collection(cid,"partnerWorkEntries").where("date",">=",first)
     .where("date","<=",lastDate).limit(2001).get(),
    collection(cid,"partnerAdditionalCountEntries").where("date",">=",first)
     .where("date","<=",lastDate).limit(2001).get(),
    collection(cid,"partnerWorkTeams").limit(151).get()
   ]);
   if(legacy.size>2000||extra.size>2000||teamDocs.size>150)
    fail("resource-exhausted");
   const teamNames={};
   for(const doc of teamDocs.docs){
    const data=doc.data()||{};
    if(!ID.test(doc.id)||data.companyId!==cid||!validName(data.name))
     fail("data-loss");
    teamNames[doc.id]=clean(data.name);
   }
   partnerRowsRead+=legacy.size+extra.size;
   if(partnerRowsRead>10000)fail("resource-exhausted");
   let rank;
   try{
    rank=projectPartnerMonth({
     hubId,cid,companyName:clean(company.name),from:first,to:lastDate,
     legacyDocs:legacy.docs,extraDocs:extra.docs,keys:KEYS,
     publishedIds:extraVerifiedIds,linkedIds,teamNames
    });
   }catch{fail("data-loss");}
   companies.push({id:cid,name:rank.name,totalCount:rank.totalCount,
    extraTotalCount:rank.additionalTotalCount,counts:rank.counts,
    peopleVerified:true});
   people.push(...rank.people);teams.push(...rank.teams);
   for(const key of KEYS)productCounts[key]+=rank.counts[key];
   additionalTotalCount+=rank.additionalTotalCount;
  }
  let sharedConfig={revision:0,groups:[]},groupStandings=[],groupStatus="unverified";
  try{
   sharedConfig=await readRankingSettings(hubId);
   // Linking halfway through a month is NOT sufficient to back-classify the
   // earlier days. Whole-month rank only uses links active on its first day.
   const effectiveLinks=allLinks.filter(link=>link.effectiveFrom<=first);
   // Saved company totals are valid, but a missing per-person source must
   // never create an apparently verified individual/product leaderboard.
   if(canPublishSharedPersonalRankings(direct,companies)){
    groupStandings=groupPersonalScores(sharedConfig.groups,[
     ...people,...direct.people.map(p=>({...p,companyName:"直営"}))
    ],{categories:KEYS,productLinks:effectiveLinks,extraVerifiedIds});
    groupStatus="verified";
   }
  }catch{groupStandings=[];}
  companies.sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
  people.sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
  // Individual ledgers alone cannot prove all companies submitted all days.
  // Always label this a provisional, VERIFIED-ENTRIES monthly leaderboard.
  const response={scope:"shared_monthly_counts_only",month:d.month,
   role:s.kind==="hub"?"hub":"partner",complete:false,
   provisionalReason:"月間の全日・全員報告の照合前",
   includesDirect:true,companies,teams,people,productCounts,additionalTotalCount,
   categories:KEYS,direct,rankingGroups:sharedConfig.groups,groupStandings,
   groupRevision:sharedConfig.revision,groupStatus,
   recordsVerified:direct.recordsVerified,partnerRowsVerified:partnerRowsRead};
   return s.kind==="partner"?redactCashbackTiers(response):response;
 }
 async function view(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date);
  if(d.resolveSecondaryWorkspace===true){
   // Repeated password login on a different phone: resolve the EXISTING
   // authenticated user's secondary-company membership, never an invite.
   if(Object.keys(d).some(key=>!["date","resolveSecondaryWorkspace"].includes(key)))
    fail("invalid-argument");
   const context=await db.collection("partnerWorkspaceContexts").doc(a.uid).get();
   if(!context.exists)return {scope:"partner_workspace_lookup",workspaceCompanyId:null};
   const stored=context.data()||{};
   if(stored.uid!==a.uid||stored.kind!=="partner_secondary"||
      stored.active!==true||!ID.test(stored.partnerCompanyId||""))
    fail("failed-precondition");
   // The same authority check used for real saves ensures revoked roles,
   // disabled companies and stale member records never resolve here.
   const verified=await scope(a.uid,null,stored.partnerCompanyId);
   if(verified.kind!=="partner"||verified.cid!==stored.partnerCompanyId)fail();
   return {scope:"partner_workspace_lookup",workspaceCompanyId:verified.cid};
  }
  const s=d.sharedRankings===true
   ?await sharedRankScope(a.uid,d.workspaceCompanyId)
   :await scope(a.uid,null,d.workspaceCompanyId);
  if(d.sharedRankings===true){
   // The same COUNT-ONLY standings are available to the original Hub Owner
   // and to authenticated partners already approved for sharing. No direct
   // sales originals, prices, private products, UIDs or emails are queried.
   if(d.partnerCompanyId!=null||d.includeTeamStatus===true)fail("invalid-argument");
   const hubId=s.kind==="hub"?s.cid:s.hubId;
   if(!ID.test(hubId||""))fail();
   const relations=await db.collection("partnerRelations")
    .where("hubCompanyId","==",hubId).limit(21).get();
   if(relations.size>20)fail("resource-exhausted"); // fail closed, never partial ranking
   const approved=[];
   for(const relSnap of relations.docs){
    const rel=relSnap.data()||{},cid=relSnap.id;
    if(!ID.test(cid)||rel.partnerCompanyId!==cid||rel.hubCompanyId!==hubId)
     fail("data-loss");
    if(rel.active!==true||rel.countSharingApproved!==true)continue;
    const companySnap=await db.collection("companies").doc(cid).get();
    const company=companySnap.data()||{};
    if(!companySnap.exists||company.companyKind!=="partner"||
       company.hubCompanyId!==hubId||!validCompanyName(company.name))
     fail("data-loss");
    if(company.active===true)approved.push({cid,name:clean(company.name)});
   }
   const companies=[],teams=[],people=[],missingCompanies=[];
   const productCounts=Object.fromEntries(KEYS.map(key=>[key,0]));
   // The partner extra ledger is independent of the original nine categories.
   // Check publication and immutable links once, before any ranking is composed.
   const [rankPubSnap,rankLinkSnap]=await Promise.all([
    publicationRef(hubId).get(),countLinksRef(hubId).get()
   ]);
   let publishedIds,allCountLinks;
   try{
    publishedIds=loadPublication(rankPubSnap.exists?rankPubSnap.data():null).productIds;
    allCountLinks=readLinks(rankLinkSnap.exists?rankLinkSnap.data():null,KEYS).links;
   }catch{fail("data-loss");}
   const linkedIds=allCountLinks.map(link=>link.productId);
   const extraVerifiedIds=publishedIds.filter(id=>!linkedIds.includes(id));
   const effectiveLinks=allCountLinks.filter(link=>link.effectiveFrom<=date);
   let additionalTotalCount=0;
   let complete=true;
   for(const company of approved){
    const cid=company.cid;
    const [reportSnap,entrySnaps,teamSnaps,extraSnaps]=await Promise.all([
     summaryRef(hubId,date,cid).get(),
     collection(cid,"partnerWorkEntries").where("date","==",date).limit(201).get(),
     collection(cid,"partnerWorkTeams").limit(151).get(),
     collection(cid,"partnerAdditionalCountEntries").where("date","==",date).limit(201).get()
    ]);
    if(entrySnaps.size>200||teamSnaps.size>150||extraSnaps.size>200)
     fail("resource-exhausted");
    let extraRows;
    try{
     extraRows=projectExtraRankDocs(extraSnaps.docs,{
      hubId,cid,date,publishedIds:extraVerifiedIds,linkedIds
     });
    }catch{fail("data-loss");}
    if(!reportSnap.exists){
     // Extra-only submissions are real counts, but missing nine-category
     // reports remain marked INCOMPLETE, never silently treated as 0.
     if(entrySnaps.size)fail("data-loss");
     complete=false;missingCompanies.push(company.name);
     if(!extraRows.length)continue;
    }
    const r=reportSnap.data()||{};
    if(reportSnap.exists&&(r.partnerCompanyId!==cid||r.hubCompanyId!==hubId||
       r.date!==date||!validCompanyName(r.partnerName)))fail("data-loss");
    const summary=reportSnap.exists?validateCounts(r.counts):
     {counts:Object.fromEntries(KEYS.map(k=>[k,0])),total:0};
    if(reportSnap.exists&&summary.total!==r.totalCount)fail("data-loss");
    const savedTeams=new Map();
    for(const t of teamSnaps.docs){
     const x=t.data()||{};
     if(!ID.test(t.id)||x.companyId!==cid||!validName(x.name))
      fail("data-loss");
     savedTeams.set(t.id,clean(x.name));
    }
    const group=new Map(),unique=new Set(),members=[],memberByStaff=new Map();
    let verified=0;
    for(const entrySnap of entrySnaps.docs){
     const e=entrySnap.data()||{};
     if(e.companyId!==cid||e.hubCompanyId!==hubId||e.date!==date||
        !ID.test(e.staffId||"")||unique.has(e.staffId))
      fail("data-loss");
     unique.add(e.staffId);
     const item=validateCounts(e.counts);
     if(item.total!==e.totalCount)fail("data-loss");
     verified+=item.total;
     const tid=ID.test(e.teamIdSnapshot||"")?e.teamIdSnapshot:"";
     const safeName=validName(e.staffNameSnapshot)?
      clean(e.staffNameSnapshot):"担当者未確認";
     const cb=tierCounts(e.cbCounts,item.counts);
     const key=crypto.createHash("sha256").update(cid+"\n"+e.staffId)
      .digest("hex");
     const member={key,name:safeName,companyName:company.name,
      companyId:cid,teamKey:crypto.createHash("sha256").update(cid+"\nteam\n"+tid).digest("hex"),
      teamName:savedTeams.get(tid)||"登録当時の班未確認",
      totalCount:item.total,counts:item.counts,extraCounts:{},cbCounts:{NURO:cb}};
     members.push(member);memberByStaff.set(e.staffId,member);
     const bucket=group.get(tid)||{name:savedTeams.get(tid)||"登録当時の班未確認",
      totalCount:0,counts:Object.fromEntries(KEYS.map(k=>[k,0])),cbCounts:{NURO:blankTiers()}};
     bucket.totalCount+=item.total;
     for(const k of KEYS)bucket.counts[k]+=item.counts[k];
     sumTiers(bucket.cbCounts.NURO,cb);
     group.set(tid,bucket);
    }
    // Legacy company-level reports have no verified staff ledger. They
    // remain visible as company totals but NEVER turn into imaginary people.
    const hasLedger=reportSnap.exists&&r.source==="staff-entries-v1";
    if(hasLedger&&verified!==summary.total)fail("data-loss");
    if(!hasLedger&&entrySnaps.size>0)fail("data-loss");
    if(!hasLedger)complete=false;
    let companyExtras=0;
    for(const extra of extraRows){
     const tid=extra.teamIdSnapshot,teamKey=crypto.createHash("sha256")
      .update(cid+"\nteam\n"+tid).digest("hex");
     let member=memberByStaff.get(extra.staffId);
     if(member&&member.teamKey!==teamKey)fail("data-loss");
     if(!member){
      member={key:crypto.createHash("sha256").update(cid+"\n"+extra.staffId).digest("hex"),
       name:clean(extra.staffNameSnapshot),companyName:company.name,companyId:cid,
       teamKey,teamName:savedTeams.get(tid)||"登録当時の班未確認",
       totalCount:0,counts:Object.fromEntries(KEYS.map(k=>[k,0])),
       extraCounts:{},cbCounts:{NURO:blankTiers()}};
      memberByStaff.set(extra.staffId,member);members.push(member);
     }
     member.totalCount+=extra.totalCount;
     member.extraCounts=extra.extraCounts;
     companyExtras+=extra.totalCount;
     const bucket=group.get(tid)||{name:savedTeams.get(tid)||"登録当時の班未確認",
      totalCount:0,counts:Object.fromEntries(KEYS.map(k=>[k,0])),
      cbCounts:{NURO:blankTiers()}};
     bucket.totalCount+=extra.totalCount;
     group.set(tid,bucket);
    }
    additionalTotalCount+=companyExtras;
    companies.push({id:cid,name:company.name,totalCount:summary.total+companyExtras,
     counts:summary.counts,extraTotalCount:companyExtras,peopleVerified:hasLedger});
    for(const k of KEYS)productCounts[k]+=summary.counts[k];
    if(hasLedger||extraRows.length){
     people.push(...members);
     for(const [tid,item] of group)teams.push({
      key:crypto.createHash("sha256").update(cid+"\nteam\n"+tid).digest("hex"),
      companyId:cid,companyName:company.name,...item
     });
    }
   }
   companies.sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
   people.sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
   teams.sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
   // Authenticated Hub and approved partner both receive the same verified
   // redacted direct-company counters. The separate reader alone touches
   // legacy records; it returns no money, email, UID, or original documents.
   // An index/limit mismatch FAILS, never pretends direct sales were zero.
   let direct;
   try{direct=await readDirectDayCounts(db,hubId,date,KEYS,{
    approvedExtraProductIds:extraVerifiedIds
   });}
   catch{fail("failed-precondition");}
   // Missing real staff IDs must not create fictitious personal rankings.
   // Company and team totals remain visible, clearly marked incomplete.
   if(direct.peopleVerified!==true)complete=false;
   // New group settings cannot take down established direct+partner rankings.
   // Report the group as unverified, never invent category/identity mappings.
   let sharedConfig={revision:0,groups:[]},groupStandings=[],groupStatus="unverified";
   try{
    sharedConfig=await readRankingSettings(hubId);
    // Date-effective mappings count existing buckets once. Unlinked,
    // published additional products count only from verified extra ledgers.
    if(canPublishSharedPersonalRankings(direct,companies)){
     groupStandings=groupPersonalScores(sharedConfig.groups,
      [...people,...direct.people.map(person=>({...person,companyName:"直営"}))],
      {categories:KEYS,productLinks:effectiveLinks,extraVerifiedIds});
     groupStatus="verified";
    }
   }catch(error){
    // No raw errors, finance or hidden group names are serialized to clients.
    groupStandings=[];
   }
   const response={scope:"shared_counts_only",date,role:s.kind==="hub"?"hub":"partner",
    complete,includesDirect:true,missingCompanies,companies,teams,people,
    countRankings:jointCountRankings({companies,teams,people,direct}),
    productCounts,additionalTotalCount,categories:KEYS,direct,rankingGroups:sharedConfig.groups,
    groupStandings,groupRevision:sharedConfig.revision,groupStatus};
    return s.kind==="partner"?redactCashbackTiers(response):response;
  }
  if(d.includeAuditHistory===true&&s.kind!=="partner")fail("invalid-argument");
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
      totalCount:0,reportedStaffCount:0,members:[],cbCounts:{NURO:blankTiers()}
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
     const cb=tierCounts(e.cbCounts,item.counts);
     sumTiers(row.cbCounts.NURO,cb);
     // Immutable name snapshot, no financial originals or private products.
     // No staffId, UID or email escapes the Hub Owner count-only API.
     const safeName=validName(e.staffNameSnapshot)?clean(e.staffNameSnapshot):
      "担当者未確認";
     row.members.push({name:safeName,totalCount:item.total,counts:{...item.counts},
      cbCounts:{NURO:cb}});
    }
    // The old nine-category day report remains unchanged. Additional published
    // products have an independent ledger and must NOT be silently dropped from
    // HQ's team/member breakdown or mixed into old CB/revenue totals.
    // This path is Hub OWNER only, on-demand and count-only.
    const extraSnap=await collection(selectedPartnerId,"partnerAdditionalCountEntries")
     .where("date","==",date).limit(201).get();
    if(extraSnap.size>200)fail("resource-exhausted");
    let publishedAdditional={scope:"published_extra_count_only",complete:true,
     verifiedPublishedCount:0,unattributedPublishedCount:0,teams:[]};
    if(extraSnap.size){
     const [pubSnap,linksSnap,master]=await Promise.all([
      publicationRef(s.cid).get(),countLinksRef(s.cid).get(),
      db.collection("products").where("companyId","==",s.cid).limit(1001).get()
     ]);
     if(master.size>1000||master.docs.some(doc=>doc.data()?.companyId!==s.cid))
      fail("data-loss");
     try{
      const publicIds=loadPublication(pubSnap.exists?pubSnap.data():null).productIds;
      const links=readLinks(linksSnap.exists?linksSnap.data():null,KEYS).links;
      const blocked=new Set(links.map(x=>x.productId));
      const publicProducts=projectMasterProducts(
       master.docs.map(doc=>({...doc.data(),id:doc.id})),publicIds,true)
       .filter(product=>!blocked.has(product.id))
       .map(({id,name})=>({id,name}));
      publishedAdditional=ownerPublishedExtraBreakdown(extraSnap.docs,{
       hubId:s.cid,cid:selectedPartnerId,date,teamIds:[...rows.keys()],
       publishedProducts:publicProducts,linkedIds:[...blocked]
      });
     }catch{fail("data-loss");}
    }
    partnerTeamDetails={
     partnerCompanyId:selectedPartnerId,companyName:chosen.name,date,
     teams:[...rows.values()].sort((a,b)=>a.name.localeCompare(b.name,"ja")),
     verifiedSharedCount,unverifiedTeamCount,scope:"shared_counts_only",
     publishedAdditional
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
  if(d.includeAuditHistory!=null&&d.includeAuditHistory!==true)fail("invalid-argument");
  const [teams,staff,entries,privateProducts,legacyLinksSnap,legacyPublicationSnap]=await Promise.all([
    collection(s.cid,"partnerWorkTeams").limit(151).get(),
    collection(s.cid,"partnerWorkStaff").limit(151).get(),
    collection(s.cid,"partnerWorkEntries").where("date","==",date).limit(201).get(),
    collection(s.cid,"partnerPrivateProducts").limit(101).get(),
    countLinksRef(s.hubId).get(),publicationRef(s.hubId).get()
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
   const cbCounts=validateCbCounts(x.cbCounts,counts);
   const workLocation=validateWorkLocation(x.workLocation);
   rows.push({staffId:x.staffId,counts,totalCount:total,version:x.version,workLocation,
     teamIdSnapshot,privateCounts:privateCounts.counts,privateTotalCount:privateCounts.total,
     cbCounts});
  }
  // Read immutable count-only audit events ONLY when the history tab is opened.
  // Never query finance originals. Revisions beyond this explicit bound fail
  // rather than silently hiding older corrections.
  let audits;
  if(d.includeAuditHistory===true){
   const revisions=await collection(s.cid,"partnerWorkAudits")
    .where("date","==",date).limit(501).get();
   if(revisions.size>500)fail("resource-exhausted");
   audits=[];
   for(const sn of revisions.docs){
    const x=sn.data()||{};
    if(x.companyId!==s.cid||x.hubCompanyId!==s.hubId||
       x.date!==date||!ID.test(x.staffId||"")||
       !Number.isSafeInteger(x.version)||x.version<1||x.version>999)
      fail("data-loss");
    if(!allowed.has(x.staffId))continue;
    const next=validateCounts(x.counts),before=validateCounts(x.previousCounts);
    if(next.total!==x.totalCount)fail("data-loss");
    const nextPrivate=validatePrivateCounts(x.privateCounts||{});
    const prevPrivate=validatePrivateCounts(x.previousPrivateCounts||{});
    if(nextPrivate.total!==(x.privateTotalCount??0))fail("data-loss");
    if(Object.keys(nextPrivate.counts).some(id=>!privateIdSet.has(id))||
       Object.keys(prevPrivate.counts).some(id=>!privateIdSet.has(id)))
      fail("data-loss");
    const cbCounts=validateCbCounts(x.cbCounts,next.counts);
    const previousCbCounts=validateCbCounts(x.previousCbCounts,before.counts);
    const workLocation=validateWorkLocation(x.workLocation);
    const previousWorkLocation=validateWorkLocation(x.previousWorkLocation);
    audits.push({staffId:x.staffId,
     staffName:validName(x.staffNameSnapshot)?clean(x.staffNameSnapshot):allowed.get(x.staffId).name,
     version:x.version,date,totalCount:next.total,previousTotalCount:before.total,
     counts:next.counts,previousCounts:before.counts,
     cbCounts,previousCbCounts,workLocation,previousWorkLocation,
     privateCounts:nextPrivate.counts,previousPrivateCounts:prevPrivate.counts,
     privateTotalCount:nextPrivate.total,previousPrivateTotalCount:prevPrivate.total});
   }
   audits.sort((a,b)=>a.staffName.localeCompare(b.staffName,"ja")||
     a.version-b.version||a.staffId.localeCompare(b.staffId));
  }
  const visibleTeams=teams.docs.map(sn=>({id:sn.id,name:clean(sn.data().name),active:sn.data().active===true}))
   .filter(team=>["owner","leader"].includes(s.role)||team.id===s.teamId);
  return {role:s.role,date,companyName:clean(s.companyName),teamId:s.teamId,
    teams:visibleTeams,staff:[...allowed.values()],records:rows,categories:KEYS,
    legacyCategoryPublication:(()=>{
     try{
      const linked=readLinks(legacyLinksSnap.exists?legacyLinksSnap.data():null,KEYS).links;
      const published=new Set(loadPublication(legacyPublicationSnap.exists?legacyPublicationSnap.data():null).productIds);
      return KEYS.map(category=>{
       const link=linked.find(x=>x.category===category);
       return {category,acceptsIncrease:!link||date<link.effectiveFrom||published.has(link.productId)};
      });
     }catch{fail("data-loss");}
    })(),
    privateProducts:productList,...(audits?{audits}: {})};
 }
 async function submit(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date),staffId=clean(d.staffId);
  if(!ID.test(staffId)||!Number.isSafeInteger(d.expectedVersion)||d.expectedVersion<0)fail("invalid-argument");
  const {counts,total}=validateCounts(d.counts);
  const requestedCb=Object.hasOwn(d,"cbCounts")?
   validateCbCounts(d.cbCounts,counts):undefined;
  const workLocation=validateWorkLocation(d.workLocation);
  const workTeamId=d.workTeamId==null?null:clean(d.workTeamId);
  if(d.workTeamId!=null&&!ID.test(workTeamId))fail("invalid-argument");
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
   const [oldSnap,totalSnap,publicationSnap,linksSnap,...productSnapshots]=await Promise.all([
    tx.get(er),tx.get(summary),tx.get(publicationRef(s.hubId)),tx.get(countLinksRef(s.hubId)),
    ...privateProductIds.map(id=>tx.get(privateProductRef(s.cid,id)))
   ]);
   for(let i=0;i<privateProductIds.length;i++){
    const doc=productSnapshots[i],x=doc?.data()||{};
    if(!doc?.exists||x.companyId!==s.cid||x.origin!=="partner_custom"||
       x.visibility!=="private"||(x.active!==true&&requestedPrivate[privateProductIds[i]]>0))
      fail("failed-precondition");
   }
   const old=oldSnap.data()||{},existing=totalSnap.data()||{};
   const previousWorkLocation=oldSnap.exists?
     validateWorkLocation(old.workLocation):"";
   if(oldSnap.exists&&old.version!==d.expectedVersion||!oldSnap.exists&&d.expectedVersion!==0)
     fail("aborted");
   if(d.expectedVersion>=999)fail("resource-exhausted");
   // Never mix per-person entries with the earlier one-total-per-partner UI.
   if(totalSnap.exists&&existing.source!=="staff-entries-v1")fail("failed-precondition");
   const previousPrivate=oldSnap.exists?validatePrivateCounts(old.privateCounts||{}).counts:{};
   const priorCounts=oldSnap.exists?validateCounts(old.counts).counts:
    Object.fromEntries(KEYS.map(key=>[key,0]));
   const oldCb=oldSnap.exists?validateCbCounts(old.cbCounts,priorCounts):null;
   try{
    enforceLegacyPublication({linksDoc:linksSnap.exists?linksSnap.data():null,
     publicationDoc:publicationSnap.exists?publicationSnap.data():null,
     categories:KEYS,date,previous:priorCounts,next:counts});
   }catch{fail("failed-precondition");}
   // Old clients that save only totals cannot corrupt a previously saved CB
   // distribution. If they change NURO totals, mark the breakdown unclassified.
   const nextCb=requestedCb!==undefined?requestedCb:
    (oldCb&&priorCounts.NURO===counts.NURO?oldCb:null);
   const privateNext={...previousPrivate,...(requestedPrivate||{})};
   const privateValidated=validatePrivateCounts(privateNext);
   const prior=priorCounts;
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
   // Historical team attribution is immutable. Only a first-time daily entry
   // may choose another ACTIVE team in the same partner company.
   const teamIdSnapshot=oldSnap.exists?
     (Object.prototype.hasOwnProperty.call(old,"teamIdSnapshot")?old.teamIdSnapshot:null):
     (workTeamId||person.teamId);
   if(oldSnap.exists&&workTeamId&&workTeamId!==teamIdSnapshot)
    fail("failed-precondition");
   if(!oldSnap.exists){
    if(!ID.test(teamIdSnapshot||"")||
       (fresh.role==="member"&&teamIdSnapshot!==person.teamId))
     fail("permission-denied");
    const chosenTeam=await tx.get(teamRef(s.cid,teamIdSnapshot));
    if(!chosenTeam.exists||chosenTeam.data()?.companyId!==s.cid||
       chosenTeam.data()?.active!==true)fail("failed-precondition");
   }
   const staffNameSnapshot=oldSnap.exists?
     (Object.prototype.hasOwnProperty.call(old,"staffNameSnapshot")?old.staffNameSnapshot:null):
     person.name;
   if(teamIdSnapshot!==null&&!ID.test(teamIdSnapshot))fail("data-loss");
   if(staffNameSnapshot!==null&&!validName(staffNameSnapshot))fail("data-loss");
   const nowStamp=FieldValue.serverTimestamp(),nextVersion=d.expectedVersion+1;
   const row={companyId:s.cid,hubCompanyId:s.hubId,staffId,date,counts,totalCount:total,
     privateCounts:privateValidated.counts,privateTotalCount:privateValidated.total,
     cbCounts:nextCb,workLocation,
     version:nextVersion,staffNameSnapshot,teamIdSnapshot,
     updatedByUid:a.uid,updatedAt:nowStamp};
   if(oldSnap.exists)tx.update(er,row);else tx.create(er,{...row,createdAt:nowStamp});
   const sum={source:"staff-entries-v1",hubCompanyId:s.hubId,partnerCompanyId:s.cid,
     partnerName:clean(s.companyName),date,counts:aggregate,totalCount:aggregateTotal,
     updatedAt:nowStamp};
   if(!validCompanyName(sum.partnerName))fail();
   if(totalSnap.exists)tx.update(summary,sum);else tx.create(summary,{...sum,createdAt:nowStamp});
   const audit=collection(s.cid,"partnerWorkAudits").doc(date+"__"+staffId+"__v"+nextVersion);
   tx.create(audit,{...row,previousCounts:prior,previousCbCounts:oldCb,
     previousWorkLocation,previousPrivateCounts:previousPrivate,
     createdAt:nowStamp});
   return {saved:true,staffId,date,version:nextVersion,totalCount:total,
     privateTotalCount:privateValidated.total};
  });
 }
 return Object.freeze({manage,accept,view,viewMonthly,viewProductMonthly,submit,viewCatalog,setCatalogPublication,
  getPartnerRankingGroups,setPartnerRankingGroups,getPartnerCountLinks,setPartnerCountLink,
  viewAdditionalCounts,submitAdditionalCounts});
}
module.exports={makeWorkspace,KEYS};
