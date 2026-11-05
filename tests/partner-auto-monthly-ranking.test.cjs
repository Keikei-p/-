"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {projectPartnerMonth}=require("../functions-partner-workspace/monthly-shared-projection.cjs");
const {projectMasterProducts}=require("../functions-partner-workspace/catalog-publication.cjs");
const {addAutomaticPublishedGroups}=require("../functions-partner-workspace/automatic-published-groups.cjs");
const {groupPersonalScores}=require("../functions-partner-workspace/shared-ranking-groups.cjs");
const {readDirectRangeCounts}=require("../functions-partner-workspace/shared-direct-counts.cjs");
const keys=["NURO","SBMNP"];
const docs=[
 ["2026-11-01","staffA","協力店A",{newFiber:4,archived:9}],
 ["2026-11-02","staffB","協力店B",{newFiber:5}],
 ["2026-11-03","staffA","協力店A",{newFiber:2}]
].map(([date,staffId,staffNameSnapshot,counts])=>({
 id:date+"__"+staffId,data:()=>({
  companyId:"partner",hubCompanyId:"hub",date,staffId,staffNameSnapshot,
  teamIdSnapshot:"teamA",version:1,counts,
  totalCount:Object.values(counts).reduce((n,v)=>n+v,0)
 })
}));
const master=[{id:"newFiber",name:"新商材A",active:true,sortOrder:1,
 unitPrice:300000,pricingOptions:[{revenuePerUnit:555555}]}];
const project=ids=>projectPartnerMonth({
 hubId:"hub",cid:"partner",companyName:"協力店",
 from:"2026-11-01",to:"2026-11-03",legacyDocs:[],extraDocs:docs,
 keys,publishedIds:ids,linkedIds:[]
});
test("new Owner-published product month has one person per saved staff ID, correct 3-day sum and no finance",async()=>{
 const published=projectMasterProducts(master,["newFiber"],true);
 assert.deepEqual(published.map(x=>x.id),["newFiber"]);
 const original=JSON.stringify(docs.map(x=>x.data()));
 const month=project(["newFiber"]);
 assert.equal(month.totalCount,20);
 assert.equal(month.additionalTotalCount,11);
 assert.equal(month.archivedExtraTotalCount,9);
 assert.equal(month.people.length,2);
 assert.deepEqual(month.people.map(x=>x.totalCount).sort((a,b)=>b-a),[15,5]);
 const auto=addAutomaticPublishedGroups([],published,[]);
 assert.equal(auto.length,1);
 assert.deepEqual(auto[0].keys,["id:newFiber"]);
 const record={companyId:"hub",date:"2026-11-01",uid:"directEmployee",
  teamId:"directTeam",memberNameSnapshot:"直営担当",totalCount:3,
  results:[{productId:"newFiber",productNameSnapshot:"新商材A",count:3}],
  totalRevenue:777777,unitPrice:222222};
 const directDb={collection(name){
  const rows=name==="records"?[{data:()=>record}]:
   [{id:"newFiber",data:()=>({...master[0],companyId:"hub"})}];
  return {where(){return this;},limit(){return this;},
   async get(){return {size:rows.length,docs:rows};}};
 }};
 const direct=await readDirectRangeCounts(directDb,"hub","2026-11-01","2026-11-03",keys,{
  approvedExtraProductIds:["newFiber"],maxRecords:10000
 });
 assert.equal(direct.peopleVerified,true);
 assert.equal(direct.totalCount,3);
 const ranked=groupPersonalScores(auto,[...month.people,...direct.people.map(p=>({...p,companyName:"直営"}))],{
  categories:keys,extraVerifiedIds:["newFiber"]
 });
 assert.deepEqual(ranked[0].members.map(x=>[x.count,x.rank]),[[6,1],[5,2],[3,3]]);
 assert.doesNotMatch(JSON.stringify(ranked),/777777|222222|300000|555555|unitPrice|revenue|pricingOptions|"archived":/);
 // Turning OFF excludes the product from all NEW monthly shared counts but
 // preserves immutable old extra records; publishing again restores exact totals.
 const afterOff=project([]);
 assert.equal(afterOff.totalCount,20,"OFF retains saved historic headline");
 assert.equal(afterOff.archivedExtraTotalCount,20);
 assert.equal(afterOff.additionalTotalCount,0);
 assert.deepEqual(addAutomaticPublishedGroups([],projectMasterProducts(master,[],true),[]),[]);
 assert.equal(JSON.stringify(docs.map(x=>x.data())),original);
 const restored=project(["newFiber"]);
 assert.deepEqual(restored,month);
 assert.equal(restored.additionalTotalCount,11);
});
