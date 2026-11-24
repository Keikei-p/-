"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {reconcileOwnerApprovedIndividualCounts:reconcile}=
 require("../functions-partner-workspace/owner-approved-individual-count-input.cjs");
const base=()=>{
 const scope={verifiedByServer:true,kind:"partner",uid:"partnerUser",
  cid:"partner",hubId:"hub",ownerUid:"hubOwner"};
 const products=[
  {id:"hikari",companyId:"hub",name:"光",active:true},
  {id:"air",companyId:"hub",name:"AIR",active:true},
  {id:"tsubasa",companyId:"hub",name:"つばさ",active:true},
  {id:"htb",companyId:"hub",name:"HTB",active:true}
 ];
 const visibility={hubCompanyId:"hub",ownerUid:"hubOwner",version:3,
  enabledHubProductIds:products.map(p=>p.id),partnerOverrides:{}};
 const publicCatalog={schema:"nico-reviewed-count-public-catalog-v1",
  hubCompanyId:"hub",ownerUid:"hubOwner",version:3,products};
 return {scope,visibility,publicCatalog,previous:{},requested:{}};
};
const expectedError=/OWNER_APPROVED_INDIVIDUAL_COUNT_UNVERIFIED/;
const reject=x=>assert.throws(()=>reconcile(x),expectedError);
test("four distinct Owner products are saved by exact ID, not old combined categories",()=>{
 const args=base(),originalHistory={
  counts:{"SB光・AIR":35,"つばさ・HTB":86},totalCount:245,
  privateCounts:{},version:13
 };
 const original=structuredClone(originalHistory);
 const result=reconcile({...args,requested:{
  hikari:2,air:3,tsubasa:4,htb:1}});
 assert.deepEqual({...result.counts},{hikari:2,air:3,tsubasa:4,htb:1});
 assert.equal(result.total,10);assert.equal(result.delta,10);
 assert.equal(result.changed,true);
 assert.deepEqual(originalHistory,original,"never mutate old combined ledger");
 assert.deepEqual(result.publishedProducts.map(x=>x.name),
  ["光","AIR","つばさ","HTB"]);
});
test("OFF AIR cannot be submitted, and other ON counts preserve its saved number",()=>{
 const args=base();
 args.previous={hikari:2,air:3,tsubasa:4,htb:1};
 args.visibility.enabledHubProductIds=["hikari","tsubasa","htb"];
 reject({...args,requested:{air:0}});
 reject({...args,requested:{air:3}});
 const approved=reconcile({...args,requested:{hikari:5}});
 assert.deepEqual({...approved.counts},
  {hikari:5,air:3,tsubasa:4,htb:1});
 assert.deepEqual({...approved.visibleCounts},
  {hikari:5,tsubasa:4,htb:1});
 assert.equal(approved.delta,3);
 args.visibility.enabledHubProductIds.push("air");
 const resumed=reconcile({...args,previous:approved.counts,requested:{air:4}});
 assert.equal(resumed.counts.air,4);
 assert.equal(resumed.counts.hikari,5);
 assert.equal(resumed.delta,1);
});
test("partner-specific OFF is enforced even when globally published",()=>{
 const args=base();
 args.visibility.partnerOverrides={partner:["hikari","htb"]};
 reject({...args,requested:{air:1}});
 const x=reconcile({...args,requested:{hikari:2}});
 assert.deepEqual({...x.visibleCounts},{hikari:2,htb:0});
});
test("an omitted new-count payload is strictly read-only and retains OFF history",()=>{
 const args=base();
 args.previous={hikari:1,air:7};
 args.visibility.enabledHubProductIds=["hikari"];
 const old=structuredClone(args.previous);
 const response=reconcile({...args,requested:undefined});
 assert.equal(response.changed,false);assert.equal(response.delta,0);
 assert.equal(response.total,8);
 assert.deepEqual({...response.counts},old);
 assert.deepEqual({...response.visibleCounts},{hikari:1});
 assert.deepEqual(args.previous,old);
});
test("same values are no-op, so callers need not create audit/version writes",()=>{
 const args=base();
 const r=reconcile({...args,previous:{hikari:2},requested:{hikari:2}});
 assert.equal(r.changed,false);assert.equal(r.delta,0);
});
test("missing Owner auth, revoked role and company spoofing are never allowed",()=>{
 const args=base();
 for(const scope of [
  {...args.scope,verifiedByServer:false},
  {...args.scope,kind:"hub"},
  {...args.scope,cid:"hub"},
  {...args.scope,ownerUid:"other"},
  {...args.scope,uid:""},
 ]){
  reject({...args,scope,requested:{hikari:2}});
 }
});
test("Owner may publish historical combined and new individual SKUs together without splitting",()=>{
 const args=base();
 args.publicCatalog.products.push({id:"legacyPartnerSku:partnerSku05",
  companyId:"hub",name:"SB光・AIR（過去合算）",active:true});
 args.visibility.enabledHubProductIds.push("legacyPartnerSku:partnerSku05");
 const proper=reconcile({...args,requested:{hikari:1}});
 assert.equal(proper.counts.hikari,1);
 assert.deepEqual(proper.publishedProducts.map(p=>p.id),
  ["hikari","air","tsubasa","htb"],
  "past combined group belongs ONLY to the historical ranking read");
 reject({...args,requested:{"legacyPartnerSku:partnerSku05":1}});
 reject({...args,requested:{"partnerPrivate:historic":1}});
 reject({...args,requested:{"SB光・AIR":35}});
});
test("unapproved product, guessed SKU ID, money field and nested payload are rejected",()=>{
 const args=base();
 for(const requested of [{notReal:1},{unitPrice:100},{hikari:{count:3}},
  {hikari:-1},{hikari:1.5},{hikari:10000},{"__proto__":1}]){
  if(requested.__proto__===Object.prototype&&
     !Object.hasOwn(requested,"__proto__"))continue;
  reject({...args,requested});
 }
 const polluted=Object.create(null);polluted.__proto__=3;
 reject({...args,requested:polluted});
});
test("a finance-bearing public label is never accepted even if the ID is published",()=>{
 const args=base();
 args.publicCatalog.products[1]={...args.publicCatalog.products[1],
  name:"AIR 売上 30000円"};
 reject({...args,requested:{air:2}});
});
test("a stale count-only catalog version or forged non-count-only payload fails",()=>{
 const args=base();
 reject({...args,publicCatalog:{...args.publicCatalog,version:2}});
 reject({...args,publicCatalog:{...args.publicCatalog,price:1}});
 reject({...args,publicCatalog:{...args.publicCatalog,products:[
  {...args.publicCatalog.products[0],unitPrice:1000},
  ...args.publicCatalog.products.slice(1)]}});
 reject({...args,visibility:{...args.visibility,
  enabledHubProductIds:["hikari","hikari"]}});
});
test("duplicate catalog IDs, foreign products and incorrect role are rejected",()=>{
 const args=base();
 reject({...args,publicCatalog:{...args.publicCatalog,
  products:[...args.publicCatalog.products,args.publicCatalog.products[0]]}});
 reject({...args,publicCatalog:{...args.publicCatalog,
  products:args.publicCatalog.products.map((p,i)=>i===0?{...p,companyId:"other"}:p)}});
 reject({...args,scope:{...args.scope,kind:"owner"}});
});
test("retired, saved count values stay immutable without leaking into the ON browser view",()=>{
 const args=base();
 args.previous={hikari:2,formerSku:6};
 args.visibility.enabledHubProductIds=["hikari"];
 const r=reconcile({...args,requested:{hikari:4}});
 assert.deepEqual({...r.counts},{hikari:4,formerSku:6});
 assert.deepEqual({...r.visibleCounts},{hikari:4});
 assert.equal(r.total,10);assert.equal(r.delta,2);
});
test("new count is bounded and zero must remain a valid reported value",()=>{
 const args=base();
 assert.equal(reconcile({...args,requested:{air:0}}).total,0);
 reject({...args,requested:{hikari:9999,air:9999,tsubasa:9999,htb:9999},
  previous:Object.fromEntries(Array.from({length:200},(_,i)=>["retired"+i,9999]))});
});
