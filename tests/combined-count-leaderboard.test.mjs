import test from "node:test";
import assert from "node:assert/strict";
import {buildCombinedCountLeaderboard} from "../ranking/combined-count-leaderboard.mjs";
const TIME="2026-10-29T01:00:00Z",MONTH="2026-10";
const record=(c,id,uid,t,n)=>({companyId:c,sourceId:id,uid,date:"2026-10-29",teamId:t,totalCount:n,reportStatus:n?"submitted":"no_result",memberNameSnapshot:"担当"+uid,teamNameSnapshot:"班"+t,workLocation:"会場"});
const line=(c,r,p,n,i=0)=>({companyId:c,recordId:r.sourceId,sourceId:r.sourceId+"__"+String(i).padStart(4,"0"),date:r.date,uid:r.uid,teamId:r.teamId,productId:p,count:n});
const product=(c,id,name)=>({companyId:c,sourceId:id,name,active:true,sortOrder:1});
function make(){
 const a=record("own","a1","u1","t1",3),b=record("own","a2","u2","t2",2),c=record("partner","b1","p1","pteam",4);
 return {hubCompanyId:"own",approvedCompanyIds:["own","partner"],period:MONTH,
 productGroups:[
  {companyId:"own",productId:"nuro-a",groupId:"nuro",groupName:"NURO"},
  {companyId:"partner",productId:"fiber",groupId:"nuro",groupName:"NURO"},
  {companyId:"own",productId:"energy",groupId:"power",groupName:"電気"}
 ],
 sources:[
 {companyId:"own",companyLabel:"自社",kind:"own",consentVerified:true,isComplete:true,readTime:TIME,
  teams:[{id:"t1",name:"一班",goalCount:5},{id:"t2",name:"二班",goalCount:5}],
  records:[a,b],lines:[line("own",a,"nuro-a",2),line("own",a,"energy",1,1),line("own",b,"nuro-a",2)],
  products:[product("own","nuro-a","光"),product("own","energy","電気")]},
 {companyId:"partner",companyLabel:"協力店",kind:"partner",consentVerified:true,isComplete:true,readTime:TIME,
  teams:[{id:"pteam",name:"協力店一班",goalCount:6}],records:[c],
  lines:[line("partner",c,"fiber",4)],products:[product("partner","fiber","光")]}
 ]};
}
const go=o=>buildCombinedCountLeaderboard(o);
test("own+partner total, team counts and canonical SKU are combined; individual count hidden",()=>{
 const original=make(),before=JSON.stringify(original),r=go(original);
 assert.equal(r.combinedCount,9);assert.equal(r.combinedGoalCount,16);assert.equal(r.companyCount,2);
 assert.deepEqual(r.teamCountRanking.map(x=>[x.name,x.count,x.rank]),[
  ["協力店一班",4,1],["一班",3,2],["二班",2,3]]);
 assert.deepEqual(r.productCountRanking.map(x=>[x.name,x.count]),[["NURO",8],["電気",1]]);
 assert.equal(r.readTime,TIME);assert.equal(r.needsProductMapping,false);
 assert.equal(r.individualRankOnly.length,3);
 assert(r.individualRankOnly.every(x=>!["count","revenue","score","amount"].some(k=>k in x)));
 assert(r.productCountRanking.every(x=>x.individual.every(p=>!["count","revenue","score"].some(k=>k in p))));
 assert.equal(JSON.stringify(original),before,"must not rewrite historical record");
});
test("same uid in separate companies does not merge different people",()=>{
 const d=make();d.sources[1].records[0].uid="u1";d.sources[1].lines[0].uid="u1";
 assert.equal(go(d).individualRankOnly.length,3);
});
test("unmapped products remain separate but all contracts still total",()=>{
 const d=make();d.productGroups=[];d.sources[1].products[0].name="光";
 const r=go(d);assert.equal(r.combinedCount,9);assert.equal(r.productCountRanking.length,3);
 assert.equal(r.productCountRanking.reduce((s,x)=>s+x.count,0),9);
 assert.equal(r.unmappedProducts,3);
});
test("unapproved, partial, missing or inconsistent partner snapshots fail closed",()=>{
 for(const change of [
 d=>{d.sources[1].consentVerified=false;},
 d=>{d.sources[1].isComplete=false;},
 d=>{d.sources.pop();},
 d=>{d.sources[1].readTime="2026-10-29T01:00:01Z";},
 d=>{d.approvedCompanyIds.push("other");},
 d=>{d.sources[1].kind="own";},
 d=>{d.sources[1].companyId="unknown";}
 ]){const d=make();change(d);assert.throws(()=>go(d),/Incomplete or unauthorized/);}
});
test("impossible record dates and timestamps stop the entire combined ranking",()=>{
 for(const invalid of [
  "2026-10-32","2026-10-00","2026-10-29-extra",
  "2026-02-29","2026-11-01"
 ]){
  const data=make();
  data.sources[0].records[0].date=invalid;
  data.sources[0].lines[0].date=invalid;
  data.sources[0].lines[1].date=invalid;
  assert.throws(()=>go(data),/Incomplete or unauthorized/,
   "reject invalid or other-month record date: "+invalid);
 }
 for(const invalid of [
  "2026-10-32T01:00:00Z","2026-02-29T01:00:00Z",
  "2026-10-29T24:00:00Z","2026-10-29T01:60:00Z",
  "2026-10-29T01:00:60Z"
 ]){
  const data=make();
  for(const source of data.sources)source.readTime=invalid;
  assert.throws(()=>go(data),/Incomplete or unauthorized/,
   "reject untrustworthy snapshot timestamp: "+invalid);
 }
 const valid=make();
 for(const source of valid.sources)source.readTime="2024-02-29T23:59:59.123456789Z";
 assert.equal(go(valid).combinedCount,9,
  "valid leap-day nanosecond precision is still supported");
});

