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
   if(!ID.test(id)||!Number.isSafeInteger(count)||count<0||count>9999)
    fail("invalid-argument");
   result[id]=count;sum+=count;
  }
  return {counts:result,total:sum};
 };
 const collection=(cid,name)=>db.collection("companies").doc(cid).collection(name);
 const teamRef=(cid,id)=>collection(cid,"partnerWorkTeams").doc(id);
 const staffRef=(cid,id)=>collection(cid,"partnerWorkStaff").doc(id);
 const privateProductRef=(cid,id)=>collection(cid,"partnerPrivateProducts").doc(id);
 const entryRef=(cid,date,id)=>collection(cid,"partnerWorkEntries").doc(date+"__"+id);
 const summaryRef=(hub,date,partner)=>collection(hub,"partnerWorkCountDays").doc(date).collection("reports").doc(partner);
 async function actor(request){
  if(enabled()!==true)fail("unavailable");
  const uid=request?.auth?.uid,email=clean(request?.auth?.token?.email).toLowerCase();
  if(!ID.test(uid||"")||!EMAIL.test(email)||request?.auth?.token?.email_verified!==true)fail("unauthenticated");
  const bearer=request?.rawRequest?.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/i)?.[1];
  if(!bearer)fail("unauthenticated");
  let a,t;
  try{[a,t]=await Promise.all([getAuth().getUser(uid),getAuth().verifyIdToken(bearer,true)]);}
  catch{fail("unauthenticated");}
  if(!a||a.disabled===true||a.emailVerified!==true||
     clean(a.email).toLowerCase()!==email||t?.uid!==uid||
     t.email_verified!==true||clean(t.email).toLowerCase()!==email)fail("unauthenticated");
  return {uid,email};
 }
 async function scope(uid,tx=null){
  const read=ref=>tx?tx.get(ref):ref.get();
  const us=await read(db.collection("users").doc(uid));
  const u=us.data()||{},cid=clean(u.companyId);
  if(!us.exists||!ID.test(cid)||u.uid!==uid||u.active!==true)fail();
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
      relation.data()?.partnerCompanyId!==cid)fail();
   return {kind:"partner",uid,cid,hubId:c.hubCompanyId,companyName:c.name,
     role:owner?"owner":u.role,teamId:owner?null:u.teamId};
  }
  if(c.companyKind!=null&&!["internal","direct"].includes(c.companyKind))fail();
  if(c.ownerUid!==uid||u.companyRole!=="owner"||m.companyRole!=="owner"||
     u.accessKind==="partner"||m.accessKind==="partner")fail();
  return {kind:"hub",uid,cid,role:"owner"};
 }
 const checkTeam=async(tx,s,id)=>{
  if(!ID.test(id||""))fail("invalid-argument");
  const sn=await tx.get(teamRef(s.cid,id));
  if(!sn.exists||sn.data()?.active!==true)fail("failed-precondition");
  return sn.data();
 };
 const canStaff=(s,staff)=>{
  return s.role==="owner"||
    (s.role==="leader"&&staff.teamId===s.teamId)||
    (s.role==="member"&&staff.uid===s.uid&&staff.kind==="account");
 };
 async function manage(request){
  const {uid}=await actor(request),d=request?.data||{},op=d.action;
  if(!["addTeam","addManaged","createInvite","moveStaff","addPrivateProduct","setPrivateProduct"].includes(op))fail("invalid-argument");
  const s=await scope(uid);
  if(s.kind!=="partner"||s.role==="member")fail();
  if(op==="addPrivateProduct"){
   if(s.kind!=="partner"||s.role!=="owner"||!validPrivateName(d.name))
     fail("invalid-argument");
   const existing=await collection(s.cid,"partnerPrivateProducts").limit(101).get();
   if(existing.size>=100)fail("resource-exhausted");
   const ref=collection(s.cid,"partnerPrivateProducts").doc();
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx);
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
    const fresh=await scope(uid,tx);
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
    const fresh=await scope(uid,tx);
    if(fresh.cid!==s.cid||fresh.role!=="owner")fail();
    tx.create(ref,{name:clean(d.name),active:true,companyId:s.cid,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
   });
   return {teamId:ref.id,created:true};
  }
  if(op==="addManaged"){
   if(!validName(d.name))fail("invalid-argument");
   const ref=collection(s.cid,"partnerWorkStaff").doc();
   await db.runTransaction(async tx=>{
    const fresh=await scope(uid,tx);
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
    const fresh=await scope(uid,tx);if(fresh.role!=="owner")fail();
    await checkTeam(tx,fresh,d.teamId);
    const ref=staffRef(fresh.cid,d.staffId),sn=await tx.get(ref);
    if(!sn.exists||sn.data()?.active!==true||sn.data()?.companyId!==s.cid)fail();
    if(sn.data().kind==="account"&&ID.test(sn.data().uid||"")){
      const targetUid=sn.data().uid;
      const ur=db.collection("users").doc(targetUid),mr=collection(s.cid,"members").doc(targetUid);
      // Firestore requires all transaction reads BEFORE the first write.
      const [us,ms]=await Promise.all([tx.get(ur),tx.get(mr)]);
      if(!us.exists||!ms.exists||us.data()?.companyId!==s.cid||ms.data()?.companyId!==s.cid)fail();
      tx.update(ur,{teamId:d.teamId});tx.update(mr,{teamId:d.teamId});
    }
    tx.update(ref,{teamId:d.teamId,updatedAt:FieldValue.serverTimestamp()});
   });
   return {moved:true};
  }
  if(!EMAIL.test(clean(d.email).toLowerCase())||
     !["leader","member"].includes(d.role)||!ID.test(d.teamId||"")||
     (s.role!=="owner"&&(d.role!=="member"||d.teamId!==s.teamId)))fail("invalid-argument");
  const token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt=Timestamp.fromMillis(now()+30*60000);
  await db.runTransaction(async tx=>{
   const fresh=await scope(uid,tx);
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
  const hash=crypto.createHash("sha256").update(token).digest("hex"),ref=db.collection("partnerWorkInvites").doc(hash);
  await db.runTransaction(async tx=>{
   const inviteSnap=await tx.get(ref),i=inviteSnap.data()||{};
   if(!inviteSnap.exists||i.status!=="pending"||i.emailLower!==a.email||
      !ID.test(i.companyId||"")||!ID.test(i.teamId||"")||
      !["leader","member"].includes(i.role)||i.expiresAt?.toMillis?.()<=now()||
      !i.expiresAt?.toMillis)fail("failed-precondition");
   const cr=db.collection("companies").doc(i.companyId),ur=db.collection("users").doc(a.uid),
    mr=collection(i.companyId,"members").doc(a.uid),sr=staffRef(i.companyId,a.uid);
   const [cs,us,ms,ss]=await Promise.all([tx.get(cr),tx.get(ur),tx.get(mr),tx.get(sr)]);
   if(!cs.exists||cs.data()?.companyKind!=="partner"||cs.data()?.active!==true||
      cs.data()?.hubCompanyId!==i.hubCompanyId||ms.exists||ss.exists||
      us.data()?.companyId||us.data()?.active===false)fail("failed-precondition");
   await checkTeam(tx,{cid:i.companyId},i.teamId);
   const name=clean(d.name);
   if(!validName(name))fail("invalid-argument");
   const profile={uid:a.uid,companyId:i.companyId,name,email:a.email,
     role:i.role,companyRole:"member",teamId:i.teamId,active:true,
     accessKind:"partner",memberType:"cooperator",
     canViewRevenue:false,canViewUnitPrice:false,canCreateInvite:false,
     updatedAt:FieldValue.serverTimestamp()};
   if(us.exists)tx.update(ur,profile);else tx.create(ur,profile);
   tx.create(mr,{...profile,joinedAt:FieldValue.serverTimestamp()});
   tx.create(sr,{uid:a.uid,name,kind:"account",role:i.role,teamId:i.teamId,
     companyId:i.companyId,active:true,createdAt:FieldValue.serverTimestamp()});
   tx.update(ref,{status:"accepted",acceptedByUid:a.uid,acceptedAt:FieldValue.serverTimestamp()});
  });
  return {joined:true};
 }
 async function view(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date);
  const s=await scope(a.uid);
  if(s.kind==="hub"){
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
    partners.push({partnerCompanyId:sn.id,name:x.partnerName,totalCount:total,counts});
   }
   partners.sort((x,y)=>x.name.localeCompare(y.name,"ja"));
   return {role:"hub",date,partners,categories:KEYS};
  }
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
  const s=await scope(a.uid);
  if(s.kind!=="partner")fail();
  return db.runTransaction(async tx=>{
   const fresh=await scope(a.uid,tx);
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
   const nowStamp=FieldValue.serverTimestamp(),nextVersion=d.expectedVersion+1;
   const row={companyId:s.cid,hubCompanyId:s.hubId,staffId,date,counts,totalCount:total,
     privateCounts:privateValidated.counts,privateTotalCount:privateValidated.total,
     version:nextVersion,staffNameSnapshot:person.name,teamIdSnapshot:person.teamId,
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
