import test from "node:test";
import assert from "node:assert/strict";
import {createAtomicOwnerPublicationReader}
 from "../ranking/owner-product-visibility-in-atomic-tx.mjs";
import {createStagedAtomicOwnerCountLoader}
 from "../ranking/owner-visible-count-atomic-loader.mjs";

const READ="2026-11-09T00:00:00.123456789Z";
const ts={seconds:Math.floor(Date.parse("2026-11-09T00:00:00Z")/1000),
 nanoseconds:123456789,toDate(){return new Date(this.seconds*1000)}};
const hub={serverVerified:true,viewerUid:"owner",viewerCompanyId:"hub",
 hubCompanyId:"hub",role:"hub_owner",approvedCompanyIds:["hub","partner"]};
const partner={...hub,viewerUid:"partner-owner",
 viewerCompanyId:"partner",role:"partner_owner"};
function fixture({badTime=false,revoked=false}={}){
 const data=new Map([
  ["companies/hub",{ownerUid:"owner",active:true,companyKind:"internal"}],
  ["companies/partner",{ownerUid:"partner-owner",active:true,
   companyKind:"partner",hubCompanyId:"hub"}],
  ["partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",
   active:!revoked,countSharingApproved:true}],
  ["companies/hub/rankingProductVisibility/shared",{
   hubCompanyId:"hub",ownerUid:"owner",version:3,
   enabledHubProductIds:["nuro"],partnerOverrides:{partner:[]}}],
  ["products/nuro",{companyId:"hub",name:"NURO光",active:true,
   revenue:50000,unitPrice:10000,cashback:1000}],
  ["products/air",{companyId:"hub",name:"SoftBank Air",active:true,
   revenue:50000,unitPrice:10000}]
 ]);
 const ref=path=>({path,doc:id=>ref(path+"/"+id),
  collection:name=>ref(path+"/"+name),
  where(field,op,value){return {type:"query",path,field,op,value,
   limit(max){return {...this,max}}}}});
 const snap=(path,value)=>({id:path.split("/").at(-1),
  exists:value!==undefined,readTime:ts,data(){return value}});
 const tx={async get(q){
  if(q.type==="query"){
   const docs=[...data.entries()].filter(([p,v])=>
    p.startsWith(q.path+"/")&&
    p.split("/").length===q.path.split("/").length+1&&
    v[q.field]===q.value).map(([p,v])=>snap(p,v));
   return {docs,readTime:badTime?{...ts,nanoseconds:1}:ts};
  }
  return snap(q.path,data.get(q.path));
 }};
 let transactions=0;
 const db={collection:ref,async runTransaction(fn,options){
  transactions++;assert.deepEqual(options,{readOnly:true});
  return fn(tx);
 }};
 const FieldValue={serverTimestamp(){throw Error("UNEXPECTED_WRITE")}};
 return {tx,db,FieldValue,data,get transactions(){return transactions}};
}
test("real owner Firestore settings are read inside caller transaction without nesting",async()=>{
 const f=fixture(),read=createAtomicOwnerPublicationReader(f);
 const result=await read({tx:f.tx,context:hub});
 assert.deepEqual(result.enabledHubProductIds,["nuro"]);
 assert.deepEqual(result.partnerOverrides,[{companyId:"partner",enabledHubProductIds:[]}]);
 assert.equal(result.snapshotReadTime,READ);
 assert.equal(result.revision,3);
 assert.equal(f.transactions,0);
 assert(!/revenue|unitPrice|cashback|50000|10000/.test(JSON.stringify(result)));
});
test("partner owner is checked against live relation, not browser role",async()=>{
 const f=fixture(),read=createAtomicOwnerPublicationReader(f);
 assert.equal((await read({tx:f.tx,context:partner})).snapshotReadTime,READ);
 await assert.rejects(read({tx:f.tx,context:{...partner,viewerUid:"fake"}}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
 const revoked=fixture({revoked:true});
 await assert.rejects(createAtomicOwnerPublicationReader(revoked)({
  tx:revoked.tx,context:partner}),/UNAUTHORIZED_OR_INCOMPLETE/);
});
test("missing or mismatched Firestore readTime fails closed",async()=>{
 const f=fixture({badTime:true});
 await assert.rejects(createAtomicOwnerPublicationReader(f)({
  tx:f.tx,context:hub}),/UNAUTHORIZED_OR_INCOMPLETE/);
 const good=fixture(),read=createAtomicOwnerPublicationReader(good);
 await assert.rejects(read({context:hub}),/UNAUTHORIZED_OR_INCOMPLETE/);
});
test("atomic count loader consumes genuine owner settings from same transaction",async()=>{
 const f=fixture(),read=createAtomicOwnerPublicationReader(f);
 const loader=createStagedAtomicOwnerCountLoader({
  db:f.db,
  loadCountsInTransaction:async({tx,month,context})=>{
   await tx.get(f.db.collection("companies").doc("hub"));
   return {hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
    period:{kind:"month",day:month+"-01",asOf:"2026-11-09"},
    mappingsReviewed:true,productGroups:[],snapshotReadTime:READ,
    sources:context.approvedCompanyIds.map(companyId=>({companyId,readTime:READ}))};
  },
  loadPublicationInTransaction:read
 });
 const result=await loader({month:"2026-11",context:hub});
 assert.equal(result.publication.snapshotReadTime,READ);
 assert.deepEqual(result.publication.enabledHubProductIds,["nuro"]);
 assert.equal(f.transactions,1,"no nested Firestore transaction");
});