test("missing, duplicate, unauthorized, mismatched and financial rows are rejected",()=>{
 for(const change of [
 d=>{d.sources[0].lines.pop();},
 d=>{d.sources[0].lines.push(d.sources[0].lines[0]);},
 d=>{d.sources[0].records.push(d.sources[0].records[0]);},
 d=>{d.sources[0].records[0].totalCount=5;},
 d=>{d.sources[1].lines[0].companyId="other";},
 d=>{d.sources[0].lines[0].uid="wrong";},
 d=>{d.sources[0].records[0].teamId="";},
 d=>{d.sources[0].records[0].date="2026-09-29";},
 d=>{d.sources[0].lines[0].productId="not-found";},
 d=>{d.sources[0].records[0].totalRevenue=90000;}
 ]){const d=make();change(d);assert.throws(()=>go(d),/Incomplete|schema mismatch/);}
});
test("changing current team does not reassign past record and missing goal is explicit",()=>{
 const d=make(),r=d.sources[0].records[0];
 r.teamId="old";r.teamNameSnapshot="過去の班";
 d.sources[0].lines[0].teamId="old";d.sources[0].lines[1].teamId="old";
 const out=go(d);
 assert.equal(out.teamCountRanking.find(t=>t.teamId==="old").count,3);
 assert.equal(out.combinedGoalCount,null);assert.equal(out.targetComplete,false);
});
test("zero goal and unknown goal do not invent progress",()=>{
 const d=make();d.sources[1].teams[0].goalCount=null;d.sources[0].teams[1].goalCount=0;
 const r=go(d);assert.equal(r.combinedCount,9);assert.equal(r.combinedGoalCount,null);
 assert.equal(r.teamProgressRanking.length,1);
});
test("ties share rank one and lion crown; no contracts produces no winner",()=>{
 const d=make();d.sources[0].records[0].totalCount=4;d.sources[0].lines[0].count=3;
 d.sources[0].records[1].totalCount=0;d.sources[0].records[1].reportStatus="no_result";
 d.sources[0].lines=d.sources[0].lines.filter(x=>x.recordId!=="a2");
 const r=go(d);
 assert.deepEqual(r.teamCountRanking.map(x=>x.rank),[1,1,3]);
 assert.deepEqual(r.teamCountRanking.map(x=>x.champion),[true,true,false]);
 const e=make();for(const s of e.sources){s.lines=[];s.records.forEach(x=>{x.totalCount=0;x.reportStatus="no_result";});}
 assert(go(e).teamCountRanking.every(x=>!x.champion));
});
test("financial text and embedded raw monetary fields never reach a rank",()=>{
 const d=make();d.sources[0].teams[0].name="CB20000チーム";assert.throws(()=>go(d),/Incomplete/);
 const e=make();e.sources[0].lines[0].revenuePerUnit=20000;assert.throws(()=>go(e),/schema mismatch/);
 const f=make();f.sources[1].products[0].name="2万円商品";assert.throws(()=>go(f),/schema mismatch|monetary/);
});
test("2,101 records do not trigger the previous 2,000-document boundary",()=>{
 const d=make();d.approvedCompanyIds=["own"];d.sources=d.sources.slice(0,1);
 d.productGroups=d.productGroups.filter(x=>x.companyId==="own");
 const s=d.sources[0];s.records=[];s.lines=[];
 for(let i=0;i<2101;i++){
   const r=record("own","a"+String(i).padStart(5,"0"),"person","t1",1);
   s.records.push(r);s.lines.push(line("own",r,"nuro-a",1));
 }
 const out=go(d);assert.equal(out.combinedCount,2101);
 assert.equal(out.productCountRanking.find(x=>x.id==="nuro").count,2101);
 assert.equal(out.individualRankOnly.length,1);
 assert(!("count" in out.individualRankOnly[0]));
});

