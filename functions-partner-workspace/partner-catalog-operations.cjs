"use strict";
// New publication settings ONLY. Sales products, pricing and saved count
// documents are never updated. This is not a legacy data migration.
const {
 validId,nameOnly,loadPublication,projectMasterProducts,
 projectOwnerPublicationRows,changePublication
}=require("./catalog-publication.cjs");
function makePartnerCatalogOperations({db,actor,scope,collection,FieldValue,fail}={}){
 if(!db||typeof actor!=="function"||typeof scope!=="function"||
    typeof collection!=="function"||!FieldValue||typeof fail!=="function")
  throw Error("PARTNER_CATALOG_DEPENDENCY_INVALID");
 const publicationRef=hub=>collection(hub,"partnerCatalogSettings").doc("publication");
 async function productMaster(hub){
  const snap=await db.collection("products").where("companyId","==",hub)
   .limit(1001).get();
  if(snap.size>1000)fail("resource-exhausted");
  if(snap.docs.some(x=>x.data()?.companyId!==hub))fail("data-loss");
  return snap.docs.map(x=>({...x.data(),id:x.id}));
 }
 async function getPublishedCatalog(request){
  const d=request?.data||{};
  if(Object.keys(d).some(k=>!["workspaceCompanyId","codeSessionToken"].includes(k)))
   fail("invalid-argument");
  const a=await actor(request),s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="hub"&&s.kind!=="partner")fail();
  const hub=s.kind==="hub"?s.cid:s.hubId;
  if(!validId(hub))fail();
  const [master,sn]=await Promise.all([productMaster(hub),publicationRef(hub).get()]);
  let state,products;
  try{
   state=loadPublication(sn.exists?sn.data():null);
   products=s.kind==="hub"?
    projectOwnerPublicationRows(master,state.productIds):
    projectMasterProducts(master,state.productIds,true)
     .map(({id,name,sortOrder})=>({id,name,sortOrder}));
  }catch{fail("data-loss");}
  return {scope:"partner_published_catalog_count_only",
   role:s.kind,revision:state.revision,products};
 }
 async function setPublishedProduct(request){
  const d=request?.data||{};
  if(Object.keys(d).sort().join("|")!=="expectedRevision|productId|published"||
     !validId(d.productId)||typeof d.published!=="boolean"||
     !Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0)
   fail("invalid-argument");
  const a=await actor(request),s=await scope(a.uid);
  if(s.kind!=="hub"||s.role!=="owner")fail();
  const source=db.collection("products").doc(d.productId),
   stateRef=publicationRef(s.cid);
  return db.runTransaction(async tx=>{
   const live=await scope(a.uid,tx);
   if(live.kind!=="hub"||live.cid!==s.cid||live.role!=="owner")fail();
   const [productSn,configSn]=await Promise.all([tx.get(source),tx.get(stateRef)]);
   const item=productSn.data()||{};
   if(!productSn.exists||item.companyId!==s.cid||
      (d.published&&item.active===false))fail("failed-precondition");
   if(d.published){
    try{nameOnly(item.name);}catch{fail("failed-precondition");}
   }
   let next;
   try{
    next=changePublication(configSn.exists?configSn.data():null,
     d.productId,d.published,d.expectedRevision);
   }catch{fail("aborted");}
   // NEVER write the original product or any partner work ledger.
   tx.set(stateRef,{...next,updatedByUid:a.uid,
    updatedAt:FieldValue.serverTimestamp()});
   return {saved:true,revision:next.revision,productId:d.productId,
    published:d.published};
  });
 }
 return Object.freeze({getPublishedCatalog,setPublishedProduct});
}
module.exports={makePartnerCatalogOperations};
