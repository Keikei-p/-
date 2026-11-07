"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {
 makePartnerAdditionalOperations,isLegacyCategoryName
}=require("../functions-partner-workspace/partner-additional-operations.cjs");
const {normalizeExtraCounts,applyExtraCounts,projectedExtraRead}=
 require("../functions-partner-workspace/additional-counts.cjs");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
class Ref{
 constructor(db,p){this.db=db;this.path=p;this.id=p.split("/").at(-1);}
 collection(id){return new Query(this.db,this.path+"/"+id);}
 async get(){const v=this.db.rows.get(this.path);return {id:this.id,
  exists:v!==undefined,data:()=>v===undefined?undefined:structuredClone(v)};}
}
class Query{
 constructor(db,p,filters=[],limitN=Infinity){Object.assign(this,{db,p,filters,limitN});}
 doc(id){return new Ref(this.db,this.p+"/"+id);}
 where(k,op,v){return new Query(this.db,this.p,[...this.filters,[k,op,v]],this.limitN);}
 limit(n){return new Query(this.db,this.p,this.filters,n);}
 async get(){
  const docs=[...this.db.rows].filter(([p,x])=>
   p.startsWith(this.p+"/")&&!p.slice(this.p.length+1).includes("/")&&
   this.filters.every(([k,op,v])=>op==="=="?x[k]===v:
    op===">="?x[k]>=v:op==="<="?x[k]<=v:false))
   .slice(0,this.limitN).map(([p,x])=>({id:p.split("/").at(-1),data:()=>structuredClone(x)}));
  return {size:docs.length,docs};
 }
}
class DB{
 constructor(){this.rows=new Map();this.writes=[];}
 collection(id){return new Query(this,id);}
 put(path,data){this.rows.set(path,structuredClone(data));}
 async runTransaction(handler){
  const staged=[];
  const tx={get:ref=>ref.get(),create:(ref,data)=>staged.push(["create",ref.path,data]),
   update:(ref,data)=>staged.push(["update",ref.path,data])};
  const result=await handler(tx);
  for(const [op,path,v] of staged){
   if(op==="create"&&this.rows.has(path))throw Error("duplicate_create");
   if(op==="update"&&!this.rows.has(path))throw Error("missing_update");
   this.put(path,v);this.writes.push({op,path});
  }
  return result;
 }
}
class Err extends Error{constructor(code){super(code);this.code=code;}}
function seed(){
 const db=new DB();
 db.put("products/new",{companyId:"hub",name:"新商材X",active:true,
  sortOrder:10,revenuePerUnit:777777,price:999999});
 db.put("products/nuro",{companyId:"hub",name:"NURO光",active:true,
  sortOrder:1,revenuePerUnit:888888});
 db.put("companies/hub/partnerCatalogSettings/publication",{
  revision:1,productIds:["new","nuro"]});
 db.put("companies/partner/partnerWorkStaff/person",{companyId:"partner",
  name:"佐藤",teamId:"team",kind:"account",uid:"member",active:true});
 db.put("companies/partner/partnerWorkTeams/team",{companyId:"partner",
  name:"一班",active:true});
 const date="2026-11-06";
 db.put("companies/partner/partnerWorkEntries/"+date+"__person",{
  companyId:"partner",hubCompanyId:"hub",date,staffId:"person",
  staffNameSnapshot:"佐藤",teamIdSnapshot:"team",version:1,
  counts:Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?2:0])),
  totalCount:2,totalRevenue:99999
 });
 const scope=async(uid,tx,workspace)=>(
  workspace?{kind:"invalid"}:uid==="owner"?
   {kind:"hub",cid:"hub",role:"owner",uid}:
   {kind:"partner",cid:"partner",hubId:"hub",companyName:"協力店",
    role:uid==="member"?"member":uid==="leader"?"leader":"owner",uid,teamId:"team"});
 const api=makePartnerAdditionalOperations({
  db,actor:async request=>({uid:request.auth.uid}),
  scope,collection:(cid,id)=>db.collection("companies").doc(cid).collection(id),
  fail:code=>{throw new Err(code||"permission-denied");},
  FieldValue:{serverTimestamp:()=>({serverTime:true})},
  validDate:d=>{if(d!==date&&d!=="2026-10-15")throw new Err("invalid-argument");return d;},
  validName:n=>typeof n==="string"&&n.length>0,
  canStaff:(s,p)=>["owner","leader"].includes(s.role)||p.uid===s.uid,
  jstToday:()=>date,KEYS
 });
 const req=(who,data)=>({auth:{uid:who},data});
 return {db,api,req,date};
}
test("new counts are separate; legacy names and duplicate links are blocked",()=>{
 assert.equal(isLegacyCategoryName("NURO光"),true);
 assert.equal(isLegacyCategoryName("U-NEXT"),true);
 assert.equal(isLegacyCategoryName("ソフトバンク光"),true);
 assert.equal(isLegacyCategoryName("新商材X"),false);
 assert.deepEqual(applyExtraCounts({previous:{other:1},changes:{new:2},
  allowedIds:["new"],blockedLegacyIds:["nuro"]}),
  {counts:{other:1,new:2},total:3});
 assert.deepEqual(projectedExtraRead({other:1,new:2},{visibleIds:["new"]}),
  {counts:{new:2},archivedTotal:1,totalCount:3});
 assert.throws(()=>normalizeExtraCounts({new:1.5}),/INVALID/);
 assert.throws(()=>applyExtraCounts({previous:{},changes:{nuro:1},
  allowedIds:["nuro"],blockedLegacyIds:["nuro"]}),/INVALID/);
});
test("published new product is count-only; saved original 9 entries are not touched",async()=>{
 const {db,api,req,date}=seed();
 const before=structuredClone([...db.rows]);
 const first=await api.viewAdditionalCounts(req("member",{date}));
 assert.equal(first.scope,"partner_extra_counts");
 assert.deepEqual(first.products.map(x=>x.name),["新商材X"]);
 assert.doesNotMatch(JSON.stringify(first),/revenue|unitPrice|777777|999999|price/);
 const result=await api.submitAdditionalCounts(req("member",{
  date,staffId:"person",changes:{new:3},expectedVersion:0
 }));
 assert.equal(result.saved,true);
 assert.equal(result.version,1);
 const next=await api.viewAdditionalCounts(req("member",{date}));
 assert.equal(next.records[0].counts.new,3);
 assert.equal(next.records[0].totalCount,3);
 assert.equal(next.records[0].version,1);
 const paths=db.writes.map(x=>x.path);
 assert.equal(paths.length,3);
 assert.deepEqual(paths,[
  "companies/partner/partnerAdditionalCountEntries/"+date+"__person",
  "companies/partner/partnerAdditionalCountAudits/"+date+"__person__v1",
  "companies/hub/partnerAdditionalProductUsage/new"
 ]);
 for(const [path,val] of before)assert.deepEqual(db.rows.get(path),val);
 assert.doesNotMatch(JSON.stringify(next),/totalRevenue|unitPrice|revenuePerUnit/);
});
test("update version protects existing counts; OFF archives history but cannot edit",async()=>{
 const {db,api,req,date}=seed();
 await api.submitAdditionalCounts(req("leader",{
  date,staffId:"person",changes:{new:3},expectedVersion:0
 }));
 await assert.rejects(api.submitAdditionalCounts(req("leader",{
  date,staffId:"person",changes:{new:9},expectedVersion:0
 })),e=>e.code==="aborted");
 const updated=await api.submitAdditionalCounts(req("leader",{
  date,staffId:"person",changes:{new:5},expectedVersion:1
 }));
 assert.equal(updated.version,2);
 db.put("companies/hub/partnerCatalogSettings/publication",{
  revision:2,productIds:[]});
 const saved=await api.viewAdditionalCounts(req("member",{date}));
 assert.deepEqual(saved.products,[]);
 assert.equal(saved.records[0].archivedTotal,5);
 assert.equal(saved.records[0].totalCount,5);
 await assert.rejects(api.submitAdditionalCounts(req("member",{
  date,staffId:"person",changes:{new:0},expectedVersion:2
 })),e=>e.code==="failed-precondition");
 assert.equal(db.rows.get("companies/partner/partnerAdditionalCountEntries/"+date+"__person").counts.new,5);
});
test("unknown staff, past day without saved-team snapshot, direct owner and duplicate legacy counts refused",async()=>{
 const {db,api,req,date}=seed();
 for(const data of [
  {date,staffId:"stranger",changes:{new:1},expectedVersion:0},
  {date,staffId:"person",changes:{nuro:1},expectedVersion:0},
  {date:"2026-10-15",staffId:"person",changes:{new:1},expectedVersion:0}
 ]) await assert.rejects(api.submitAdditionalCounts(req("member",data)));
 await assert.rejects(api.viewAdditionalCounts(req("owner",{date})));
 assert.deepEqual(db.writes,[]);
});
