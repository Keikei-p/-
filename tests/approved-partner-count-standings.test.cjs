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
test("all-OFF partner publishes no personal/team ranks while ON zero remains reported",()=>{
 const off=company("a","非公開会社",{...zero(),NURO:9},{allowed:[]});
 const on=company("b","公開会社",{...zero(),NURO:2},{allowed:["NURO"]});
 const submittedZero=company("c","ゼロ会社",zero(),{allowed:["NURO"]});
 const originals=JSON.stringify([off,on,submittedZero]);
 const out=build([off,on,submittedZero]);
 assert.equal(out.totalCount,2);
 assert.equal(out.reportCount,2,
  "fully OFF company must not leak even its report count metadata");
 assert.deepEqual(out.companies.map(x=>x.name),["公開会社","ゼロ会社"]);
 assert.equal(out.people.length,2);
 assert.equal(out.teams.length,2);
 assert.equal(out.people.find(x=>x.companyName==="ゼロ会社").totalCount,0);
 assert.equal(JSON.stringify(out).includes("非公開会社"),false);
 assert.equal(JSON.stringify([off,on,submittedZero]),originals);
});
test("zero is submitted but missing report is not treated as zero",()=>{
 const submitted=company("a","会社A",zero());
 const missing={...company("b","会社B",zero()),entries:[],reports:[]};
 const out=build([submitted,missing]);
 assert.equal(out.companies.length,1);
 assert.equal(out.companies[0].totalCount,0);
 assert.equal(out.companies[0].reportedDays,1);
 assert.equal(out.reportCount,1);
 assert.equal(out.partnerCountsComplete,false);
 assert.equal(out.peopleComplete,false,
  "published partner with no submission cannot claim a complete person ranking");
 assert.equal(out.teamComplete,false,
  "published partner with no submission cannot claim a complete team ranking");
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
  "NURO cashback 5000","NURO revenue 5000","NURO 単価5000",
  "NURO 原価","NURO 価格","NURO commission","NURO ２千円"]){
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
 for(const label of ["会社5万円","ＣＢ５０００","cashback 5000","単価5000",
  "原価5000","commission 5000"]){
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

test("published SKU ranking IDs remain stable after preceding SKU is OFF",()=>{
 const a=company("a","会社A",{...zero(),NURO:3,YMMNP:2},
  {allowed:["NURO","YMMNP"]});
 const both=build([a]);
 const onlyY=build([{...a,allowedCategories:["YMMNP"]}]);
 assert.equal(both.products.find(x=>x.name==="YMMNP").key,"product-3");
 assert.equal(onlyY.products.find(x=>x.name==="YMMNP").key,"product-3");
 assert.equal(onlyY.products.find(x=>x.name==="YMMNP").totalCount,2);
 assert.equal(onlyY.totalCount,2);
});

test("fully unpublished partner name never appears even when it has no reports",()=>{
 const hidden={...company("off","非公開会社",zero(),{allowed:[]}),
  reports:[],entries:[]};
 const open=company("on","公開会社",{...zero(),NURO:1},{allowed:["NURO"]});
 const output=build([hidden,open]);
 assert.equal(output.totalCount,1);
 assert.equal(output.partnerCountsComplete,true);
 assert.equal(output.unreportedCompanies.length,0);
 assert(!JSON.stringify(output).includes("非公開会社"));
 assert.equal(output.companies.length,1);
 assert.equal(output.companies[0].name,"公開会社");
 // Switching ON makes a true unreported company visible as unreported,
 // never as a zero-count submitted company.
 const enabled=build([{...hidden,allowedCategories:["NURO"]},open]);
 assert.deepEqual(enabled.unreportedCompanies.map(x=>x.name),["非公開会社"]);
 assert.equal(enabled.companies.length,1);
 assert.equal(enabled.partnerCountsComplete,false);
});

test("zero-count submissions with missing historical attribution never certify complete ranks",()=>{
 const teamLost=company("a","A社",zero());
 teamLost.entries[0].data.teamIdSnapshot=null;
 const teamOutput=build([teamLost]);
 assert.equal(teamOutput.totalCount,0);
 assert.equal(teamOutput.reportCount,1);
 assert.equal(teamOutput.partnerCountsComplete,true);
 assert.equal(teamOutput.unverifiedTeamCount,0,
  "zero numeric unidentified total must not imply verified attribution");
 assert.equal(teamOutput.teams.length,0);
 assert.equal(teamOutput.teamComplete,false);
 assert.equal(teamOutput.peopleComplete,true);
 assert.equal(teamOutput.people.length,1);

 const personLost=company("a","A社",zero());
 personLost.entries[0].data.staffNameSnapshot=null;
 const personOutput=build([personLost]);
 assert.equal(personOutput.totalCount,0);
 assert.equal(personOutput.unverifiedPersonCount,0);
 assert.equal(personOutput.people.length,0);
 assert.equal(personOutput.companies[0].peopleVerified,false);
 assert.equal(personOutput.peopleComplete,false);
 assert.equal(personOutput.teamComplete,true);
 assert.equal(personOutput.teams.length,1);
});
test("historical company-only zero cannot falsely certify personal and team ranks",()=>{
 const legacy=company("a","旧会社",zero());
 legacy.entries=[];
 legacy.reports[0].data.source="quick-counts-v1";
 const output=build([legacy]);
 assert.equal(output.totalCount,0);
 assert.equal(output.reportCount,1);
 assert.equal(output.historicalCompanyOnlyCount,0);
 assert.equal(output.companies.length,1);
 assert.equal(output.companies[0].peopleVerified,false);
 assert.equal(output.people.length,0);
 assert.equal(output.teams.length,0);
 assert.equal(output.peopleComplete,false);
 assert.equal(output.teamComplete,false);
});
test("one company's zero-count unknown person does not mark another company's verified staff unverified",()=>{
 const unverified=company("a","A社",zero());
 unverified.entries[0].data.staffNameSnapshot=null;
 const valid=company("b","B社",zero());
 const output=build([unverified,valid]);
 assert.equal(output.companies.find(c=>c.name==="A社").peopleVerified,false);
 assert.equal(output.companies.find(c=>c.name==="B社").peopleVerified,true);
 assert.equal(output.peopleComplete,false);
 assert.equal(output.people.length,1);
 assert.equal(output.people[0].name,"担当者");
});

test("partly reported month is incomplete, while true submitted zero stays ranked",()=>{
 const partial=company("a","一部未報告会社",{...zero(),NURO:3},{date:"2026-10-01"});
 partial.reports.push({date:"2026-10-02",data:null});
 const missing={...company("b","未報告会社",zero(),{date:"2026-10-01"}),
  entries:[],reports:[
   {date:"2026-10-01",data:null},
   {date:"2026-10-02",data:null}
  ]};
 const submittedZero=company("c","0件報告会社",zero(),{date:"2026-10-01"});
 submittedZero.reports.push({date:"2026-10-02",data:null});
 const originals=JSON.stringify([partial,missing,submittedZero]);
 const output=buildApprovedPartnerCountStandings({
  hubId:"hub",start:"2026-10-01",end:"2026-10-02",
  sources:[partial,missing,submittedZero]
 });
 assert.equal(output.totalCount,3);
 assert.equal(output.reportCount,2);
 assert.equal(output.partnerCountsComplete,false);
 assert.equal(output.peopleComplete,false);
 assert.equal(output.teamComplete,false);
 assert.deepEqual(output.unreportedCompanies.map(x=>[x.name,x.status]),[
  ["一部未報告会社","partial_report"],
  ["未報告会社","not_reported"],
  ["0件報告会社","partial_report"]
 ]);
 assert.equal(output.companies.find(x=>x.name==="0件報告会社").totalCount,0);
 assert.equal(output.companies.find(x=>x.name==="0件報告会社").reportedDays,1);
 assert.equal(JSON.stringify([partial,missing,submittedZero]),originals,
  "read-only monthly ranking never rewrites source documents");
});
test("truncated day inventories are rejected, never certify a false full-month leaderboard",()=>{
 const partial=company("a","会社A",{...zero(),NURO:1},{date:"2026-10-01"});
 const source={hubId:"hub",start:"2026-10-01",end:"2026-10-02",
  sources:[partial]};
 assert.throws(()=>buildApprovedPartnerCountStandings(source),/UNVERIFIED/);
 const full={...partial,reports:[
  ...partial.reports,{date:"2026-10-02",data:null}
 ]};
 assert.deepEqual(buildApprovedPartnerCountStandings({
  ...source,sources:[full]
 }).unreportedCompanies.map(x=>x.status),["partial_report"]);
});

test("all OFF company reports and legacy-only history have zero public metadata influence",()=>{
 const hidden=company("off","内密会社",{...zero(),NURO:27},
  {allowed:[]});
 hidden.entries=[];
 hidden.reports[0].data.source="quick-counts-v1";
 const published=company("on","公開会社",{...zero(),NURO:1});
 const original=JSON.stringify([hidden,published]);
 const output=build([hidden,published]);
 assert.equal(output.totalCount,1);
 assert.equal(output.reportCount,1);
 assert.equal(output.peopleComplete,true);
 assert.equal(output.teamComplete,true);
 assert.equal(output.partnerCountsComplete,true);
 assert.equal(output.historicalCompanyOnlyCount,0);
 assert.equal(output.unverifiedTeamCount,0);
 assert.equal(output.unverifiedPersonCount,0);
 assert.deepEqual(output.companies.map(x=>x.name),["公開会社"]);
 assert(!JSON.stringify(output).includes("内密会社"));
 assert.equal(JSON.stringify([hidden,published]),original);
 const offOnly=build([hidden]);
 assert.equal(offOnly.reportCount,0);
 assert.equal(offOnly.totalCount,0);
 assert.deepEqual(offOnly.unreportedCompanies,[]);
 assert.equal(offOnly.companies.length,0);
});


test("cross-month weekly reports reconcile prior-month staff records without finance leaks",()=>{
 const counts={...zero(),NURO:3},a=company("a","承認済み会社",counts,{date:"2026-09-30"});
 const days=Array.from({length:7},(_,i)=>{
  const d=new Date("2026-09-28T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+i);
  return d.toISOString().slice(0,10);
 });
 a.reports=days.map(date=>date==="2026-09-30"?a.reports[0]:{date,data:null});
 const original=JSON.stringify(a);
 const input={hubId:"hub",start:"2026-09-28",end:"2026-10-04",sources:[a]};
 const result=buildApprovedPartnerCountStandings(input);
 assert.equal(result.totalCount,3);
 assert.equal(result.people[0].totalCount,3);
 assert.equal(result.teams[0].totalCount,3);
 assert.equal(result.products[0].totalCount,3);
 assert.equal(result.partnerCountsComplete,false,"unreported days are never invented as 0");
 assert.deepEqual(result.unreportedCompanies.map(x=>x.status),["partial_report"]);
 assert.doesNotMatch(JSON.stringify(result),/revenue|unitPrice|cashback|7654321/);
 assert.equal(JSON.stringify(a),original,"week reads must not mutate saved history");
 assert.throws(()=>buildApprovedPartnerCountStandings({
  ...input,sources:[{...a,reports:a.reports.slice(1)}]
 }),/UNVERIFIED/,"truncated prior-month day inventory fails closed");
 assert.throws(()=>buildApprovedPartnerCountStandings({
  ...input,start:"2026-09-01",end:"2026-10-04"
 }),/UNVERIFIED/,"unbounded cross-month ranges are not allowed");
});
