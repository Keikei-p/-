"use strict";
// NO DEPLOY. Count-only Owner UI and e-mail-less person joint-rank contract.
// Synthetic records only. This test never connects to Firebase.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {projectSavedPartnerMonth}=require("../functions-partner-workspace/partner-saved-month.cjs");
const {projectCombinedMonth}=require("../functions-partner-workspace/combined-saved-month-ranking.cjs");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const service=fs.readFileSync(path.join(__dirname,"..","functions-partner-workspace","service.cjs"),"utf8");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const counts=n=>Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?n:0]));
function savedFor(companyId,score){
 const row={companyId,hubCompanyId:"hub",date:"2026-11-06",staffId:"managed-person",
  staffNameSnapshot:"田中",teamIdSnapshot:"team-a",counts:counts(score),
  totalCount:score,version:1,revenue:999999,unitPrice:999999};
 return projectSavedPartnerMonth({hubId:"hub",partnerId:companyId,month:"2026-11",
  rows:[{id:row.date+"__"+row.staffId,data:()=>structuredClone(row)}],
  categoryKeys:KEYS,teamNames:{"team-a":"第1班"},role:"hub"});
}
test("Owner company navigation is grouped, lazy, and retains exact old month-count API",()=>{
 const begin=html.indexOf("async function loadOwnerPartnerCompanyTeams(){");
 const end=html.indexOf("async function showPartnerInviteAtMain(",begin);
 assert(begin>0&&end>begin);
 const owner=html.slice(begin,end);
 assert.match(owner,/const card=document\.createElement\("details"\)/);
 assert.match(owner,/summary\.textContent=company\.name/);
 assert.match(owner,/target\.append\(card\)/);
 assert.match(owner,/card\.append\(button\)/);
 assert.match(owner,/loadOwnerPartnerSavedMonth\(company\.partnerCompanyId,company\.name\)/);
 assert.doesNotMatch(owner,/\b(?:setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|\.innerHTML\s*=)\b/);
 assert.match(html,/readPartnerSavedMonth\(\{month,partnerCompanyId:companyId\}\)/);
 assert.match(html,/partnerSavedMonthCheckTotals\(data,keys\)/);
});
test("published product toggles use one Owner-only list, server revision guard, and fail closed",()=>{
 const start=html.indexOf("function renderOwnerCatalogPublicationRows(){");
 const end=html.indexOf("function ownerCatalogReset(){",start);
 assert(start>0&&end>start);
 const list=html.slice(start,end);
 assert.match(html,/id="ownerPublishedCatalogList"/);
 assert.match(list,/!auth\.currentUser\|\|!isCurrentCompanyOwner\(\)/);
 assert.match(list,/companyKind==="partner"/);
 assert.match(list,/!ownerCatalogState\.verified/);
 assert.match(list,/toggle\.disabled=!ownerCatalogState\.verified\|\|ownerCatalogState\.busy/);
 assert.match(list,/ownerCatalogToggle\(product\.id,toggle\.checked\)/);
 assert.doesNotMatch(list,/\b(?:getDoc|getDocs|setDoc|updateDoc|deleteDoc)\s*\(|innerHTML|\bprice\b|revenue|unitPrice|cashback/i);
 assert.match(html,/function renderProducts\(\) \{\s*renderOwnerCatalogPublicationRows\(\)/);
 assert.match(html,/const changed=\(await setPartnerPublishedProduct\(\{/);
 assert.match(html,/await ownerCatalogRefresh\(\)/);
});
test("managed partner staff is present in the existing server save model",()=>{
 assert.match(service,/if\(op==="addManaged"\)/);
 assert.match(service,/kind:"managed",role:"member",uid:null/);
 assert.match(service,/tx\.create\(ref,\{name:clean\(d\.name\)/);
});
test("same-named e-mail-less partner people remain separate in combined ranking without money",()=>{
 const p1=savedFor("partner-a",3),p2=savedFor("partner-b",2);
 assert.equal(p1.people.length,1);assert.equal(p2.people.length,1);
 assert.equal(p1.people[0].name,"田中");
 assert.equal(p1.people[0].totalCount,3);
 const merged=projectCombinedMonth({
  month:"2026-11",hubId:"hub",keys:KEYS,
  direct:{totalCount:0,otherCount:0,recordsVerified:0,peopleVerified:true,
   counts:counts(0),people:[],teams:[]},
  partners:[{id:"partner-a",name:"協力店A",data:p1},
   {id:"partner-b",name:"協力店B",data:p2}]
 });
 assert.equal(merged.partnerTotal,5);assert.equal(merged.grandTotal,5);
 assert.deepEqual(merged.people.map(x=>x.totalCount),[3,2]);
 assert.deepEqual(merged.people.map(x=>x.rank),[1,2]);
 assert.equal(new Set(merged.people.map(x=>x.key)).size,2);
 assert.equal(merged.people.every(p=>p.kind==="partner"),true);
 assert.doesNotMatch(JSON.stringify(merged),/unitPrice|totalRevenue|cashback|999999/);
 assert.equal(merged.productionDocumentWrites,0);
});
test("incorrect source count must fail instead of publishing a wrong individual ranking",()=>{
 const broken={companyId:"partner-a",hubCompanyId:"hub",date:"2026-11-06",
  staffId:"managed-person",staffNameSnapshot:"田中",teamIdSnapshot:"team-a",
  counts:counts(3),totalCount:4};
 assert.throws(()=>projectSavedPartnerMonth({
  hubId:"hub",partnerId:"partner-a",month:"2026-11",
  rows:[{id:"2026-11-06__managed-person",data:()=>broken}],
  categoryKeys:KEYS,role:"hub"
 }),/PARTNER_SAVED_MONTH_UNVERIFIED/);
});
