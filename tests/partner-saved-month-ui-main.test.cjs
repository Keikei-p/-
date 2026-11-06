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
