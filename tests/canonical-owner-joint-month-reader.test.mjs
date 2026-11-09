import test from "node:test";
import assert from "node:assert/strict";
import {combineVerifiedOwnerMonth,createCanonicalOwnerJointMonthReader}
 from "../ranking/canonical-owner-joint-month-reader.mjs";
import {buildOwnerVisibleCountRanking}
 from "../ranking/owner-product-visibility-rankings.mjs";
import {buildVerifiedCountDashboard}
 from "../ranking/verified-dual-count-dashboards.mjs";
const TIME="2026-11-09T00:00:00.000Z",HUB="hub",PARTNER="partner";
const context={serverVerified:true,viewerUid:"owner",
 viewerCompanyId:HUB,hubCompanyId:HUB,
 role:"hub_owner",approvedCompanyIds:[HUB,PARTNER],
 userActive:true,memberActive:true,companyActive:true,
 reciprocalOwnersApproved:true,completeSnapshotBudgetApproved:true,
 individualNamesApproved:true};
const products=(cid,ids)=>ids.map((sourceId,i)=>({
 companyId:cid,sourceId,name:sourceId==="nuro"?"NURO光":
  sourceId==="air"?"SoftBank Air":
  sourceId==="partnerSku01"?"NURO":"SB光・AIR（旧合算・未分類）",
 active:true,sortOrder:i
}));
function source(cid,kind,rows,counts){
 const id="r-"+cid,uid="uid-"+cid,teamId="team-"+cid;
 return {companyId:cid,companyLabel:cid==="hub"?"本社":"協力店",
  kind,consentVerified:true,isComplete:true,readTime:TIME,
  completeWindows:{current:true,previous:false},
  teams:[{id:teamId,name:"広島班",goalCount:null}],
  roster:[{uid,teamId,name:"営業担当"}],
  products:products(cid,rows),records:[{
   companyId:cid,sourceId:id,uid,teamId,date:"2026-11-09",
   totalCount:counts.reduce((a,b)=>a+b,0),reportStatus:"submitted",
   memberNameSnapshot:"営業担当",teamNameSnapshot:"広島班",workLocation:""
  }],lines:rows.map((sku,i)=>({
   companyId:cid,recordId:id,sourceId:id+"__"+i,
   uid,teamId,date:"2026-11-09",productId:sku,count:counts[i]
  }))};
}
function fixture(){
 const owner=source(HUB,"own",["nuro","air"],[2,1]);
 const partner=source(PARTNER,"partner",["partnerSku01","partnerSku05"],[5,3]);
 delete partner.completeWindows;delete partner.roster;
 return {month:"2026-11",asOf:"2026-11-09",context,
  hubSource:owner,partnerSources:[partner],
  mappingDocuments:[{hubCompanyId:HUB,partnerCompanyId:PARTNER,
   active:true,ownerReviewed:true,reviewedByUid:"owner",version:1,
   links:[{partnerProductId:"partnerSku01",hubProductId:"nuro"}]}]};
}
const pub=ids=>({serverVerified:true,ownerSettingsRead:true,
 ownerUidVerified:true,productMappingsReviewed:true,
 hubCompanyId:HUB,revision:2,enabledHubProductIds:ids});
