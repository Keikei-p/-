"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeWorkspace,KEYS}=require("../functions-partner-workspace/service.cjs");
const {getCountRankingCategories}=require("../functions-partner-workspace/unified-count-ranking-policy.cjs");
const NOW=Date.parse("2026-11-18T09:00:00+09:00");
const DATE="2026-11-18", TOKEN="a".repeat(50);
const zero=()=>Object.fromEntries(KEYS.map(key=>[key,0]));
const snap=(id,value)=>({id,exists:value!==undefined,
 data:()=>value===undefined?undefined:structuredClone(value)});
function mockStore({missingRelation=false,missingTeam=false,orphan=false,
 oldQuick=false,secondReport=false,invalidTotal=false,mutateFinancial=false}={}){
 const vals=new Map();
 const put=(path,value)=>vals.set(path,structuredClone(value));
 put("users/owner1",{uid:"owner1",companyId:"hub1",companyRole:"owner",
  accessKind:"internal",active:true});
 put("companies/hub1",{ownerUid:"owner1",companyKind:"internal",active:true});
 put("companies/hub1/members/owner1",{uid:"owner1",companyId:"hub1",
  companyRole:"owner",accessKind:"internal",active:true});
 put("companies/partner1",{hubCompanyId:"hub1",companyKind:"partner",
  active:true,name:"協力店A",ownerUid:"partnerOwner1"});
 if(!missingRelation)put("partnerRelations/partner1",{hubCompanyId:"hub1",
  partnerCompanyId:"partner1",active:true,countSharingApproved:true});
 if(!missingTeam)put("companies/partner1/partnerWorkTeams/team1",
  {companyId:"partner1",name:"1班",active:true});
 const counts={...zero(),NURO:5};
 if(!oldQuick&&!orphan){
  put("companies/partner1/partnerWorkEntries/"+DATE+"__staff1",
   {companyId:"partner1",hubCompanyId:"hub1",staffId:"staff1",
    staffNameSnapshot:"スタッフA",teamIdSnapshot:"team1",version:1,date:DATE,
    totalCount:5,counts});
 }
 if(!orphan&&!oldQuick){
  put("companies/hub1/partnerWorkCountDays/"+DATE+"/reports/partner1",
   {hubCompanyId:"hub1",partnerCompanyId:"partner1",partnerName:"協力店A",
    source:"staff-entries-v1",date:DATE,counts,
    totalCount:invalidTotal?6:5});
 }
 if(oldQuick){
  put("companies/hub1/partnerQuickCountDays/"+DATE+"/reports/partner1",
   {hubCompanyId:"hub1",partnerCompanyId:"partner1",
    version:1,date:DATE,counts,totalCount:5});
  if(secondReport){
   put("companies/hub1/partnerWorkCountDays/"+DATE+"/reports/partner1",
    {hubCompanyId:"hub1",partnerCompanyId:"partner1",source:"staff-entries-v1",
     date:DATE,counts,totalCount:5});
  }
 }
 put("products/dangerous",{id:"dangerous",companyId:"hub1",
  name:"単価50000円",revenue:mutateFinancial?777777:20000,unitPrice:990000});
 put("records/financial",{companyId:"hub1",count:999,unitPrice:999,price:999});
 return vals;
}
function fakeDb(store){
 const visited=[],writes=[];
 const Ref=class{
  constructor(path){this.path=path;}
  collection(name){return new Query(this.path+"/"+name);}
  doc(id){return new Ref(this.path+"/"+id);}
  async get(){visited.push(this.path);return snap(this.path.split("/").at(-1),store.get(this.path));}
 };
 const Query=class{
  constructor(path,where=[],max=Infinity){this.path=path;this.filters=where;this.max=max;}
  doc(id){return new Ref(this.path+"/"+id);}
  where(k,op,v){return new Query(this.path,[...this.filters,[k,op,v]],this.max);}
  limit(n){return new Query(this.path,this.filters,n);}
  async get(){
   visited.push(this.path+"#list");
   const prefix=this.path+"/";
   const docs=[...store.entries()].filter(([path,value])=>
    path.startsWith(prefix)&&!path.slice(prefix.length).includes("/")&&
    this.filters.every(([k,op,v])=>op==="=="?value[k]===v:
     op===">="?value[k]>=v:op==="<="?value[k]<=v:false))
    .slice(0,this.max).map(([path,value])=>snap(path.slice(prefix.length),value));
   return {docs,size:docs.length};
  }
 };
 return {db:{collection:name=>new Query(name),
  runTransaction:()=>{writes.push("transaction");throw Error("WRITES_FORBIDDEN");}},
  visited,writes};
}
function fixture(options={},gate=true){
 const storage=mockStore(options);
 const {db,visited,writes}=fakeDb(storage);
 const auth={getUser:async uid=>({uid,disabled:false,email:"owner@local.test",
  emailVerified:true}),verifyIdToken:async()=>({uid:"owner1",email:"owner@local.test",
  email_verified:true})};
 class HttpsError extends Error{
  constructor(code,message){super(message);this.code=code;}
 }
 const svc=makeWorkspace({db,getAuth:()=>auth,FieldValue:{},Timestamp:{},
  HttpsError,now:()=>NOW,enabled:()=>true,sharedRankingEnabled:()=>false,
  unifiedRankingEnabled:()=>gate});
 const req={auth:{uid:"owner1",token:{email:"owner@local.test",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+TOKEN}},
  data:{date:DATE,sharedCountRankings:true,rankingPeriod:"day"}};
 return {svc,req,storage,visited,writes};
}
const fail=fn=>assert.rejects(fn,e=>e?.code==="failed-precondition"||
 e?.code==="permission-denied"||e?.code==="unavailable"||e?.code==="data-loss"||
 e?.code==="unauthenticated");

