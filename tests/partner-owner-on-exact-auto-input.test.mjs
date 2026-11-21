/**
 * Partner ON -> same-app input without creating a second manual SKU setup.
 * Distinct financial masters, user accounts and saved count documents are
 * never opened or modified. Tests exercise exact aliases only, no fuzzy map.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {allowedPartnerCategories as esmAllowed}
 from "../ranking/approved-published-categories.mjs";
import {createPartnerSubmissionPublicationGuard as esmGuard}
 from "../ranking/partner-submission-publication-guard.mjs";
const require=createRequire(import.meta.url);
const {allowedPartnerCategories:cjsAllowed,KEYS}=
 require("../functions-partner-workspace/approved-published-categories.cjs");
const {createPartnerSubmissionPublicationGuard:cjsGuard}=
 require("../functions-partner-workspace/submission-publication-guard.cjs");
const zero=()=>Object.fromEntries(KEYS.map(x=>[x,0]));
const product=(id,name,active=true)=>({id,companyId:"hub",name,active});
const standard=[
 product("nuro","NURO光"),
 product("sbmnp","SBMNP"),
 product("combined","SB光・AIR（旧合算・未分類）"),
 product("air","SoftBank Air")
];
const mapping=(bindings=[])=>({
 hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
 active:true,version:1,bindings
});
const bound=(sku,id)=>({companyId:"partner",productId:sku,hubProductId:id});
function fixture({
 products=standard,enabledHubProductIds=["nuro","sbmnp","combined","air"],
 bindings=[],partnerOverrides={},mappingData,company="partner"
}={}){
 const visibility={hubCompanyId:"hub",ownerUid:"owner",version:2,
  enabledHubProductIds,partnerOverrides};
 const m=mappingData??mapping(bindings);
 const params={hubId:"hub",cid:company,ownerUid:"owner",visibility,
  mapping:m,products};
 const rows={
  "companies/hub":{ownerUid:"owner",active:true,companyKind:"internal"},
  ["companies/"+company]:{active:true,companyKind:"partner",hubCompanyId:"hub"},
  ["partnerRelations/"+company]:{active:true,countSharingApproved:true,
   hubCompanyId:"hub",partnerCompanyId:company},
  "companies/hub/rankingProductVisibility/shared":visibility,
  "companies/hub/rankingSkuMappings/shared":m,
  "companies/hub/rankingCountPublicCatalog/shared":{
   schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:"hub",
   ownerUid:"owner",version:2,products
  }
 };
 const reads=[],writes=[];
 const db={collection:name=>({doc:id=>ref(name+"/"+id)})};
 function ref(path){
  return {path,collection:name=>({doc:id=>ref(path+"/"+name+"/"+id)})};
 }
 const tx={get:async ref=>{
  reads.push(ref.path);
  const d=rows[ref.path];return {exists:d!==undefined,data:()=>d};
 },create:()=>writes.push("create"),update:()=>writes.push("update"),
 delete:()=>writes.push("delete")};
 const scope={verifiedByServer:true,kind:"partner",
  uid:"partnerWorker",cid:company,hubId:"hub"};
 return {params,reads,writes,scope,tx,db,allowed:()=>cjsAllowed(params)};
}
test("Owner ON labels automatically enable existing exact partner categories without a new mapping write",async()=>{
 const x=fixture(),expected=["NURO","SBMNP","SB光・AIR"];
 assert.deepEqual(x.allowed(),expected);
 assert.deepEqual(esmAllowed(x.params),expected);
 for(const guard of [cjsGuard,esmGuard]){
  const r=await guard({db:x.db})({tx:x.tx,scope:x.scope,
   previousCounts:zero(),nextCounts:{...zero(),NURO:3,SBMNP:2,"SB光・AIR":4}});
  assert.deepEqual([...r.enabledCategories],expected);
 }
 assert(!x.reads.some(p=>p.startsWith("products/")||p.startsWith("records/")));
 assert.deepEqual(x.writes,[]);
});
test("duplicate active hub labels are ambiguous, so the category stays OFF",async()=>{
 const x=fixture({products:[...standard,product("duplicate","ＮＵＲＯ光")]});
 const allowed=x.allowed();
 assert(!allowed.includes("NURO"));
 assert(allowed.includes("SBMNP"));
 for(const guard of [cjsGuard,esmGuard])
  await assert.rejects(guard({db:x.db})({
   tx:x.tx,scope:x.scope,previousCounts:zero(),
   nextCounts:{...zero(),NURO:1}
  }),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
 assert.deepEqual(x.writes,[]);
});
test("reviewed Owner ID takes precedence; alias cannot steal another category's hub SKU",async()=>{
 const x=fixture({bindings:[bound("partnerSku02","nuro")]});
 assert.deepEqual(x.allowed(),["SBMNP","SB光・AIR"]);
 assert.deepEqual(esmAllowed(x.params),x.allowed());
 for(const guard of [cjsGuard,esmGuard]){
  await assert.rejects(guard({db:x.db})({
   tx:x.tx,scope:x.scope,previousCounts:zero(),nextCounts:{...zero(),NURO:1}
  }),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
  const result=await guard({db:x.db})({
   tx:x.tx,scope:x.scope,previousCounts:zero(),nextCounts:{...zero(),SBMNP:1}
  });
  assert(result.enabledCategories.includes("SBMNP"));
 }
});
test("Owner global OFF and company override OFF beat any name match",async()=>{
 const onlyNuro=fixture({enabledHubProductIds:["nuro"]});
 assert.deepEqual(onlyNuro.allowed(),["NURO"]);
 const partnerOff=fixture({partnerOverrides:{partner:[]}});
 assert.deepEqual(partnerOff.allowed(),[]);
 for(const x of [onlyNuro,partnerOff]){
  for(const guard of [cjsGuard,esmGuard])
   await assert.rejects(guard({db:x.db})({
    tx:x.tx,scope:x.scope,previousCounts:zero(),
    nextCounts:{...zero(),SBMNP:1}
   }),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
 }
});
test("legacy light/AIR cannot be split or guessed into a separately priced product",async()=>{
 const x=fixture({products:[product("light","SB光"),
  product("air","SoftBank Air")],enabledHubProductIds:["light","air"]});
 assert(!x.allowed().includes("SB光・AIR"));
 assert(!esmAllowed(x.params).includes("SB光・AIR"));
 for(const guard of [cjsGuard,esmGuard])
  await assert.rejects(guard({db:x.db})({
   tx:x.tx,scope:x.scope,previousCounts:zero(),
   nextCounts:{...zero(),"SB光・AIR":1}
  }),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
});
test("inactive/amount-coded alias never unlocks a count input",()=>{
 const x=fixture({products:[product("nuro","NURO光",false),
  product("amount","SBMNP 単価50000円")],
  enabledHubProductIds:["nuro","amount"]});
 assert.deepEqual(x.allowed(),[]);
 assert.deepEqual(esmAllowed(x.params),[]);
});
test("forged Owner mapping, missing required review, and missing document still fail closed",async()=>{
 for(const m of [{...mapping(),reviewedByUid:"stranger"},
                 {...mapping(),active:false},null]){
  const x=fixture({mappingData:m??undefined});
  if(m===null)x.tx.get=async ref=>({exists:ref.path!=="companies/hub/rankingSkuMappings/shared",
   data:()=>ref.path==="companies/hub/rankingSkuMappings/shared"?undefined:
    ref.path==="companies/hub"?{ownerUid:"owner",active:true}:undefined});
  if(m!==null){
   assert.throws(x.allowed,/PARTNER_PUBLICATION_UNVERIFIED/);
   assert.throws(()=>esmAllowed(x.params),/PARTNER_PUBLICATION_UNVERIFIED/);
  }
  for(const guard of [cjsGuard,esmGuard])
   await assert.rejects(guard({db:x.db})({
    tx:x.tx,scope:x.scope,previousCounts:zero(),
    nextCounts:{...zero(),NURO:1}
   }),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
 }
});
test("OFF historical counts remain unchanged when a newly linked ON SKU is corrected",async()=>{
 const x=fixture(),before={...zero(),YMMNP:7};
 for(const guard of [cjsGuard,esmGuard]){
  const allowed=await guard({db:x.db})({
   tx:x.tx,scope:x.scope,previousCounts:before,
   nextCounts:{...before,SBMNP:2}
  });
  assert(allowed.enabledCategories.includes("SBMNP"));
  await assert.rejects(guard({db:x.db})({
   tx:x.tx,scope:x.scope,previousCounts:before,
   nextCounts:{...before,YMMNP:0,SBMNP:2}
  }),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
 }
 assert.deepEqual(x.writes,[]);
});
