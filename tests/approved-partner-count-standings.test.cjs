"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildApprovedPartnerCountStandings,KEYS}=
 require("../functions-partner-workspace/shared-count-standings.cjs");
const {allowedPartnerCategories}=require("../functions-partner-workspace/approved-published-categories.cjs");
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
function company(cid,name,counts,{date="2026-10-31",person="a",staffName="担当者",team="team",allowed=["NURO"]}={}){
 const total=Object.values(counts).reduce((x,y)=>x+y,0);
 return {cid,name,approved:true,allowedCategories:allowed,
  teams:[{id:team,name:"1班"}],
  entries:[{id:date+"__"+person,data:{companyId:cid,hubCompanyId:"hub",date,
   staffId:person,teamIdSnapshot:team,staffNameSnapshot:staffName,
   version:1,counts,totalCount:total,
   privateCounts:{privateSku:999},privateTotalCount:999,
   cbCounts:{NURO:{"80000":2}},revenue:990000,updatedByUid:"internal-admin"}}],
  reports:[{date,data:{source:"staff-entries-v1",hubCompanyId:"hub",
   partnerCompanyId:cid,date,counts,totalCount:total,revenue:7654321}}]};
}
const build=sources=>buildApprovedPartnerCountStandings({
 hubId:"hub",start:"2026-10-31",end:"2026-10-31",sources
});
test("two approved companies, individual/team, product totals, once only",()=>{
 const a=company("a","会社A",{...zero(),NURO:2,SBMNP:7});
 const b=company("b","会社B",{...zero(),NURO:2,SBMNP:8});
 const before=JSON.stringify([a,b]);
 const out=build([a,b]);
 assert.deepEqual(out.companies.map(x=>x.rank),[1,1]);
 assert.deepEqual(out.people.map(x=>x.rank),[1,1]);
 assert.deepEqual(out.teams.map(x=>x.rank),[1,1]);
 assert.deepEqual(out.products.map(x=>x.name),["NURO"]);
 assert.equal(out.totalCount,4);
 assert.equal(out.reportCount,2);
 assert.equal(out.peopleComplete,true);
 assert.equal(out.includesDirect,false);
 assert.equal(out.fullyJoint,false);
 assert.doesNotMatch(JSON.stringify(out),/cbCounts|80000|990000|7654321|privateSku|updatedByUid|revenue|SBMNP/);
 assert.equal(JSON.stringify([a,b]),before);
});
test("zero is submitted but missing report is not treated as zero",()=>{
 const submitted=company("a","会社A",zero());
 const missing={...company("b","会社B",zero()),entries:[],reports:[]};
 const out=build([submitted,missing]);
 assert.equal(out.companies.length,1);
 assert.equal(out.companies[0].totalCount,0);
 assert.equal(out.companies[0].reportedDays,1);
 assert.equal(out.reportCount,1);
});
test("orphan staff entries cannot appear in ranks without a saved daily summary",()=>{
 const x=company("a","会社A",{...zero(),NURO:2});
 x.reports=[{date:"2026-10-31",data:null}];
 assert.throws(()=>build([x]),/UNVERIFIED/);
 x.entries[0].data.counts=zero();
 x.entries[0].data.totalCount=0;
 assert.throws(()=>build([x]),/UNVERIFIED/);
 x.reports=[];
 assert.throws(()=>build([x]),/UNVERIFIED/);
});
test("legacy company-only counts never masquerade as staff or teams",()=>{
 const x=company("a","会社A",{...zero(),NURO:4});
 x.entries=[];x.reports[0].data.source="quick-counts-v1";
 const out=build([x]);
 assert.equal(out.totalCount,4);
 assert.equal(out.people.length,0);
 assert.equal(out.teams.length,0);
 assert.equal(out.peopleComplete,false);
 assert.equal(out.historicalCompanyOnlyCount,4);
});
test("missing historical team does not get guessed from live roster",()=>{
 const x=company("a","会社A",{...zero(),NURO:3});
 x.entries[0].data.teamIdSnapshot=null;
 const out=build([x]);
 assert.equal(out.totalCount,3);
 assert.equal(out.teams.length,0);
 assert.equal(out.unverifiedTeamCount,3);
 assert.equal(out.teamComplete,false);
 assert.equal(out.people[0].teamKey,null);
});
test("corrupt summary, duplicate person, foreign scope, bad names fail closed",()=>{
 const a=company("a","会社A",{...zero(),NURO:2});
 const bad=[
  {...a,reports:[{...a.reports[0],data:{...a.reports[0].data,totalCount:9}}]},
  {...a,entries:[...a.entries,...a.entries]},
  {...a,approved:false},
  {...a,name:"売上10万円"},
  {...a,allowedCategories:["NURO","NURO"]},
  {...a,allowedCategories:["NURO","unknown"]},
  {...a,entries:[{...a.entries[0],data:{...a.entries[0].data,companyId:"foreign"}}]}
 ];
 for(const row of bad)assert.throws(()=>build([row]),/UNVERIFIED/);
});
test("only exact Owner-reviewed active mapped and partner-enabled SKUs publish",()=>{
 const products=[{id:"nuro",companyId:"hub",name:"NURO光",active:true},
  {id:"ym",companyId:"hub",name:"YM純新規",active:true},
  {id:"other",companyId:"hub",unitPrice:50000}];
 const visibility={hubCompanyId:"hub",ownerUid:"h",version:1,
  enabledHubProductIds:["nuro","ym"],partnerOverrides:{a:["nuro"]}};
 const mapping={hubCompanyId:"hub",ownerUid:"h",reviewedByUid:"h",
  active:true,version:1,bindings:[
   {companyId:"a",productId:"partnerSku01",hubProductId:"nuro"},
   {companyId:"a",productId:"partnerSku04",hubProductId:"ym"}]};
 const input={hubId:"hub",cid:"a",ownerUid:"h",visibility,mapping,products};
 assert.deepEqual(allowedPartnerCategories(input),["NURO"]);
 assert.deepEqual(allowedPartnerCategories({...input,
  visibility:{...visibility,partnerOverrides:{a:[]}}}),[]);
 for(const changed of [
  {...input,ownerUid:"impersonated"},
  {...input,mapping:{...mapping,reviewedByUid:"attacker"}},
  {...input,mapping:{...mapping,bindings:[...mapping.bindings,mapping.bindings[0]]}},
  {...input,mapping:{...mapping,bindings:[{...mapping.bindings[0],hubProductId:"foreign"}]}}
 ])assert.throws(()=>allowedPartnerCategories(changed),/UNVERIFIED/);
});

