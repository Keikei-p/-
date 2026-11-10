/**
 * STAGING / NOT DEPLOYED: server-owned persistence for the hub owner's
 * product ON/OFF settings. Does NOT update raw sales products/records,
 * existing count entries, income, Rules or authentication.
 *
 * Caller MUST first verify the Firebase ID token on the server, including
 * token revocation + verified email, then pass the resulting principal.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|unitPrice|cashback)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const stop=()=>{throw Error("OWNER_PRODUCT_VISIBILITY_STORE_UNAUTHORIZED_OR_INCOMPLETE");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const read=x=>x?.exists===true&&typeof x.data==="function"?x.data():null;
const ids=x=>Array.isArray(x)&&x.length<=1000&&
 x.every(id)&&new Set(x).size===x.length;
const saneName=x=>typeof x==="string"&&x.trim().length>0&&
 x.trim().length<=80&&!MONEY.test(x);
const normalize=(s,hubId,ownerUid)=>{
 if(!s)return {version:0,enabledHubProductIds:[],partnerOverrides:{}};
 if(s.hubCompanyId!==hubId||s.ownerUid!==ownerUid||
    !Number.isSafeInteger(s.version)||s.version<1||s.version>100000||
    !ids(s.enabledHubProductIds)||!obj(s.partnerOverrides)||
    Object.keys(s.partnerOverrides).length>100)stop();
 const partnerOverrides={};
 for(const [cid,values] of Object.entries(s.partnerOverrides)){
  if(!id(cid)||cid===hubId||!ids(values))stop();
  partnerOverrides[cid]=values.slice();
 }
 return {version:s.version,
  enabledHubProductIds:s.enabledHubProductIds.slice(),
  partnerOverrides};
};
function productsOf(snapshot,hubId){
 if(!Array.isArray(snapshot?.docs)||snapshot.docs.length>1000)stop();
 const rows=[],seen=new Set();
 for(const d of snapshot.docs){
  const v=read(d);
  if(!id(d.id)||seen.has(d.id)||!obj(v)||
     v.companyId!==hubId||!saneName(v.name)||
     (v.active!==undefined&&typeof v.active!=="boolean"))stop();
  seen.add(d.id);
  rows.push({id:d.id,name:v.name.trim(),active:v.active!==false});
 }
 return rows.sort((a,b)=>a.name.localeCompare(b.name,"ja")||
  a.id.localeCompare(b.id));
}
function validateSelected(settings,products){
 const found=new Map(products.map(x=>[x.id,x]));
 for(const x of settings.enabledHubProductIds){
  // Retired products may remain in saved ON history, but can never publish.
  // The owner must still be able to open settings and turn them OFF.
  if(!found.has(x))stop();
 }
 for(const arr of Object.values(settings.partnerOverrides)){
  for(const x of arr)if(!found.has(x))stop();
 }
}
export function createOwnerProductVisibilityStore({db,FieldValue}={}){
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function"||
    !FieldValue||typeof FieldValue.serverTimestamp!=="function")stop();
 const companies=()=>db.collection("companies");
 const users=()=>db.collection("users");
 const settingsRef=hub=>companies().doc(hub)
  .collection("rankingProductVisibility").doc("shared");
 // Owner-reviewed public count catalog. No private sales master ever leaves
 // this codebase: only id/name/active and the matching visibility revision.
 const publicCatalogRef=hub=>companies().doc(hub)
  .collection("rankingCountPublicCatalog").doc("shared");
 const catalog=hub=>db.collection("products")
  .where("companyId","==",hub).limit(1001);
 async function owner(tx,principal){
  if(!id(principal?.uid)||principal.emailVerified!==true||
     typeof principal.email!=="string"||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(principal.email))stop();
  const [us,secondary]=await Promise.all([
   tx.get(users().doc(principal.uid)),
   tx.get(db.collection("partnerWorkspaceContexts").doc(principal.uid))
  ]);
  const u=read(us),s=read(secondary);
  if(!obj(u)||u.uid!==principal.uid||!id(u.companyId)||
     u.active!==true||u.companyRole!=="owner"||
     (typeof u.email==="string"&&
      u.email.toLowerCase()!==principal.email.toLowerCase())||
     (secondary.exists&&s?.active!==false))stop();
  const hub=u.companyId;
  const [cs,ms]=await Promise.all([
   tx.get(companies().doc(hub)),
   tx.get(companies().doc(hub).collection("members").doc(principal.uid))
  ]);
  const c=read(cs),m=read(ms);
  if(!obj(c)||!obj(m)||c.ownerUid!==principal.uid||
     c.active===false||!["internal","direct",undefined,null].includes(c.companyKind)||
     m.uid!==principal.uid||m.companyRole!=="owner"||
     m.active!==true||
     (m.companyId!=null&&m.companyId!==hub)||
     u.accessKind==="partner"||m.accessKind==="partner"||
     u.authKind==="partner_code_shared")stop();
  return {hub,ownerUid:principal.uid};
 }
 async function readStatus(principal){
  return db.runTransaction(async tx=>{
   const {hub,ownerUid}=await owner(tx,principal);
   const [saved,all]=await Promise.all([
    tx.get(settingsRef(hub)),tx.get(catalog(hub))
   ]);
   const products=productsOf(all,hub);
   const state=normalize(read(saved),hub,ownerUid);
   validateSelected(state,products);
   const selected=new Set(state.enabledHubProductIds);
   return {schema:"nico-hub-product-visibility-v1",role:"hub_owner",version:state.version,
    hubCompanyId:hub,products:products.map(p=>({
     id:p.id,name:p.name,active:p.active,enabled:p.active&&selected.has(p.id)
    })),partnerOverrides:state.partnerOverrides};
  },{readOnly:true});
 }
 async function saveSwitch({principal,productId,enabled,expectedVersion,
   partnerCompanyId=null}={}){
  if(!id(productId)||typeof enabled!=="boolean"||
     !Number.isSafeInteger(expectedVersion)||expectedVersion<0||
     expectedVersion>=100000||
     (partnerCompanyId!==null&&!id(partnerCompanyId)))stop();
  return db.runTransaction(async tx=>{
   const {hub,ownerUid}=await owner(tx,principal);
   if(partnerCompanyId===hub)stop();
   const [stored,all,existingPublicCatalog]=await Promise.all([
    tx.get(settingsRef(hub)),tx.get(catalog(hub)),
    tx.get(publicCatalogRef(hub))
   ]);
   const products=productsOf(all,hub);
   const state=normalize(read(stored),hub,ownerUid);
   validateSelected(state,products);
   if(expectedVersion!==state.version)stop();
   const product=products.find(x=>x.id===productId);
   if(!product||(enabled&&product.active!==true))stop();
   if(partnerCompanyId!==null){
    const [rs,cs]=await Promise.all([
     tx.get(db.collection("partnerRelations").doc(partnerCompanyId)),
     tx.get(companies().doc(partnerCompanyId))
    ]);
    const rel=read(rs),company=read(cs);
    if(!obj(rel)||!obj(company)||rel.partnerCompanyId!==partnerCompanyId||
       rel.hubCompanyId!==hub||rel.active!==true||
       rel.countSharingApproved!==true||
       company.companyKind!=="partner"||
       company.hubCompanyId!==hub||company.active!==true)stop();
   }
   const target=partnerCompanyId===null?new Set(state.enabledHubProductIds):
    new Set(state.partnerOverrides[partnerCompanyId]||
     state.enabledHubProductIds);
   if(partnerCompanyId!==null&&enabled&&
      !state.enabledHubProductIds.includes(productId))stop();
   const before=target.has(productId);
   if(enabled)target.add(productId);else target.delete(productId);
   if(before===enabled)return {saved:false,version:state.version,
    productId,enabled,partnerCompanyId};
   const next=Object.fromEntries(Object.entries(state.partnerOverrides)
    .map(([key,value])=>[key,value.slice()]));
   let global=state.enabledHubProductIds.slice();
   if(partnerCompanyId===null)global=[...target].sort();
   else next[partnerCompanyId]=[...target].sort();
   const version=state.version+1,at=FieldValue.serverTimestamp();
   const update={hubCompanyId:hub,ownerUid,version,
    enabledHubProductIds:global,partnerOverrides:next,
    updatedByUid:ownerUid,updatedAt:at};
   const docRef=settingsRef(hub);
   if(stored.exists)tx.update(docRef,update);
   else tx.create(docRef,{...update,createdAt:at});
   // Exact sanitized catalog for partner rank Functions. This is atomically
   // version-matched with visibility, never copies unit price, sales or CB.
   const publicRef=publicCatalogRef(hub);
   const published={schema:"nico-reviewed-count-public-catalog-v1",
    hubCompanyId:hub,ownerUid,version,updatedAt:at,
    products:products.map(p=>({id:p.id,companyId:hub,name:p.name,active:p.active}))};
   if(existingPublicCatalog.exists)tx.update(publicRef,published);
   else tx.create(publicRef,{...published,createdAt:at});
   // Append-only audit, never delete a financial or count record.
   const audit=companies().doc(hub)
    .collection("rankingProductVisibilityAudit").doc();
   tx.create(audit,{hubCompanyId:hub,partnerCompanyId,
    productId,enabled,before,version,changedByUid:ownerUid,
    changedAt:at});
   return {saved:true,version,productId,enabled,partnerCompanyId};
  });
 }
 /**
  * For trusted ranking server calls ONLY, not exposed as a callable. The
  * context must come from fresh server-side owner/partner authorization.
  * The caller separately verifies the canonical SKU cross-company mapping.
  */
 /** Reuse the caller's read-only transaction; never nest a second one. */
 async function readForRankingInTransaction({tx,context,mappingsReviewed=false,requireReadTime=false}={}){
  if(!tx||typeof tx.get!=="function")stop();
  if(!context||context.serverVerified!==true||
     !id(context.viewerUid)||!id(context.viewerCompanyId)||
     !id(context.hubCompanyId)||
     (context.role==="hub_owner"&&context.viewerCompanyId!==context.hubCompanyId)||
     !["hub_owner","partner_owner"].includes(context.role)||
     !Array.isArray(context.approvedCompanyIds)||
     context.approvedCompanyIds.length<1||
     context.approvedCompanyIds.length>30||
     !ids(context.approvedCompanyIds)||
     !context.approvedCompanyIds.includes(context.hubCompanyId)||
     (context.role==="partner_owner"&&
      (!id(context.viewerCompanyId)||
       context.viewerCompanyId===context.hubCompanyId||
       !context.approvedCompanyIds.includes(context.viewerCompanyId)))||
     mappingsReviewed!==true)stop();
  const hub=context.hubCompanyId;
  const partner=context.role==="partner_owner";
   const [companySnap,stateSnap,all,viewerCompanySnap,relationSnap]=await Promise.all([
    tx.get(companies().doc(hub)),
    tx.get(settingsRef(hub)),tx.get(catalog(hub)),
    ...(partner?[
     tx.get(companies().doc(context.viewerCompanyId)),
     tx.get(db.collection("partnerRelations").doc(context.viewerCompanyId))
    ]:[])
   ]);
   const company=read(companySnap);
   if(!obj(company)||!id(company.ownerUid)||company.active===false)stop();
   // A claimed serverVerified flag is not sufficient: bind the viewer to
   // the live owner/partner documents before returning publication settings.
   if(!partner&&context.viewerUid!==company.ownerUid)stop();
   if(partner){
    const viewer=read(viewerCompanySnap),relation=read(relationSnap);
    if(!obj(viewer)||viewer.ownerUid!==context.viewerUid||
       viewer.companyKind!=="partner"||viewer.hubCompanyId!==hub||
       viewer.active!==true||!obj(relation)||
       relation.partnerCompanyId!==context.viewerCompanyId||
       relation.hubCompanyId!==hub||relation.active!==true||
       relation.countSharingApproved!==true)stop();
   }
   // Missing settings mean nothing is published. No implicit ON.
   const state=normalize(read(stateSnap),hub,company.ownerUid);
   const productRows=productsOf(all,hub);
   validateSelected(state,productRows);
   const activeProducts=new Set(productRows.filter(p=>p.active).map(p=>p.id));
   const publication={serverVerified:true,ownerSettingsRead:true,
    ownerUidVerified:true,productMappingsReviewed:true,
    revision:Math.max(1,state.version),
    hubCompanyId:hub,enabledHubProductIds:state.enabledHubProductIds.filter(
     x=>activeProducts.has(x)),
    // A revoked or no-longer-approved partner must not appear in the
    // current publication response or block rankings for remaining companies.
    // Keep its saved override untouched for audit and possible re-approval.
    partnerOverrides:Object.entries(state.partnerOverrides)
     .filter(([companyId])=>context.approvedCompanyIds.includes(companyId))
     .map(([companyId,enabledHubProductIds])=>({
      companyId,enabledHubProductIds
     }))};
   if(requireReadTime){
    const snaps=partner?[companySnap,stateSnap,all,viewerCompanySnap,relationSnap]:
     [companySnap,stateSnap,all];
    const t=snaps[0]?.readTime;
    if(!Number.isSafeInteger(t?.seconds)||
       !Number.isSafeInteger(t?.nanoseconds)||
       t.nanoseconds<0||t.nanoseconds>=1000000000||
       typeof t.toDate!=="function")stop();
    for(const snap of snaps){
     const r=snap?.readTime;
     if(r?.seconds!==t.seconds||r?.nanoseconds!==t.nanoseconds)stop();
    }
    const d=t.toDate();
    if(!(d instanceof Date)||!Number.isFinite(d.getTime()))stop();
    // Every original snapshot was compared at the full seconds+nanos level.
    // Canonical internal/partner sources use Timestamp.toDate().toISOString()
    // (millisecond precision); publish that SAME representation so their
    // shared read-only transaction passes the final equality fence.
    publication.snapshotReadTime=d.toISOString();
   }
   return publication;
 }
 async function readForRanking(args={}){
  return db.runTransaction(tx=>readForRankingInTransaction({...args,tx}),
   {readOnly:true});
 }
 return Object.freeze({readStatus,saveSwitch,readForRanking,readForRankingInTransaction});
}
