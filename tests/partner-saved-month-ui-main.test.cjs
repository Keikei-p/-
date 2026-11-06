"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
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
