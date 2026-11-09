import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../staging/owner-count-readonly-v1/owner-partner-counts-readonly.html",import.meta.url),"utf8");
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert(script,"Owner count-only page must contain a single ES module");
const sanitized=script.replace(/^import\s+\{[^\n]+\}\s+from\s+"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+";\s*$/gm,"");
function parser(){
 const element={value:"2026-11-09",replaceChildren(){},textContent:"",hidden:false};
 const sandbox={
  initializeApp:()=>({}),getAuth:()=>({currentUser:null}),
  getFunctions:()=>({}),httpsCallable:()=>async()=>{throw Error("NO_NETWORK_IN_TEST")},
  onAuthStateChanged:()=>()=>{},
  document:{getElementById:()=>({...element})},
  Intl,Date,Object,Number,Array,Map,Set,Error,String,console
 };
 vm.runInNewContext(sanitized+"\n;globalThis.__unit={parseCompanies,parseEntries};",sandbox,{timeout:1000});
 return sandbox.__unit;
}
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const COUNT=Object.fromEntries(KEYS.map(x=>[x,x==="NURO"?1:x==="SB光・AIR"?3:0]));
const validCompanies={
 role:"hub",date:"2026-11-09",partners:[],
 registeredCompanies:[{partnerCompanyId:"partner_1",name:"協力店 A",active:true,
  teams:[{id:"team_1",name:"チーム A"}]}],
 categories:KEYS
};
const validList={
 role:"hub",scope:"existing-partner-counts-only",date:"2026-11-09",
 partnerCompanyId:"partner_1",sbBreakdownSchema:"sb-separated-v1",
 containsFinance:false,entries:[{
  staffId:"staff_1",staffName:"担当者 A",teamIdSnapshot:"team_1",
  counts:COUNT,totalCount:4,version:1,
  sbBreakdown:{"SB光":1,"SB AIR":1,"旧未分類":1}
 }]
};
test("standalone page uses existing Firebase Auth session + exact scoped two read-only callables",()=>{
 assert.match(html,/getAuth\(app\)/);
 assert.match(html,/httpsCallable\(functions,"getPartnerWorkspace"/);
 assert.match(html,/httpsCallable\(functions,"listHubPartnerCounts"/);
 assert.doesNotMatch(html,/httpsCallable\(functions,"correctHubPartnerCounts"/);
 assert.doesNotMatch(html,/\b(?:setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|signInWithEmailAndPassword|createUserWithEmailAndPassword|signOut)\s*\(/);
 assert.doesNotMatch(html,/<input[^>]*(?:type="number"|name="counts")/i);
 assert.match(html,/onAuthStateChanged\(auth,next=>/);
 assert.match(html,/const stamp=\+\+seq/);
 assert.match(html,/auth\.currentUser!==person/);
 assert.match(html,/textContent=String\(value\)/);
});
test("company selection is only from verified Owner scope and preserves active status",()=>{
 const {parseCompanies}=parser();
 const rows=parseCompanies(validCompanies,"2026-11-09");
 assert.equal(rows.length,1);
 assert.equal(rows[0].id,"partner_1");
 assert.equal(rows[0].teams.get("team_1"),"チーム A");
 assert.throws(()=>parseCompanies({...validCompanies,role:"partner"},"2026-11-09"));
 assert.throws(()=>parseCompanies({...validCompanies,date:"2026-11-08"},"2026-11-09"));
 assert.throws(()=>parseCompanies({...validCompanies,revenue:400000},"2026-11-09"));
 assert.throws(()=>parseCompanies({...validCompanies,registeredCompanies:[...validCompanies.registeredCompanies,...validCompanies.registeredCompanies]},"2026-11-09"));
});
test("valid individual count and SB split remain precise without auto reclassification",()=>{
 const {parseEntries}=parser();
 const entries=parseEntries(validList,{id:"partner_1",date:"2026-11-09"});
 assert.equal(entries.length,1);assert.equal(entries[0].total,4);
 assert.equal(entries[0].sb["旧未分類"],1);
 const unknown={...validList,entries:[{...validList.entries[0],sbBreakdown:null}]};
 assert.equal(parseEntries(unknown,{id:"partner_1",date:"2026-11-09"})[0].sb["旧未分類"],3);
});
test("large safe individual totals across distinct products are not wrongly treated as invalid",()=>{
 const {parseEntries}=parser();
 const high={...validList,entries:[{
  ...validList.entries[0],
  counts:{...COUNT,"SBMNP":9999,"YMMNP":9999},
  totalCount:20002
 }]};
 assert.equal(parseEntries(high,{id:"partner_1",date:"2026-11-09"})[0].total,20002);
});
test("finance fields, invented totals, wrong partner scope and missing version fail closed",()=>{
 const {parseEntries}=parser();
 for(const invalid of [
  {...validList,unitPrice:10000},
  {...validList,containsFinance:true},
  {...validList,partnerCompanyId:"partner_2"},
  {...validList,entries:validList.entries.map(x=>({...x,totalCount:5}))},
  {...validList,entries:validList.entries.map(x=>({...x,version:null}))},
  {...validList,entries:validList.entries.map(x=>({...x,counts:{...COUNT,profit:5000}}))},
  {...validList,entries:validList.entries.map(x=>({...x,staffName:"10000円"}))},
  {...validList,entries:validList.entries.map(x=>({...x,sbBreakdown:{"SB光":3,"SB AIR":3,"旧未分類":1}}))},
  {...validList,entries:[...validList.entries,...validList.entries]}
 ])assert.throws(()=>parseEntries(invalid,{id:"partner_1",date:"2026-11-09"}));
});
test("no count records or owner permissions changed, page has NO old portal override",()=>{
 assert(!html.includes("firebase.firestore"));
 assert(!html.includes("ownerUid="));
 assert(!html.includes('method:"POST"'));
 assert(!html.includes('correctionReason'));
 assert(!html.includes('window.localStorage'));
 assert(!html.includes('window.sessionStorage'));
 assert(!html.includes("eval("));
 assert.match(html,/件数の訂正・招待・商材公開設定は実行できません/);
 assert.match(html,/未報告と0件は別/);
});