test("mapped public catalog rejects financial labels, extra fields and duplicate hub SKU",()=>{
 const products=[{id:"nuro",companyId:"hub",name:"NURO",active:true}];
 const visibility={hubCompanyId:"hub",ownerUid:"h",version:1,
  enabledHubProductIds:["nuro"],partnerOverrides:{}};
 const mapping={hubCompanyId:"hub",ownerUid:"h",reviewedByUid:"h",
  active:true,version:1,bindings:[
   {companyId:"a",productId:"partnerSku01",hubProductId:"nuro"}]};
 const base={hubId:"hub",cid:"a",ownerUid:"h",visibility,mapping,products};
 assert.deepEqual(allowedPartnerCategories(base),["NURO"]);
 for(const productName of ["NURO 5万円","NURO 5000円","NURO ＣＢ５０００",
  "NURO cashback 5000","NURO revenue 5000","NURO 単価5000"]){
  assert.throws(()=>allowedPartnerCategories({...base,
   products:[{...products[0],name:productName}]}),/UNVERIFIED/);
 }
 assert.throws(()=>allowedPartnerCategories({...base,
  products:[{...products[0],unitPrice:50000}]}),/UNVERIFIED/);
 assert.throws(()=>allowedPartnerCategories({...base,
  mapping:{...mapping,bindings:[...mapping.bindings,
   {companyId:"a",productId:"partnerSku02",hubProductId:"nuro"}]}}),/UNVERIFIED/);
});

test("partner rankings reject financial labels in company, team and person names",()=>{
 for(const label of ["会社5万円","ＣＢ５０００","cashback 5000","単価5000"]){
  const companyRow=company("a",label,{...zero(),NURO:1});
  assert.throws(()=>build([companyRow]),/UNVERIFIED/);
  const teamRow=company("a","会社A",{...zero(),NURO:1});
  teamRow.teams[0].name=label;
  assert.throws(()=>build([teamRow]),/UNVERIFIED/);
  const personRow=company("a","会社A",{...zero(),NURO:1});
  personRow.entries[0].data.staffNameSnapshot=label;
  assert.throws(()=>build([personRow]),/UNVERIFIED/);
 }
});
