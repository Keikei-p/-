import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../staging/owner-staff-count-readonly-v1/owner-partner-admin.html",import.meta.url),"utf8");
const old=readFileSync(new URL("../staging/owner-workspace-errors-v1/owner-partner-admin.html",import.meta.url),"utf8");
const names=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const start=html.indexOf("function verifiedOwnerStaffCountRows(");
const end=html.indexOf("\nconst today=()=>",start);
assert(start>=0&&end>start);
const code=html.slice(start,end);
const evaluate=vm.runInNewContext(
 "const ZERO=()=>Object.fromEntries("+JSON.stringify(names)+".map(k=>[k,0]));\n"+
 "const ID=/^[A-Za-z0-9_-]{1,128}$/;\n"+
 "const cleanCount=x=>Number.isSafeInteger(x)&&x>=0?x:null;\n"+
 code+"\nverifiedOwnerStaffCountRows",
 {Error,Number,Array,Object,Set,RegExp});
const date="2026-11-09",company="partner_a";
function good(){
 const counts=Object.fromEntries(names.map(k=>[k,k==="NURO"?2:k==="U-NEXT"?1:0]));
 return {role:"hub",scope:"existing-partner-counts-only",
  date,partnerCompanyId:company,containsFinance:false,
  sbBreakdownSchema:"sb-separated-v1",
  entries:[{staffId:"staff_1",staffName:"営業 A",teamIdSnapshot:"team_1",
   counts,totalCount:3,version:2,sbBreakdown:{SB光:0,Air:0,旧未分類:0}}]};
}
test("server-verifiable exact count response is projected to finite, count-only staff fields",()=>{
 const value=evaluate(good(),date,company);
 const simplified=JSON.parse(JSON.stringify(value));
 assert.deepEqual(simplified,[{
  staffName:"営業 A",teamId:"team_1",
  counts:good().entries[0].counts,totalCount:3
 }]);
 assert.equal(JSON.stringify(simplified).includes("staffId"),false);
 assert.equal(JSON.stringify(simplified).includes("sbBreakdown"),false);
});
test("metadata mismatch, wrong company and finance extensions are rejected",()=>{
 for(const bad of [
  {...good(),role:"partner"},
  {...good(),date:"2026-11-08"},
  {...good(),partnerCompanyId:"other"},
  {...good(),containsFinance:true},
  {...good(),revenue:0},
  {...good(),sbBreakdownSchema:"unknown"},
  {...good(),entries:Array.from({length:201},()=>good().entries[0])}
 ]){
  assert.throws(()=>evaluate(bad,date,company),/STALE_OR_UNTRUSTED/);
 }
});
test("invalid individual count, staff labels, versions and stale duplicates are rejected",()=>{
 for(const broken of [
  {counts:{...good().entries[0].counts,NURO:-1}},
  {counts:{...good().entries[0].counts,NURO:2.4}},
  {counts:{...good().entries[0].counts,revenue:1000}},
  {totalCount:4},{version:0},{staffName:"売上 3円"},
  {staffName:"<img onerror=alert(1)>"},{staffId:"invalid/id"},
  {teamIdSnapshot:"team/id"}
 ]){
  const source=good(),first={...source.entries[0],...broken};
  source.entries=[first];
  if(broken.staffName==="<img onerror=alert(1)>"){
    // Text is rendered with textContent, so markup remains harmless;
    // the verifier need not refuse harmless text.
    assert.equal(evaluate(source,date,company)[0].staffName,broken.staffName);
  }else assert.throws(()=>evaluate(source,date,company),/STALE_OR_UNTRUSTED/);
 }
 const duplicate=good();duplicate.entries.push({...duplicate.entries[0]});
 assert.throws(()=>evaluate(duplicate,date,company),/STALE_OR_UNTRUSTED/);
});
test("zero is a reported staff row; missing entries remain unreported, never fabricated",()=>{
 const zero=good();zero.entries[0].counts=Object.fromEntries(names.map(k=>[k,0]));
 zero.entries[0].totalCount=0;
 assert.equal(evaluate(zero,date,company)[0].totalCount,0);
 const missing=good();missing.entries=[];
 assert.deepEqual(JSON.parse(JSON.stringify(evaluate(missing,date,company))),[]);
});
test("protected same-login Auth and count corrections stay OFF, response only safely painted",()=>{
 assert(html.includes("const HUB_OWNER_CORRECTION_READY=false"));
 assert(html.includes('getAuth(app)'));
 assert(html.includes('const listCall=httpsCallable(functions,"listHubPartnerCounts"'));
 assert(html.includes('listCall({date:day,partnerCompanyId:partnerId})'));
 assert(html.includes('currentCompany!==partnerId'));
 assert(html.includes('auth.currentUser!==current'));
 assert(html.includes('$("#staffCounts")')===false);
 assert(html.includes('card.append(make("strong",entry.staffName)'));
 assert(html.includes('Object.entries(entry.counts).filter(([,count])=>count>0)'));
 assert(html.includes("スタッフ別・商材別件数（閲覧専用）"));
 assert(html.includes("未報告を0件として扱いません"));
 assert.doesNotMatch(html,/(?:signInWithEmailAndPassword|createUserWithEmailAndPassword|setDoc|updateDoc|deleteDoc|writeBatch|localStorage|sessionStorage)\s*\(/);
 assert(old.includes("const HUB_OWNER_CORRECTION_READY=false"));
 assert(!old.includes("verifiedOwnerStaffCountRows"));
});