test("125 fully approved companies rank all reports without truncating the 101st company",()=>{
 const d=make();
 const original=JSON.stringify(d);
 for(let n=2;n<125;n++){
  const id="partner_"+n,recordId="r_"+n,productId="sku_"+n;
  const r=record(id,recordId,"uid_"+n,"team_"+n,1);
  d.approvedCompanyIds.push(id);
  d.sources.push({companyId:id,companyLabel:"協力店"+n,kind:"partner",
   consentVerified:true,isComplete:true,readTime:TIME,
   teams:[{id:"team_"+n,name:"班"+n,goalCount:2}],
   records:[r],lines:[line(id,r,productId,1)],
   products:[product(id,productId,"品目"+n)]});
 }
 assert.equal(d.sources.length,125);
 const result=go(d);
 assert.equal(result.companyCount,125);
 assert.equal(result.combinedCount,132); // Original 9 + 123 authenticated company reports
 assert.equal(result.teamCountRanking.length,126); // Two direct teams + 124 partner teams
 assert.equal(result.individualRankOnly.length,126); // Original 3 people + 123
 assert.equal(result.productCountRanking.reduce((n,row)=>n+row.count,0),132);
 assert.equal(result.teamCountRanking.some(row=>row.companyId==="partner_124"),true);
 assert.equal(result.needsProductMapping,true);
 assert.doesNotMatch(JSON.stringify(result),/totalRevenue|revenuePerUnit|unitPrice|cashback|price/i);
 assert.equal(JSON.stringify(make()),original);
});

test("missing approved 101st company, 126th company, stale or unapproved source fail closed",()=>{
 const fixture=()=>{
  const d=make();
  for(let n=2;n<125;n++){
   const id="partner_"+n;
   d.approvedCompanyIds.push(id);
   d.sources.push({companyId:id,companyLabel:"協力店"+n,kind:"partner",
    consentVerified:true,isComplete:true,readTime:TIME,
    teams:[],records:[],lines:[],products:[]});
  }
  return d;
 };
 const missing=fixture();
 missing.sources.splice(100,1);
 assert.throws(()=>go(missing),/Incomplete or unauthorized/);
 const extra=fixture();
 extra.approvedCompanyIds.push("partner_125");
 extra.sources.push({companyId:"partner_125",companyLabel:"協力店126",
  kind:"partner",consentVerified:true,isComplete:true,readTime:TIME,
  teams:[],records:[],lines:[],products:[]});
 assert.throws(()=>go(extra),/Incomplete or unauthorized/);
 const revoked=fixture();revoked.sources[100].consentVerified=false;
 assert.throws(()=>go(revoked),/Incomplete or unauthorized/);
 const inconsistent=fixture();inconsistent.sources[100].readTime="2026-10-29T01:00:01Z";
 assert.throws(()=>go(inconsistent),/Incomplete or unauthorized/);
});

test("global ranking document budgets reject unsafe large snapshots before processing",()=>{
 for(const [key,limit] of [["records",25000],["lines",50000],
   ["teams",5000],["products",8000]]){
  const d=make();
  d.sources[0][key]=Array(limit+1).fill(null);
  assert.throws(()=>go(d),/Incomplete or unauthorized/,key+" requires global budget");
 }
 const d=make();
 d.sources[0].records=Array(20000).fill(null);
 d.sources[1].records=Array(5001).fill(null);
 assert.throws(()=>go(d),/Incomplete or unauthorized/);
});