test("unified categories always match the original 9-key count ledger for every company",()=>{
 for(const partnerId of ["partner1","partner2","partner99"]){
  assert.deepEqual(getCountRankingCategories({
   mode:"unified",hubId:"hub1",partnerId
  }),KEYS);
 }
 assert.notEqual(KEYS.indexOf("SB光・AIR"),-1);
 assert.throws(()=>getCountRankingCategories({mode:"unified",
  hubId:"hub1",partnerId:"hub1"}));
 assert.throws(()=>getCountRankingCategories({mode:"unified",
  hubId:"hub1",partnerId:"partner1",legacyCategories:["NURO"]}));
 assert.deepEqual(getCountRankingCategories({mode:"legacy",
  hubId:"hub1",partnerId:"partner1",legacyCategories:["NURO"]}),["NURO"]);
});
test("GET without an ON OFF setup returns verified same-company count rankings",async()=>{
 const x=fixture();
 const before=structuredClone([...x.storage.entries()]);
 const result=await x.svc.view(x.req);
 assert.equal(result.role,"hub");
 assert.equal(result.totalCount,5);
 assert.equal(result.includesDirect,false); // NEVER claim fully joint/direct
 assert.equal(result.fullyJoint,false);
 assert.equal(result.companies[0].totalCount,5);
 assert.equal(result.teams[0].name,"1班");
 assert.equal(result.teams[0].totalCount,5);
 assert.equal(result.people[0].name,"スタッフA");
 assert.equal(result.people[0].totalCount,5);
 assert.equal(result.products.find(p=>p.name==="NURO").totalCount,5);
 assert.equal(result.products.find(p=>p.name==="SB光・AIR").totalCount,0);
 assert.equal(result.reportCount,1);
 assert.equal(result.peopleComplete,true);
 assert.equal(result.teamComplete,true);
 assert.deepEqual([...x.storage.entries()],before);
 assert.equal(x.writes.length,0);
 for(const path of x.visited){
  assert(!path.startsWith("products")&&!path.startsWith("records"),path);
  assert(!/rankingProductVisibility|rankingSkuMappings|rankingCountPublicCatalog/.test(path),path);
 }
 const json=JSON.stringify(result);
 for(const secret of ["unitPrice","cashback","revenue","price","owner@local.test",
  "999","990000","dangerous"])
  assert.equal(json.includes(secret),false,secret);
});
test("legacy feature flag OFF remains unavailable and never permits bypass",async()=>{
 const x=fixture({},false);
 await fail(()=>x.svc.view(x.req));
 assert.equal(x.writes.length,0);
});
test("no relation, inconsistent day total or missing summary fails closed",async()=>{
 for(const conditions of [{missingRelation:true},{invalidTotal:true}]){
  const x=fixture(conditions);
  await fail(()=>x.svc.view(x.req));
  assert.equal(x.writes.length,0);
 }
});
test("missing day summary is unreported, never fabricated as a submitted zero",async()=>{
 const x=fixture({orphan:true});
 const o=await x.svc.view(x.req);
 assert.equal(o.totalCount,0);
 assert.equal(o.reportCount,0);
 assert.equal(o.unreportedCompanies.length,1);
 assert.equal(o.companies.length,0);
 assert.equal(o.people.length,0);
 assert.equal(x.writes.length,0);
});
test("old company-only counts remain countable, never invented as team/member",async()=>{
 const x=fixture({oldQuick:true});
 const o=await x.svc.view(x.req);
 assert.equal(o.totalCount,5);
 assert.equal(o.historicalCompanyOnlyCount,5);
 assert.equal(o.people.length,0);
 assert.equal(o.teams.length,0);
 assert.equal(o.peopleComplete,false);
 assert.equal(o.teamComplete,false);
 assert.equal(x.writes.length,0);
});
test("a duplicate old + new company day report fails instead of double counting",async()=>{
 const x=fixture({oldQuick:true,secondReport:true});
 await fail(()=>x.svc.view(x.req));
});
test("forged missing verified team remains incomplete without reassignment",async()=>{
 const x=fixture({missingTeam:true});
 const output=await x.svc.view(x.req);
 assert.equal(output.totalCount,5);
 assert.equal(output.teams.length,0);
 assert.equal(output.unverifiedTeamCount,5);
 assert.equal(output.teamComplete,false);
});
test("invalid authentication cannot read even public count metadata",async()=>{
 const x=fixture();x.req.auth.uid="different";
 await fail(()=>x.svc.view(x.req));
 assert.equal(x.visited.length,0);
});
