"use strict";
/**
 * STAGING ONLY — NO DEPLOY / DEFAULT OFF.
 * A real primary Owner may explicitly approve/revoke existing verified
 * secondary Owner-role members, without moving companies.ownerUid, touching
 * membership, finance originals, historical counts or user Auth data.
 *
 * All mutating operations use a single transaction and append immutable audit
 * metadata. No automatic grants based solely on existing owner-role flags.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const INTERNAL_TYPES=new Set(["internal","direct","member","managed"]);
const safeId=x=>typeof x==="string"&&ID.test(x);
const validActor=(u,m,uid,cid)=>u?.uid===uid&&u.companyId===cid&&
 u.active===true&&u.companyRole==="owner"&&u.authKind!=="partner_code_shared"&&
 (u.accessKind==null||u.accessKind==="internal")&&
 (u.memberType==null||INTERNAL_TYPES.has(u.memberType))&&
 m?.uid===uid&&m.active===true&&m.companyRole==="owner"&&
 (m.companyId==null||m.companyId===cid)&&
 (m.accessKind==null||m.accessKind==="internal")&&
 (m.memberType==null||INTERNAL_TYPES.has(m.memberType))&&
 m.authKind!=="partner_code_shared";
function makeOwnerDelegateApproval({
 db,getAuth,FieldValue,HttpsError,verifyHubOwner,enabled=()=>false
}={}){
 if(!db?.collection||typeof db.runTransaction!=="function"||
    typeof getAuth!=="function"||!FieldValue?.serverTimestamp||
    typeof HttpsError!=="function"||
    typeof verifyHubOwner!=="function"||typeof enabled!=="function")
  throw Error("OWNER_DELEGATE_APPROVAL_DEPENDENCIES");
 const fail=(code="permission-denied")=>{
  throw new HttpsError(code,"追加Ownerの承認条件が確認できません。");
 };
 async function primary(request,tx){
  if(enabled()!==true)fail("unavailable");
  const owner=await verifyHubOwner(request,tx);
  if(!owner||owner.kind!=="hub"||owner.role!=="owner"||
     owner.ownerGrant!=="primary"||!safeId(owner.uid)||!safeId(owner.hubId))
   fail();
  return owner;
 }
 const companyRef=cid=>db.collection("companies").doc(cid);
 const validList=(c,ownerUid)=>{
  const array=c.approvedHubOwnerUids??[];
  if(!Array.isArray(array)||array.length>10||
     array.some(x=>!safeId(x)||x===ownerUid)||
     new Set(array).size!==array.length)
   fail("failed-precondition");
  return array;
 };
 const validCompany=(c,owner)=>{
  if(c?.active!==true||c.ownerUid!==owner.uid||
    (c.companyKind!=null&&!["internal","direct"].includes(c.companyKind)))
   fail();
  return true;
 };
 async function verifiedCandidate(cid,uid,tx){
  const read=ref=>tx?tx.get(ref):ref.get();
  const [us,ms]=await Promise.all([
   read(db.collection("users").doc(uid)),
   read(companyRef(cid).collection("members").doc(uid))
  ]);
  if(!us?.exists||!ms?.exists||
     !validActor(us.data(),ms.data(),uid,cid))fail();
  let a;try{a=await getAuth().getUser(uid)}catch{fail()};
  if(a?.uid!==uid||a.disabled===true||a.emailVerified!==true||
     typeof a.email!=="string")fail();
  return a;
 }
 async function list(request){
  if(request?.data==null||Object.keys(request.data).length!==0)
   fail("invalid-argument");
  const owner=await primary(request,null);
  const cSnap=await companyRef(owner.hubId).get();
  if(!cSnap?.exists)fail();
  const company=cSnap.data()||{};
  validCompany(company,owner);
  const grants=validList(company,owner.uid);
  const version=company.ownerGrantVersion??0;
  if(!Number.isSafeInteger(version)||version<0||version>999999)fail();
  const users=await db.collection("users").where("companyId","==",owner.hubId)
   .limit(31).get();
  if(!Array.isArray(users?.docs)||users.docs.length>30)
   fail("resource-exhausted");
  const candidates=[];
  for(const row of users.docs){
   if(!safeId(row.id)||row.id===owner.uid)continue;
   const u=row.data()||{};
   if(u.companyRole!=="owner"||u.active!==true)continue;
   try{
    const a=await verifiedCandidate(owner.hubId,row.id,null);
    if(candidates.length>=10)fail("resource-exhausted");
    candidates.push({
     uid:row.id,displayName:typeof a.displayName==="string"&&
      a.displayName.length<=60?a.displayName:"Owner",
     approved:grants.includes(row.id)
    });
   }catch(e){
    // Invalid roles must never be presented as approvable candidates.
    if(e?.code==="resource-exhausted")throw e;
   }
  }
  return {scope:"explicit-additional-hub-owners",
   role:"primary-owner",ownerGrantVersion:version,candidates,
   financeIncluded:false,canEditOriginalOwnerUid:false};
 }
 async function change(request){
  const d=request?.data;
  if(!d||typeof d!=="object"||Array.isArray(d)||
     Object.keys(d).sort().join("|")!=="approved|expectedVersion|targetUid"||
     typeof d.approved!=="boolean"||!safeId(d.targetUid)||
     !Number.isSafeInteger(d.expectedVersion)||d.expectedVersion<0||
     d.expectedVersion>=999999)fail("invalid-argument");
  const targetAuth=await getAuth().getUser(d.targetUid).catch(()=>fail());
  if(targetAuth?.uid!==d.targetUid||targetAuth.disabled===true||
     targetAuth.emailVerified!==true)fail();
  const auditRef=db.collection("ownerDelegateAudit").doc();
  return db.runTransaction(async tx=>{
   const owner=await primary(request,tx);
   if(d.targetUid===owner.uid)fail();
   const ref=companyRef(owner.hubId),snapshot=await tx.get(ref);
   if(!snapshot?.exists)fail();
   const c=snapshot.data()||{};
   validCompany(c,owner);
   const grants=validList(c,owner.uid);
   const version=c.ownerGrantVersion??0;
   if(version!==d.expectedVersion)fail("aborted");
   await verifiedCandidate(owner.hubId,d.targetUid,tx);
   const already=grants.includes(d.targetUid);
   if(already===d.approved)fail("already-exists");
   if(d.approved&&grants.length>=10)fail("resource-exhausted");
   const after=d.approved?[...grants,d.targetUid].sort():
    grants.filter(x=>x!==d.targetUid);
   tx.update(ref,{
    approvedHubOwnerUids:after,
    ownerGrantVersion:version+1
   });
   tx.create(auditRef,{
    kind:"hub-owner-explicit-delegate",
    hubCompanyId:owner.hubId,
    primaryOwnerUid:owner.uid,
    delegatedOwnerUid:d.targetUid,
    action:d.approved?"approve":"revoke",
    previousVersion:version,
    nextVersion:version+1,
    createdAt:FieldValue.serverTimestamp()
   });
   return {updated:true,ownerGrantVersion:version+1,
    delegatedOwnerUid:d.targetUid,approved:d.approved};
  });
 }
 return Object.freeze({list,change});
}
module.exports={makeOwnerDelegateApproval};
