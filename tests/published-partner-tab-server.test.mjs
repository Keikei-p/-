import test from "node:test";
import assert from "node:assert/strict";
import {createPartnerPublishedTabPolicyReader,projectPublishedPartnerCountTab}
 from "../ranking/published-partner-tab-server.mjs";
import fs from "node:fs";
const TIME="2026-11-18T09:00:00.000Z";
const stamp={seconds:Date.parse(TIME)/1000,nanoseconds:0,
 toDate(){return new Date(TIME)}};
const ctx=()=>({serverVerified:true,role:"partner_owner",viewerUid:"pOwner",
 viewerCompanyId:"pCompany",hubCompanyId:"hubCompany",
 activeCountSharingVerified:true});
const policy=(tabs)=>({schema:"nico-partner-tabs-v1",version:4,
 hubCompanyId:"hubCompany",ownerUid:"hubOwner",published:true,tabs});
function dbFixture(raw=policy(["individual","detail"])){
 const paths=[];
 const docs=new Map([["companies/hubCompany",
   {active:true,ownerUid:"hubOwner",companyKind:"internal"}]]);
 if(raw!==null)docs.set("companies/hubCompany/partnerTabPublication/shared",raw);
 const ref=path=>({path,collection(name){return {doc(id){
   return ref(path+"/"+name+"/"+id);
  }};}});
 const db={collection(name){return {doc(id){return ref(name+"/"+id);}}}};
 const tx={async get(ref){
  paths.push(ref.path);
  if(!ref.path.startsWith("companies/hubCompany"))throw Error("UNSAFE_READ");
  const value=docs.get(ref.path);
  return {exists:value!==undefined,readTime:stamp,data:()=>structuredClone(value)};
 },set(){throw Error("NO_WRITES");},update(){throw Error("NO_WRITES");},
  create(){throw Error("NO_WRITES");},delete(){throw Error("NO_WRITES");}};
 return {db,tx,paths,docs};
}
const source=()=>({schema:"nico-verified-dual-count-v1",
 role:"partner_owner",unit:"件",period:"month",
 range:{start:"2026-11-01",end:"2026-11-18"},
 readTime:TIME,
 own:{company:"協力店A",count:3,unidentifiedCount:0,people:[],products:[],
  teamDetails:[{name:"1班",count:3,reportStatus:"報告済",
   members:[{name:"担当A",count:3,reportStatus:"報告済"}],
   products:[{name:"NURO",count:3}]}]},
 publicRanking:{
  members:[{rank:1,name:"担当A",company:"協力店A",count:3}],
  products:[{rank:1,name:"NURO",count:3}],
  companies:[{rank:1,name:"協力店A",count:3}],
  teams:[{rank:1,name:"1班",company:"協力店A",count:3,own:true}]
 }
});
const expectDeny=fn=>assert.rejects(async()=>fn(),/PARTNER_PUBLISHED_TAB_ACCESS_DENIED/);
test("Owner shared publication read uses only hub & exact config in same provided transaction",async()=>{
 const f=dbFixture();
 const p=await createPartnerPublishedTabPolicyReader({db:f.db})({tx:f.tx,context:ctx()});
 assert.deepEqual(f.paths,[
  "companies/hubCompany","companies/hubCompany/partnerTabPublication/shared"
 ]);
 assert.equal(p.serverVerified,true);
 assert.equal(p.ownerUidVerified,true);
 assert.equal(p.snapshotReadTime,TIME);
 assert.deepEqual(p.tabs,["individual","detail"]);
 assert.equal(Object.hasOwn(p,"ownerUid"),false);
});
test("no settings means no optional tabs; foreign Owner and revoked context deny",async()=>{
 const f=dbFixture(null);
 const reader=createPartnerPublishedTabPolicyReader({db:f.db});
 const p=await reader({tx:f.tx,context:ctx()});
 assert.equal(p.published,false);
 assert.deepEqual(p.tabs,[]);
 await expectDeny(()=>projectPublishedPartnerCountTab({
  verifiedContext:ctx(),policy:p,requestedTab:"individual",response:source()
 }));
 const forged=dbFixture({...policy(["team"]),ownerUid:"foreign"});
 await expectDeny(()=>createPartnerPublishedTabPolicyReader({db:forged.db})({
  tx:forged.tx,context:ctx()
 }));
 for(const invalid of [{role:"hub_owner"},{viewerCompanyId:"hubCompany"},
  {activeCountSharingVerified:false},{viewerUid:"foreign/company"}]){
  await expectDeny(()=>reader({tx:f.tx,context:{...ctx(),...invalid}}));
 }
});
test("individual published tab returns exactly one ranked list, not other company team rosters",async()=>{
 const f=dbFixture();
 const p=await createPartnerPublishedTabPolicyReader({db:f.db})({tx:f.tx,context:ctx()});
 const original=source(),snapshot=structuredClone(original);
 const r=projectPublishedPartnerCountTab({
  verifiedContext:ctx(),policy:p,requestedTab:"individual",response:original
 });
 assert.equal(r.schema,"nico-published-partner-count-tab-v1");
 assert.equal(r.tab,"individual");assert.equal(r.rows[0].count,3);
 assert.deepEqual(Object.keys(r).sort(),["period","range","readTime","role","rows",
   "schema","tab","unit"].sort());
 assert.equal(JSON.stringify(r).includes("teamDetails"),false);
 assert.equal(JSON.stringify(r).includes("NURO"),false);
 assert.equal(JSON.stringify(r).includes("unitPrice"),false);
 assert.deepEqual(original,snapshot);
});
test("not published tab must be refused even when counts were already calculated",async()=>{
 const f=dbFixture(policy(["individual"]));
 const p=await createPartnerPublishedTabPolicyReader({db:f.db})({tx:f.tx,context:ctx()});
 for(const tab of ["team","product","detail","report","daily","history","goal",
  "revenue","__proto__",""]){
  await expectDeny(()=>projectPublishedPartnerCountTab({
   verifiedContext:ctx(),policy:p,requestedTab:tab,response:source()
  }));
 }
});
test("detail published returns own company drilldown only, not global person/product ranking",async()=>{
 const f=dbFixture(policy(["detail"]));
 const p=await createPartnerPublishedTabPolicyReader({db:f.db})({tx:f.tx,context:ctx()});
 const r=projectPublishedPartnerCountTab({
  verifiedContext:ctx(),policy:p,requestedTab:"detail",response:source()
 });
 assert.equal(r.rows[0].members[0].count,3);
 assert.equal(JSON.stringify(r).includes("publicRanking"),false);
 assert.equal(JSON.stringify(r).includes("会社別"),false);
});
test("partner tab policy fails closed on corrupt SKU names, finance fields, foreign company context",async()=>{
 const f=dbFixture(policy(["product"]));
 const p=await createPartnerPublishedTabPolicyReader({db:f.db})({tx:f.tx,context:ctx()});
 for(const change of [
  input=>{input.publicRanking.products[0].unitPrice=10000;},
  input=>{input.publicRanking.products[0].name="NURO 売上50000円";},
  input=>{input.readTime="2026-11-17T09:00:00.000Z";},
  input=>{input.role="hub_owner";},
  input=>{input.own.count=-1;}
 ]){
  const input=source();change(input);
  await expectDeny(()=>projectPublishedPartnerCountTab({
   verifiedContext:ctx(),policy:p,requestedTab:"product",response:input
  }));
 }
 await expectDeny(()=>projectPublishedPartnerCountTab({
  verifiedContext:{...ctx(),viewerCompanyId:"foreign"},
  policy:p,requestedTab:"product",response:source()
 }));
});
test("vendored Functions module matches trusted source byte-for-byte, no writes",()=>{
 const base=fs.readFileSync(new URL("../ranking/published-partner-tab-server.mjs",import.meta.url),"utf8");
 const vendor=fs.readFileSync(new URL("../functions-ranking-approvals/ranking/published-partner-tab-server.mjs",import.meta.url),"utf8");
 assert.equal(base,vendor);
 assert(!/\b(?:tx|db)\.(?:set|create|update|delete)\s*\(/.test(base));
 assert(!/\b(?:setDoc|updateDoc|deleteDoc|writeBatch)\s*\(/.test(base));
});

test("all four staged count authorization modules stay byte-identical to canonical counterparts",()=>{
 for(const name of [
  "published-partner-tab-server.mjs",
  "owner-visible-count-atomic-loader.mjs",
  "canonical-owner-count-server-factory.mjs",
  "owner-visible-count-server-handler.mjs"
 ]){
  const canonical=fs.readFileSync(new URL("../ranking/"+name,import.meta.url),"utf8");
  const vendored=fs.readFileSync(new URL(
   "../functions-ranking-approvals/ranking/"+name,import.meta.url),"utf8");
  assert.equal(vendored,canonical,"staged count authority drift: "+name);
 }
});
