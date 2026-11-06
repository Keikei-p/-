"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const index=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/index.js"),"utf8");
const service=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/service.cjs"),"utf8");
const ids=["pInlineMonth","pInlineMonthRefresh","pInlineMonthStatus",
 "pInlineMonthTeams","pInlineMonthPeople","pInlineMonthProducts"];
test("monthly dashboard shows separate month and leaves daily input intact",()=>{
 for(const id of ids)
  assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
 assert.match(html,/id="pInlineMonth" type="month"/);
 assert.match(html,/id="pInlineDate" type="date"/);
 assert.match(html,/id="pInlineCountFields"/);
 assert.match(html,/id="pInlineSave"/);
 assert.match(html,/pInline\("pInlineDate"\)\.onchange=partnerInlineFetch/);
 assert.match(html,/pInline\("pInlineMonth"\)\.onchange=partnerInlineMonthFetch/);
 assert.match(html,/pInline\("pInlineMonthRefresh"\)\.onclick=partnerInlineMonthFetch/);
});
test("monthly UI only fetches bound count-only callable; no money or direct Firestore reads",()=>{
 assert.match(index,/exports\.getPartnerSavedMonthlyCounts=onCall\(opts,service\.viewSavedMonth\)/);
 assert.match(html,/const readPartnerSavedMonth = httpsCallable\(partnerCountFunctions,"getPartnerSavedMonthlyCounts"\)/);
 const begin=html.indexOf("async function partnerInlineMonthFetch(){");
 const end=html.indexOf("async function partnerInlineFetch(){",begin);
 assert(begin>=0&&end>begin);
 const block=html.slice(begin,end);
 assert.match(block,/await readPartnerSavedMonth\(payload\)/);
 assert.match(block,/workspaceCompanyId:workspace/);
 assert.match(block,/auth\.currentUser\?\.uid!==uid/);
 assert.match(block,/pInline\("pInlineMonth"\)\.value!==month/);
 assert.match(block,/data\.complete!==false/);
 assert.match(block,/data\.financialFieldsIncluded!==false/);
 assert.match(block,/未入力日は未照合/);
 assert.match(block,/partnerMainAppendRow/);
 assert.match(block,/document\.createElement\("details"\)/);
 assert.match(block,/document\.createElement\("summary"\)/);
 assert.match(block,/team\.members/);
 assert.match(block,/member\.counts\[k\]/);
 assert.match(block,/memberTotal!==team\.totalCount/);
 assert.match(block,/attributed\+\(data\.unattributedCount\?\?0\)!==data\.totalCount/);
 assert.match(block,/summary\.textContent=team\.name/);
 assert.match(block,/products\.textContent=nonzero\.length/);
 assert.doesNotMatch(block,/\.innerHTML\s*=/);

 assert.doesNotMatch(block,/\b(?:getDoc|getDocs|getFirestore|setDoc|updateDoc|deleteDoc|writeBatch|onSnapshot|formatYen)\s*\(/);
 assert.doesNotMatch(block,/totalRevenue|unitPrice|revenuePerUnit|cashback|salesAmount/);
 const start=service.indexOf(" async function viewSavedMonth(request){");
 const finish=service.indexOf(" async function submit(request){",start);
 assert(start>0&&finish>start);
 const handler=service.slice(start,finish);
 assert.doesNotMatch(handler,/tx\.(?:set|create|update|delete)\(|\b(?:setDoc|updateDoc|deleteDoc)\(/);
 assert.doesNotMatch(handler,/db\.collection\("(?:products|records|revenueGoals|recordCorrections)"\)/);
});
test("existing app module parses after adding month controls (without running Firebase)",()=>{
 const match=html.match(/<script\s+type="module"[^>]*>([\s\S]*?)<\/script>/);
 assert(match&&match[1].length>10000,"existing ES module must be found");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nico-month-parser-"));
 const file=path.join(dir,"isolated-index.mjs");
 try{
  fs.writeFileSync(file,match[1]);
  const result=cp.spawnSync(process.execPath,["--check",file],{encoding:"utf8",timeout:15000});
  assert.equal(result.status,0,result.stderr?.slice(0,1200));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("HQ Owner sees an explicit month selector and opens one approved partner on demand",()=>{
 for(const id of ["ownerPartnerMonthControls","ownerPartnerMonth","ownerPartnerMonthStatus",
  "ownerPartnerMonthDetails"])
  assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
 assert.match(html,/id="ownerPartnerMonth" aria-label="本社から確認する協力店の月"/);
 assert.match(html,/ownerPartnerSelectedCompany=company\.partnerCompanyId/);
 assert.match(html,/button\.textContent=company\.name\+"｜月別詳細を表示"/);
 const start=html.indexOf("async function loadOwnerPartnerSavedMonth(");
 const end=html.indexOf("async function loadOwnerPartnerCompanyTeams(",start);
 assert(start>0&&end>start);
 const code=html.slice(start,end);
 assert.match(code,/!isCurrentCompanyOwner\(\)/);
 assert.match(code,/currentCompanyData\?\.companyKind==="partner"/);
 assert.match(code,/readPartnerSavedMonth\(\{month,partnerCompanyId:companyId\}\)/);
 assert.match(code,/ownerPartnerSelectedCompany!==companyId/);
 assert.match(code,/data\.financialFieldsIncluded!==false/);
 assert.match(code,/document\.createElement\("details"\)/);
 assert.match(code,/person\.counts\[k\]/);
 assert.match(code,/data\.missingHistoricalTeamAttribution/);
 assert.doesNotMatch(code,/\b(?:getDoc|getDocs|setDoc|updateDoc|deleteDoc|writeBatch|onSnapshot|formatYen)\s*\(/);
 assert.doesNotMatch(code,/\.innerHTML\s*=/);
 const from=end,to=html.indexOf("async function showPartnerInviteAtMain(",end);
 const browse=html.slice(from,to);
 assert.match(browse,/if\(company\.active&&partnerMainValidId\(company\.partnerCompanyId\)\)/);
 assert.doesNotMatch(browse,/readPartnerSavedMonth\(\{/,
  "reading one month must require a click, never 100 company reads at once");
});


test("both monthly views use the same strict saved count parity gate",()=>{
 const fnStart=html.indexOf("function partnerSavedMonthCheckTotals(");
 const fnEnd=html.indexOf("async function partnerInlineMonthFetch(){",fnStart);
 assert(fnStart>0&&fnEnd>fnStart);
 const source=html.slice(fnStart,fnEnd);
 assert.match(source,/peopleTotal!==data\.totalCount/);
 assert.match(source,/teamTotal\+data\.unattributedCount!==data\.totalCount/);
 assert.match(source,/counts\[k\]!==team\.counts\[k\]/);
 assert.match(source,/cash\.\?back/);
 assert.match(html,/partnerSavedMonthCheckTotals\(data,keys\)/);
 assert.equal(html.split("partnerSavedMonthCheckTotals(data,keys);").length-1,2);
 assert.doesNotMatch(source,/\b(?:fetch|httpsCallable|setDoc|updateDoc|deleteDoc|onSnapshot)\(/);
});
test("money-free month totals are shown only when team, person, product all match",()=>{
 const begin=html.indexOf("function partnerSavedMonthCheckTotals(");
 const end=html.indexOf("function partnerRenderJointRows(",begin);
 assert(begin>0&&end>begin);
 const check=vm.runInNewContext("("+html.slice(begin,end).trim()+"\n)");
 const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
  "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const row=n=>Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?n:0]));
 const member=()=>({key:"a".repeat(64),name:"山田",totalCount:2,counts:row(2)});
 const valid=()=>({
  scope:"partner_saved_month_counts_only",month:"2026-10",
  complete:false,provisional:true,financialFieldsIncluded:false,
  totalCount:2,counts:row(2),unattributedCount:0,unattributedRows:0,
  missingHistoricalTeamAttribution:false,
  people:[member()],
  teams:[{key:"b".repeat(64),name:"第1班",totalCount:2,counts:row(2),
   members:[member()]}]
 });
 assert.equal(check(valid(),KEYS),true);
 const bad=[
  a=>{a.counts.NURO=1;},
  a=>{a.people[0].counts.NURO=1;},
  a=>{a.people[0].totalCount=1;},
  a=>{a.teams[0].members[0].totalCount=1;},
  a=>{a.teams[0].members[0].counts.NURO=1;},
  a=>{a.teams[0].counts.NURO=1;},
  a=>{a.teams[0].members[0].key="c".repeat(64);},
  a=>{a.teams[0].members.push(member());},
  a=>{a.unattributedCount=1;},
  a=>{a.missingHistoricalTeamAttribution=true;},
  a=>{a.teams[0].members[0].unitPrice=100000;},
  a=>{a.teams[0].members[0].cbCounts={NURO:{"20000":2}};},
  a=>{a.totalRevenue=100000;},
  a=>{a.teams[0].members[0].name=1;}
 ];
 for(const mutate of bad){
  const altered=valid();mutate(altered);
  assert.throws(()=>check(altered,KEYS),/partner_saved_month_integrity/);
 }
});


test("joint ranking controls are in the same live app for owner and partner",()=>{
 for(const id of ["pInlineJointStatus","pInlineJointPeople","pInlineJointProducts",
  "ownerPartnerJointStatus","ownerPartnerJointPeople","ownerPartnerJointProducts"]){
  assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
 }
 assert.match(index,/exports\.getPartnerCombinedMonthlyCounts=onCall\(opts,service\.viewCombinedMonth\)/);
 assert.match(html,/const readPartnerCombinedMonth = httpsCallable\(partnerCountFunctions,"getPartnerCombinedMonthlyCounts"\)/);
 const start=html.indexOf("function partnerRenderJointRows(");
 const end=html.indexOf("async function partnerInlineMonthFetch(){",start);
 assert(start>0&&end>start);
 const block=html.slice(start,end);
 assert.match(block,/className="ranking-row"/);
 assert.match(block,/className="ranking-number"/);
 assert.match(block,/className="ranking-count"/);
 assert.match(block,/await readPartnerCombinedMonth\(payload\)/);
 assert.match(block,/partnerValidateCombinedMonth\(data,month\)/);
 assert.match(block,/partnerRenderJointRows\(prefix\+"People",data\.people,true\)/);
 assert.match(block,/partnerRenderJointRows\(prefix\+"Products",data\.products,false\)/);
 assert.match(block,/data\.grandTotal/);
 assert.match(block,/未報告日/);
 assert.doesNotMatch(block,/\b(?:getDoc|getDocs|setDoc|updateDoc|deleteDoc|writeBatch|onSnapshot)\s*\(/);
 assert.doesNotMatch(block,/\.innerHTML\s*=/);
});
test("joint rankings reject broken totals, ties, leaked finance, and unverified month",()=>{
 const start=html.indexOf("function partnerValidateCombinedMonth(");
 const end=html.indexOf("async function partnerFetchJointMonth(",start);
 const check=vm.runInNewContext("("+html.slice(start,end).trim()+")");
 const person=(kind,key,score,rank,name)=>({
  kind,key:key.repeat(64),totalCount:score,rank,name,companyName:kind==="direct"?"直営":"協力店A"
 });
 const make=()=>({
  scope:"joint_saved_month_counts_only",month:"2026-10",
  complete:false,provisional:true,productionDocumentWrites:0,
  grandTotal:5,partnerTotal:3,directTotal:2,
  people:[person("partner","a",3,1,"田中"),person("direct","b",2,2,"佐藤")],
  products:[{name:"NURO",totalCount:5,rank:1}]
 });
 assert.equal(check(make(),"2026-10"),true);
 const mutations=[
  d=>{d.grandTotal=10;},
  d=>{d.people[0].rank=2;},
  d=>{d.people[1].rank=1;},
  d=>{d.products[0].totalCount=4;},
  d=>{d.people[1].key=d.people[0].key;},
  d=>{d.people[0].totalCount=4;},
  d=>{d.people[0].name="";},
  d=>{d.products[0].unitPrice=10000;},
  d=>{d.people[0].cashback=20000;},
  d=>{d.complete=true;},
  d=>{d.month="2026-11";},
  d=>{d.productionDocumentWrites=1;}
 ];
 for(const mutate of mutations){
  const changed=make();mutate(changed);
  assert.throws(()=>check(changed,"2026-10"),/joint_saved_month_invalid/);
 }
});


test("HQ joint personal and product count ranks live in original ranking tabs, not company admin",()=>{
 const individualStart=html.indexOf('id="individualRankingContent"');
 const productStart=html.indexOf('id="productRankingContent"');
 const teamStart=html.indexOf('id="teamRankingContent"');
 const adminStart=html.indexOf('id="ownerPartnerMonthControls"');
 assert(individualStart>=0&&productStart>individualStart&&teamStart>productStart&&adminStart>teamStart);
 const individual=html.slice(individualStart,productStart);
 const product=html.slice(productStart,teamStart);
 const admin=html.slice(adminStart,html.indexOf('id="productManagement"',adminStart));
 assert.match(individual,/id="individualRankingList"/);
 assert.match(individual,/id="ownerPartnerJointPeople"/);
 assert.match(individual,/id="ownerPartnerJointRefresh"/);
 assert.match(product,/id="productRankingMemberList"/);
 assert.match(product,/id="ownerPartnerJointProducts"/);
 assert.match(product,/id="ownerPartnerJointProductsRefresh"/);
 assert.doesNotMatch(admin,/ownerPartnerJointPeople|ownerPartnerJointProducts/);
 assert.match(html,/individualRankingToggle\.addEventListener\("click",\(\)=>loadOwnerJointForRankingTab\(\)\)/);
 assert.match(html,/productRankingToggle\.addEventListener\("click",\(\)=>loadOwnerJointForRankingTab\(\)\)/);
 const start=html.indexOf('function loadOwnerJointForRankingTab(');
 const end=html.indexOf('async function loadOwnerPartnerSavedMonth(',start);
 const source=html.slice(start,end);
 assert.match(source,/dashboardMonth\.value/);
 assert.match(source,/ownerJointCachedMonth===key/);
 assert.match(source,/isCurrentCompanyOwner\(\)/);
 assert.match(source,/partnerFetchJointMonth\("owner",dashboardMonth\.value,""\)/);
 assert.doesNotMatch(source,/firebase-firestore|setDoc|updateDoc|deleteDoc|onSnapshot/);
 const joint=html.slice(html.indexOf("async function partnerFetchJointMonth("),
  html.indexOf("async function partnerInlineMonthFetch(){"));
 assert.match(joint,/dashboardMonth\.value!==month/);
 assert.match(joint,/pInline\("ownerPartnerJointProductStatus"\)/);
 assert.doesNotMatch(joint,/ownerPartnerMonth"\)\.value!==month/);
});
