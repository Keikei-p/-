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
 const end=html.indexOf("\n}\n",begin)+2;
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
 assert.match(block,/products\.textContent=lines\.length/);
 assert.match(block,/partnerMonthExtraLabels\(additional\?\.counts,extra\)/);
 assert.doesNotMatch(block,/\.innerHTML\s*=/);

 assert.doesNotMatch(block,/\b(?:getDoc|getDocs|getFirestore|setDoc|updateDoc|deleteDoc|writeBatch|onSnapshot|formatYen)\s*\(/);
 assert.doesNotMatch(block,/totalRevenue|unitPrice|revenuePerUnit|cashback|salesAmount/);
 const start=service.indexOf(" async function viewSavedMonth(request){");
 const finish=service.indexOf(" async function viewCombinedMonth(request){",start);
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


test("partner uses the same ranking menu tabs instead of a second monthly ranking card",()=>{
 for(const id of ["pInlineJointPersonToggle","pInlineJointProductToggle",
  "pInlineJointPersonalContent","pInlineJointProductContent",
  "pInlineJointProductStatus"])
  assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
 const start=html.indexOf('id="partnerInlineWorkspace"'),end=html.indexOf('<!-- ユーザー情報 -->',start);
 const panel=html.slice(start,end);
 assert.match(panel,/class="dashboard-app-button"[^>]*aria-expanded="false"[^>]*aria-controls="pInlineJointPersonalContent"/);
 assert.match(panel,/class="dashboard-app-button"[^>]*aria-expanded="false"[^>]*aria-controls="pInlineJointProductContent"/);
 assert.match(panel,/id="pInlineJointPersonalContent" class="dashboard-app-content" hidden/);
 assert.match(panel,/id="pInlineJointProductContent" class="dashboard-app-content" hidden/);
 assert.match(panel,/id="pInlineJointPeople" class="ranking-grid" data-columns="1"/);
 assert.match(panel,/id="pInlineJointProducts" class="ranking-grid" data-columns="1"/);
 assert.match(html,/pInline\("pInlineJointPersonToggle"\)\.onclick=\(\)=>partnerShowJointRankingTab\("personal"\)/);
 assert.match(html,/pInline\("pInlineJointProductToggle"\)\.onclick=\(\)=>partnerShowJointRankingTab\("product"\)/);
 const begin=html.indexOf("function partnerShowJointRankingTab(");
 const finish=html.indexOf('pInline("pInlineDate").onchange=',begin);
 const handler=html.slice(begin,finish);
 assert.match(handler,/setAccordionState\(pInline\(buttonId\),pInline\(contentId\),which===type\)/);
 assert.doesNotMatch(handler,/setDoc|updateDoc|deleteDoc|innerHTML|formatYen/);
 const parent=html.slice(html.indexOf('id="pInlineMonthCard"'),panel.length+start);
 assert.equal(parent.split('id="pInlineJointPeople"').length-1,1);
 assert.equal(html.split('id="pInlineMonth"').length-1,1);
});


test("original product cards have owner-only server-confirmed partner publish switches",()=>{
 for(const id of ["ownerPublishedCatalogControls","ownerPublishedCatalogRefresh",
  "ownerPublishedCatalogStatus"])
  assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
 assert.match(html,/const readPartnerPublishedCatalog = httpsCallable\(partnerCountFunctions,"getPartnerPublishedCatalog"\)/);
 assert.match(html,/const setPartnerPublishedProduct = httpsCallable\(partnerCountFunctions,"setPartnerPublishedProduct"\)/);
 assert.match(index,/exports\.getPartnerPublishedCatalog=onCall\(opts,service\.getPublishedCatalog\)/);
 assert.match(index,/exports\.setPartnerPublishedProduct=onCall\(opts,service\.setPublishedProduct\)/);
 const start=html.indexOf("let ownerCatalogState="),
       end=html.indexOf("function renderProducts() {",start);
 assert(start>0&&end>start);
 const publish=html.slice(start,end);
 assert.match(publish,/isCurrentCompanyOwner\(\)/);
 assert.match(publish,/currentCompanyData\?\.companyKind==="partner"/);
 assert.match(publish,/data\?\.scope!=="partner_published_catalog_count_only"/);
 assert.match(publish,/await readPartnerPublishedCatalog\(\{\}\)/);
 assert.match(publish,/setPartnerPublishedProduct\(\{/);
 assert.match(publish,/expectedRevision:revision/);
 assert.match(publish,/changed\?\.revision!==revision\+1/);
 assert.match(publish,/ownerCatalogState\.rows\.get\(productId\)\?\.published!==published/);
 assert.doesNotMatch(publish,/setDoc|addDoc|deleteDoc|updateDoc|writeBatch|formatYen|innerHTML/);
 const render=html.slice(end,html.indexOf("// Report a failed catalog write",end));
 assert.match(render,/checkbox\.type="checkbox"/);
 assert.match(render,/checkbox\.checked=state\?\.published===true/);
 assert.match(render,/checkbox\.disabled=!ownerCatalogState\.verified/);
 assert.match(render,/ownerCatalogToggle\(product\.id,checkbox\.checked\)/);
 assert.match(html,/function resetPartnerInline\(\)\{\n ownerCatalogReset\(\)/);
});


test("partner has separate published extra-product count inputs and audited save",()=>{
 for(const id of ["pInlineExtraCard","pInlineExtraStatus","pInlineExtraCountFields",
  "pInlineExtraSave","pInlineExtraVersion"])
  assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
 assert.match(index,/exports\.getPartnerAdditionalCounts=onCall\(opts,service\.viewAdditionalCounts\)/);
 assert.match(index,/exports\.submitPartnerAdditionalCounts=onCall\(opts,service\.submitAdditionalCounts\)/);
 assert.match(html,/const readPartnerAdditionalDay = httpsCallable\(partnerCountFunctions,"getPartnerAdditionalCounts"\)/);
 assert.match(html,/const submitPartnerAdditionalDay = httpsCallable\(partnerCountFunctions,"submitPartnerAdditionalCounts"\)/);
 const start=html.indexOf("function partnerExtraRenderCounts(){");
 const end=html.indexOf("async function partnerInlineFetch(){",start);
 assert(start>0&&end>start);
 const code=html.slice(start,end);
 assert.match(code,/input\.dataset\.extraProductId=product\.id/);
 assert.match(code,/partnerExtraData=d/);
 assert.match(code,/pInline\("pInlineExtraSave"\)\.disabled=!staffId/);
 assert.match(code,/partnerInlineWorkspaceCompany!==workspace/);
 assert.match(code,/Object\.values\(r\.counts\)\.reduce/);
 assert.doesNotMatch(code,/innerHTML|setDoc|updateDoc|getDoc|onSnapshot|formatYen|revenuePerUnit/);
 const saveStart=html.indexOf('pInline("pInlineExtraSave").onclick=');
 const saveEnd=html.indexOf('pInline("pInlineSave").onclick=',saveStart);
 assert(saveStart>0&&saveEnd>saveStart);
 const save=html.slice(saveStart,saveEnd);
 assert.match(save,/partnerInlineRun\(async\(\)=>/);
 assert.match(save,/await submitPartnerAdditionalDay\(partnerInlinePayload/);
 assert.match(save,/await readPartnerAdditionalDay\(partnerInlinePayload/);
 assert.match(save,/expectedVersion/);
 assert.match(save,/extra_verify/);
 assert.doesNotMatch(save,/innerHTML|setDoc|updateDoc|getDoc|formatYen/);
 // Existing 9-category form/callable are separate and intact.
 assert.match(html,/id="pInlineCountFields" class="p-inline-grid"/);
 assert.match(html,/pInline\("pInlineSave"\)\.onclick=\(\)=>partnerInlineRun\(async\(\)=>/);
 assert.match(html,/await partnerInlineSave\(partnerInlinePayload/);
});

test("both monthly screens integrate extra-products by saved team without changing old nine",()=>{
 const partner=html.slice(html.indexOf("async function partnerInlineMonthFetch(){"),
  html.indexOf("// Extra products use a separate count-only ledger",html.indexOf("async function partnerInlineMonthFetch(){")));
 const owner=html.slice(html.indexOf("async function loadOwnerPartnerSavedMonth("),
  html.indexOf("async function loadOwnerPartnerCompanyTeams(",html.indexOf("async function loadOwnerPartnerSavedMonth(")));
 for(const region of [partner,owner]){
  assert.match(region,/partnerMonthVisibleExtras\(data\)/);
  assert.match(region,/extraTeam\?\.totalCount\|\|0/);
  assert.match(region,/partnerMonthAppendExtraOnlyTeams\(/);
  assert.match(region,/partnerMonthExtraLabels\(/);
  assert.match(region,/追加商材は未照合です/);
  assert.doesNotMatch(region,/\b(?:setDoc|updateDoc|deleteDoc|formatYen)\s*\(/);
 }
 assert.match(partner,/partnerMonthMergedPeople\(data,extra\)/);
 assert.match(partner,/extra\?\.products/);
});

test("extra saved-month contract rejects phantom totals, secret fields and split-team sums",()=>{
 const begin=html.indexOf("function partnerSavedMonthCheckTotals(");
 const end=html.indexOf("function partnerRenderJointRows(",begin);
 const check=vm.runInNewContext("("+html.slice(begin,end).trim()+"\n)");
 const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォー",
  "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 keys[5]="ウォーター";
 const row=n=>Object.fromEntries(keys.map(k=>[k,k==="NURO"?n:0]));
 const own={key:"a".repeat(64),name:"田中",totalCount:3,counts:row(3)};
 const extraMember={key:own.key,name:"田中",totalCount:2,counts:{extra:2}};
 const good=()=>({
  scope:"partner_saved_month_counts_only",month:"2026-10",
  totalCount:3,counts:row(3),unattributedCount:0,unattributedRows:0,
  missingHistoricalTeamAttribution:false,
  people:[structuredClone(own)],
  teams:[{key:"b".repeat(64),name:"第1班",totalCount:3,counts:row(3),
   members:[structuredClone(own)]}],
  extraVerified:true,combinedTotalCount:5,
  extra:{scope:"partner_published_extra_month_only",month:"2026-10",
   complete:false,productionDocumentWrites:0,containsUnpublished:false,
   totalCount:2,verifiedExtraRows:1,unattributedCount:0,unattributedRows:0,
   products:[{id:"extra",name:"追加商材X",totalCount:2}],
   people:[structuredClone(extraMember)],
   teams:[{key:"b".repeat(64),name:"第1班",totalCount:2,counts:{extra:2},
    members:[structuredClone(extraMember)]}]}
 });
 assert.equal(check(good(),keys),true);
 for(const change of [
  d=>{d.combinedTotalCount=6;},
  d=>{d.extra.people[0].counts.extra=3;},
  d=>{d.extra.products[0].totalCount=3;},
  d=>{d.extra.teams[0].members[0].counts.extra=1;},
  d=>{d.extra.teams[0].unattributedCount=1;},
  d=>{d.extra.teams[0].members[0].unitPrice=90000;},
  d=>{d.extra.products[0].name="売上99万円";},
  d=>{d.extra.teams[0].members.push(structuredClone(extraMember));}
 ]){
  const invalid=good();change(invalid);
  assert.throws(()=>check(invalid,keys),/partner_saved_month_integrity/);
 }
 const unknown=good();unknown.extra=null;
 unknown.extraVerified=false;unknown.combinedTotalCount=null;
 assert.equal(check(unknown,keys),true);
});
