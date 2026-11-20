import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {buildApprovedPartnerCountStandings,KEYS}=
 require("../functions-partner-workspace/shared-count-standings.cjs");
import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const backend=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const i=page.indexOf("function approvedRankingDateRange("),
 j=page.indexOf("async function loadApprovedCountRanking(){",i);
assert(i>0&&j>i,"reviewed ranking date range calculator missing");
const src=page.slice(i,j);
const scope=vm.createContext({Date});
vm.runInContext(src,scope);
const range=(month,period,selected,today)=>JSON.parse(
 JSON.stringify(scope.approvedRankingDateRange(month,period,selected,today)));
test("current month stops at JST today; past month includes its final day",()=>{
 assert.deepEqual(range("2026-11","month","2026-11-07","2026-11-19"),{
  date:"2026-11-19",start:"2026-11-01",end:"2026-11-19",period:"month"});
 assert.deepEqual(range("2026-10","month","2026-10-03","2026-11-19"),{
  date:"2026-10-31",start:"2026-10-01",end:"2026-10-31",period:"month"});
});
test("Mon-Sun week crosses month boundary without losing earlier month's saved counts",()=>{
 assert.deepEqual(range("2026-11","week","2026-11-01","2026-11-19"),{
  date:"2026-11-01",start:"2026-10-26",end:"2026-11-01",period:"week"});
 assert.deepEqual(range("2026-01","week","2026-01-01","2026-11-19"),{
  date:"2026-01-01",start:"2025-12-29",end:"2026-01-04",period:"week"});
});
test("current unfinished week only counts through current JST day",()=>{
 assert.deepEqual(range("2026-11","week","2026-11-19","2026-11-19"),{
  date:"2026-11-19",start:"2026-11-16",end:"2026-11-19",period:"week"});
 assert.deepEqual(range("2026-11","day","2026-11-19","2026-11-19"),{
  date:"2026-11-19",start:"2026-11-19",end:"2026-11-19",period:"day"});
});
test("future, non-existent day, wrong month, unknown mode fail closed",()=>{
 for(const args of [
  ["2026-11","week","2026-11-20","2026-11-19"],
  ["2026-11","day","2026-10-31","2026-11-19"],
  ["2026-02","week","2026-02-31","2026-11-19"],
  ["2026-11","year","2026-11-19","2026-11-19"],
  ["2026-13","month","2026-11-19","2026-11-19"],
  ["2026-12","month","2026-12-01","2026-11-19"]
 ])assert.throws(()=>range(...args));
});
test("existing server accepts day/week/month and client preserves financial denial + disabled switches",()=>{
 assert.match(backend,/!\["day","week","month"\]\.includes\(period\)/);
 assert.match(page,/id="approvedSharedRankPeriod"[^>]*>[^<]*<option value="month">月別<\/option><option value="week">週別<\/option><option value="day">日別<\/option>/);
 assert.match(page,/const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;/);
 assert.match(page,/const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;/);
 assert.match(page,/approvedRankData=null;[\s\S]*?let range;[\s\S]*?approvedRankingDateRange\(/);
 assert.match(page,/verifyApprovedCountRanking\(value,start,end\)/);
 assert.match(page,/activeCodeSession!==session\|\|workspaceCompanyId!==company\)return/);
 assert.doesNotMatch(src,/\b(getDoc|setDoc|runTransaction|updateDoc|deleteDoc|revenueGoals|unitPrice)\b/);
});

const verifierStart=page.indexOf("function verifyApprovedCountRanking(");
const verifierEnd=page.indexOf("\nfunction ",verifierStart+20);
assert(verifierStart>0&&verifierEnd>verifierStart,"count-only ranking verifier missing");
const verifyApprovedRank=vm.runInNewContext(page.slice(verifierStart,verifierEnd)+
 "\nverifyApprovedCountRanking",{KEYS});
function serverCountRank({visible=2,privateCount=0}={}){
 const date="2026-11-20",cid="partner-a",hubId="hub-a",uid="staff-a";
 const counts=Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?visible:0]));
 const entry={companyId:cid,hubCompanyId:hubId,date,staffId:uid,
  teamIdSnapshot:"team-a",staffNameSnapshot:"担当者A",version:1,
  counts,totalCount:visible,
  ...(privateCount?{privateCounts:{oldSku:privateCount},
    privateTotalCount:privateCount}:{})};
 return {role:"partner",date,period:"day",
  ...buildApprovedPartnerCountStandings({hubId,start:date,end:date,
   sources:[{cid,name:"協力店A",approved:true,
    allowedCategories:["NURO"],teams:[{id:"team-a",name:"1班"}],
    entries:[{id:date+"__"+uid,data:entry}],
    reports:[{date,data:{hubCompanyId:hubId,partnerCompanyId:cid,
     date,source:"staff-entries-v1",counts,totalCount:visible}}]}]})};
}
test("actual server count flags pass the count-only client verifier for both clean and legacy SKU cases",()=>{
 const date="2026-11-20";
 const clean=serverCountRank();
 assert.equal(verifyApprovedRank(clean,date,date),clean);
 const privateOnly=serverCountRank({visible:0,privateCount:5});
 assert.equal(privateOnly.unreportedCompanies[0].status,"legacy_mapping_pending");
 assert.equal(verifyApprovedRank(privateOnly,date,date),privateOnly);
 assert.equal(privateOnly.legacyPrivateCountMappingPending,true);
});
test("unmapped private totals cannot be falsely advertised as complete; money and forged flags remain blocked",()=>{
 const date="2026-11-20",payload=serverCountRank({visible:2,privateCount:5});
 assert.throws(()=>verifyApprovedRank({...payload,unitPrice:50000},date,date),
  /UNVERIFIED_APPROVED_COUNT_KEY/);
 assert.throws(()=>verifyApprovedRank({...payload,
  legacyPrivateCountMappingPending:"false"},date,date),
  /UNVERIFIED_APPROVED_COUNT_RANK/);
 assert.throws(()=>verifyApprovedRank({...payload,partnerCountsComplete:true},date,date),
  /UNVERIFIED_APPROVED_COUNT_RANK/);
 assert.throws(()=>verifyApprovedRank({...payload,
  unreportedCompanies:[{key:"x",name:"協力店A",status:"unknown"}]},date,date),
  /UNVERIFIED_APPROVED_COUNT_RANK/);
});
