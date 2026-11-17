import test from "node:test";
import assert from "node:assert/strict";
import {classifyRankingReadiness} from "../tools/production/classify-ranking-data-readiness.mjs";
const rel={hubCompanyId:"h1",partnerCompanyId:"p1",active:true,countSharingApproved:true};
const hub=(visibility={
  version:1,enabledHubProductIds:["sku1"]
},mapping={active:true,bindings:[{companyId:"p1",productId:"partnerSku",hubProductId:"sku1"}]},
catalog={products:[{id:"sku1"}]})=>({id:"h1",visibility,mapping,catalog});
const assess=(relations=[rel],hubs=[hub()],more={})=>
 classifyRankingReadiness({relations,hubs,...more});
test("approved exact SKU in all three documents is ready for data matching, not release",()=>{
 const a=assess();
 assert.equal(a.countRankingDataPreconditionsMet,true);
 assert.equal(a.activeApprovedRelations,1);
 assert.equal(a.hubConfigurationsWithAtLeastOneLinkedSku,1);
 assert.equal(a.realOwnerAuthenticatedSaveVerified,false);
 assert.equal(a.realPartnerFinanceGetListDeniedVerified,false);
 assert.equal(a.rankingRuntimeEnabled,false);
 assert.equal(a.productionWrites,0);
 assert.equal(JSON.stringify(a).includes("sku1"),false);
});
test("new hub without publication docs stays NOT READY",()=>{
 for(const which of ["visibility","mapping","catalog"]){
  const h=hub();h[which]=null;
  const a=assess([rel],[h]);
  assert.equal(a.countRankingDataPreconditionsMet,false);
 }
});
test("disabled partner association, disabled mapping or unpublished SKU stays NOT READY",()=>{
 assert.equal(assess([{...rel,active:false}]).countRankingDataPreconditionsMet,false);
 assert.equal(assess([rel],[hub(undefined,{active:false,bindings:[]})]).countRankingDataPreconditionsMet,false);
 assert.equal(assess([rel],[hub({version:2,enabledHubProductIds:[]})]).countRankingDataPreconditionsMet,false);
});
test("same-name implicit matching never qualifies in place of Owner-reviewed binding",()=>{
 const unbound=hub(undefined,{active:true,bindings:[]},{products:[{id:"sku1",name:"NURO"}]});
 assert.equal(assess([rel],[unbound]).countRankingDataPreconditionsMet,false);
});
test("cannot pass truncated inventory or mismatched association",()=>{
 assert.throws(()=>assess([rel],[hub()],{sourceComplete:false}),/INCOMPLETE_RELATION/);
 assert.throws(()=>assess([{...rel,hubCompanyId:"another"}]),/INVALID_RELATION_SCOPE/);
 assert.throws(()=>assess([rel,rel]),/INVALID_RELATION_SCOPE/);
});
