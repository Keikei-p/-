import test from "node:test";
import assert from "node:assert/strict";
import {
 buildPartnerUnifiedCountTeamView as view,PARTNER_DAY_PRODUCT_KEYS as PRODUCTS
} from "../ranking/partner-unified-count-team-view.mjs";
const blank=()=>Object.fromEntries(PRODUCTS.map(key=>[key,0]));
function fixture(){
 return {role:"leader",companyName:"協力店A",date:"2026-11-18",teamId:"t1",
  categories:[...PRODUCTS],enabledCategories:["NURO","SB光・AIR"],
  teams:[{id:"t1",name:"1班",active:true},{id:"t2",name:"2班",active:true},
   {id:"t3",name:"3班",active:false}],
  staff:[
   {id:"a",name:"Aさん",teamId:"t2",active:true,uid:null},
   {id:"b",name:"Bさん",teamId:"t1",active:true,uid:null},
   {id:"c",name:"Cさん",teamId:"t1",active:true,uid:null},
   {id:"d",name:"Dさん",teamId:"t3",active:false,uid:null},
   {id:"old",name:"旧担当者",teamId:null,active:false,uid:null}
  ],
  records:[
   {staffId:"a",teamIdSnapshot:"t1",counts:{...blank(),NURO:5},
    totalCount:5,version:2,privateCounts:{private1:2},workLocation:"非公開現場"},
   {staffId:"b",teamIdSnapshot:"t1",counts:blank(),
    totalCount:0,version:1,cbCounts:{NURO:{"20000":0}}},
   {staffId:"d",teamIdSnapshot:"t3",counts:{...blank(),"SB光・AIR":4},
    totalCount:4,version:4},
   {staffId:"old",teamIdSnapshot:"old_team",counts:{...blank(),NURO:3},
    totalCount:3,version:3}
  ],
  privateProducts:[{id:"private1",name:"非公開商材",active:true}],
  internalFinance:{price:7777777}
 };
}
const reject=fn=>assert.throws(fn,/PARTNER_UNIFIED_TEAM_COUNT_SNAPSHOT_UNVERIFIED/);
test("preserves original and builds same company/班/人 hierarchy from count-only fields",()=>{
 const source=fixture(),original=structuredClone(source);
 const output=view(source);
 assert.equal(output.companyName,"協力店A");
 assert.equal(output.companyTotalCount,12);
 const team1=output.teamDetails.find(t=>t.id==="t1");
 assert.equal(team1.totalCount,5);
 assert.equal(team1.name,"1班");
 assert.equal(team1.reportedMemberCount,2);
 assert.equal(team1.currentMemberCount,2);
 assert.equal(team1.missingMemberCount,1); // A moved to t2; C is still unreported
 assert.equal(team1.counts.NURO,5);
 assert.deepEqual(team1.members.filter(m=>m.reported).map(m=>m.count),[5,0]);
 assert.equal(team1.members.find(m=>m.id==="c").count,null);
 assert.equal(team1.members.find(m=>m.id==="c").reported,false);
 assert.equal(team1.members.find(m=>m.id==="a").count,5);
 assert.equal(output.teamDetails.find(t=>t.id==="t2").totalCount,0);
 assert.equal(output.teamDetails.find(t=>t.id==="t2").reportStatus,"not_reported");
 assert.equal(output.teamDetails.find(t=>t.id==="t3").totalCount,4);
 assert.equal(output.historicalUnassigned[0].totalCount,3);
 assert.equal(output.historicalUnassigned[0].members[0].name,"旧担当者");
 assert.equal(output.reportedCount,4);
 assert.deepEqual(source,original);
});
test("OFF product is masked by server and never presented or zeroed on original",()=>{
 const source=fixture();
 const historical=structuredClone(source);
 const out=view(source);
 assert.deepEqual(out.activeInputCategories,["NURO","SB光・AIR"]);
 assert.deepEqual(Object.keys(out.teamDetails[0].counts),["NURO","SB光・AIR"]);
 assert.equal(out.financeIncluded,false);
 assert.equal(out.financialReads,0);
 assert.equal(out.firestoreWrites,0);
 assert.deepEqual(source,historical);
 source.records[0].counts.SBMNP=1; // backend failed to zero-mask OFF value
 reject(()=>view(source));
});
test("never expose private products, location, uid, price, CB or unknown original data",()=>{
 const source=fixture(),out=JSON.stringify(view(source));
 for(const forbidden of ["private1","非公開現場","非公開商材",
  "internalFinance","7777777","20000","cbCounts","unitPrice",
  "revenue","cashback","uid","workLocation"])
  assert.equal(out.includes(forbidden),false,forbidden);
});
test("0件の報告 and 未報告 remain different, past inactive member count retained",()=>{
 const out=view(fixture());
 const first=out.teamDetails[0];
 assert.equal(first.members.find(m=>m.id==="b").reported,true);
 assert.equal(first.members.find(m=>m.id==="b").count,0);
 assert.equal(first.members.find(m=>m.id==="c").reported,false);
 assert.equal(first.members.find(m=>m.id==="c").count,null);
 const past=out.teamDetails.find(t=>t.id==="t3");
 assert.equal(past.active,false);
 assert.equal(past.members[0].count,4);
});
test("identical names are not merged and current team changes do not move old counts",()=>{
 const x=fixture();x.staff[1].name="Aさん";
 const out=view(x);
 const group=out.teamDetails.find(t=>t.id==="t1");
 assert.equal(group.members.filter(m=>m.name==="Aさん").length,2);
 assert.equal(group.totalCount,5);
});
test("unknown historical team stays unallocated, never assigned to current roster",()=>{
 const x=fixture();x.records[0].teamIdSnapshot="old_team";
 const out=view(x);
 assert.equal(out.teamDetails.find(t=>t.id==="t1").totalCount,0);
 assert.equal(out.teamDetails.find(t=>t.id==="t2").totalCount,0);
 assert.equal(out.historicalUnassigned[0].totalCount,8);
 assert.equal(out.companyTotalCount,12);
});
test("missing backend allowlist and malformed counts must fail closed",()=>{
 const x=fixture();delete x.enabledCategories;reject(()=>view(x));
 const y=fixture();y.records[0].totalCount=6;reject(()=>view(y));
 const z=fixture();z.records.push({...z.records[0]});reject(()=>view(z));
 const bad=fixture();bad.records[0].counts={NURO:5};reject(()=>view(bad));
 const missing=fixture();missing.records[0].staffId="forged";reject(()=>view(missing));
 const dup=fixture();dup.enabledCategories=["NURO","NURO"];reject(()=>view(dup));
 const badDate=fixture();badDate.date="2026-11-31";reject(()=>view(badDate));
});
test("no price or currency in company/member display names",()=>{
 const x=fixture();x.staff[0].name="売上 10万円";reject(()=>view(x));
 const y=fixture();y.teams[0].name="単価2000円";reject(()=>view(y));
 const z=fixture();z.companyName="営業 A@B";reject(()=>view(z));
});
test("all three public aggregate invariants must match, no sum of old private SKU",()=>{
 const x=fixture();const out=view(x);
 const teamSum=out.teamDetails.reduce((a,b)=>a+b.totalCount,0);
 const unknownSum=out.historicalUnassigned.reduce((a,b)=>a+b.totalCount,0);
 assert.equal(out.companyTotalCount,teamSum+unknownSum);
 assert.equal(out.companyTotalCount,12);
 assert.equal(JSON.stringify(out).includes("privateTotalCount"),false);
});