test("one approved mapping links exactly ON NURO into individual/company/SKU rankings",()=>{
 const f=fixture(),saved=structuredClone(f);
 const result=combineVerifiedOwnerMonth(f);
 assert.equal(result.sources.length,2);
 assert.deepEqual(result.productGroups.map(x=>x.productId),
  ["nuro","air","partnerSku01"]);
 const summary=buildOwnerVisibleCountRanking({input:result,publication:pub(["nuro"])});
 assert.deepEqual(summary.summary,{own:2,partner:5,total:7,unidentified:0});
 assert.equal(summary.memberRanking.find(x=>x.companyId==="partner").count,5);
 assert.equal(summary.productRanking.length,1);
 assert.equal(summary.productRanking[0].name,"NURO光");
 assert.equal(summary.productRanking[0].count,7);
 assert(!JSON.stringify(summary).includes("SB光・AIR"));
 assert.deepEqual(f,saved,"raw data is never rewritten");
});
test("OFF, re-ON, Air ON: historical mixed 3 counts never secretly become Air or hikari",()=>{
 const f=fixture(),input=combineVerifiedOwnerMonth(f);
 const off=buildOwnerVisibleCountRanking({input,publication:pub([])});
 assert.equal(off.summary.total,0);
 const air=buildOwnerVisibleCountRanking({input,publication:pub(["air"])});
 assert.deepEqual(air.summary,{own:1,partner:0,total:1,unidentified:0});
 assert.equal(air.productRanking[0].name,"SoftBank Air");
 const on=buildOwnerVisibleCountRanking({input,publication:pub(["nuro","air"])});
 assert.deepEqual(on.summary,{own:3,partner:5,total:8,unidentified:0});
 assert.equal(f.partnerSources[0].records[0].totalCount,8);
 assert.equal(f.partnerSources[0].lines[1].count,3);
});
test("legacy partnerSku05 mapping to independent Air/hikari always rejected",()=>{
 const f=fixture();
 f.mappingDocuments[0].links.push({
  partnerProductId:"partnerSku05",hubProductId:"air"
 });
 assert.throws(()=>combineVerifiedOwnerMonth(f),
  /CANONICAL_OWNER_JOINT_MONTH_UNVERIFIED/);
});
test("unmapped known positive SKU cannot silently hide an active company's counts",()=>{
 const f=fixture();
 f.partnerSources[0].products.push({
  companyId:"partner",sourceId:"partnerSku02",name:"SBMNP",active:true,sortOrder:2
 });
 f.partnerSources[0].lines.push({companyId:"partner",
  recordId:"r-partner",sourceId:"extra",uid:"uid-partner",
  teamId:"team-partner",date:"2026-11-09",productId:"partnerSku02",count:1});
 f.partnerSources[0].records[0].totalCount+=1;
 assert.throws(()=>combineVerifiedOwnerMonth(f),
  /CANONICAL_OWNER_JOINT_MONTH_UNVERIFIED/);
});
test("unreviewed/foreign/duplicate mappings and mismatched read times fail closed",()=>{
 for(const change of [
  f=>f.mappingDocuments[0].ownerReviewed=false,
  f=>f.mappingDocuments[0].partnerCompanyId="foreign",
  f=>f.mappingDocuments[0].links.push({
   partnerProductId:"partnerSku01",hubProductId:"nuro"
  }),
  f=>f.mappingDocuments[0].links[0].hubProductId="unknown",
  f=>f.partnerSources[0].readTime="2026-11-09T01:00:00.000Z",
  f=>f.context={...f.context,approvedCompanyIds:["hub","other"]}
 ]){
  const f=fixture();change(f);
  assert.throws(()=>combineVerifiedOwnerMonth(f),
   /CANONICAL_OWNER_JOINT_MONTH_UNVERIFIED/);
 }
});
test("joined source validates all original count headers before visibility filtering",()=>{
 const f=fixture(),input=combineVerifiedOwnerMonth(f);
 // Verified engine accepts the raw 11 total as historical source; it is
 // visibility gate, not a destructive deletion, that omits legacy counts.
 assert.equal(buildVerifiedCountDashboard(input).summary.total,11);
 f.partnerSources[0].records[0].totalCount=999;
 const broken=combineVerifiedOwnerMonth(f);
 assert.throws(()=>buildOwnerVisibleCountRanking({input:broken,
  publication:pub(["nuro"])}));
});
test("transaction reader binds current owner UID, one readTime and exact mapping docs",async()=>{
 const f=fixture(),reads=[];
 const timestamp={seconds:1794182400,nanoseconds:0,
  toDate:()=>new Date("2026-11-09T00:00:00.000Z")};
 const doc=value=>({exists:true,data:()=>value,readTime:timestamp});
 const ref=p=>({
  path:p,collection(name){return ref(p+"/"+name)},
  doc(name){return ref(p+"/"+name)}
 });
 const db={collection:ref};
 const tx={async get(r){
  reads.push(r.path);
  if(r.path==="companies/hub")
   return doc({ownerUid:"owner",companyKind:"internal",active:true});
  if(r.path==="companies/hub/rankingSkuMappings/partner")
   return doc(f.mappingDocuments[0]);
  throw Error("UNEXPECTED_FIRESTORE_READ "+r.path);
 }};
 const reader=createCanonicalOwnerJointMonthReader({
  db,clock:()=>"2026-11-09",
  internalReader:async()=>f.hubSource,
  partnerReader:async()=>f.partnerSources[0]
 });
 const result=await reader({tx,month:"2026-11",context});
 assert.equal(result.sources.length,2);
 assert.deepEqual(reads,[
  "companies/hub","companies/hub/rankingSkuMappings/partner"
 ]);
 const invalid=createCanonicalOwnerJointMonthReader({
  db,clock:()=>"2026-10-02",
  internalReader:async()=>{throw Error("SHOULD_NOT_CALL")},
  partnerReader:async()=>{throw Error("SHOULD_NOT_CALL")}
 });
 await assert.rejects(invalid({tx,month:"2026-11",context}),
  /CANONICAL_OWNER_JOINT_MONTH_UNVERIFIED/);
});
