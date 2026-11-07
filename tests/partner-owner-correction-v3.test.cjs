"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeHubCountCorrections,KEYS}=require("../staging/partner-owner-correction-v3/service.cjs");
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Coll(this.db,this.path+"/"+name);}
 async get(){const v=this.db.store.get(this.path);return {
  exists:v!==undefined,id:this.id,data:()=>clone(v)};}
}
class Coll{
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){if(!id)throw Error("NO_AUTO_ID");return new Ref(this.db,this.path+"/"+id);}
 where(key,comparison,value){assert.equal(comparison,"==");return new Query(this.db,this.path,key,value);}
}
class Query{
 constructor(db,path,key,value){Object.assign(this,{db,path,key,value});}
 limit(n){this.limitCount=n;return this;}
 async get(){
  const docs=[...this.db.store].filter(([path,value])=>
   path.startsWith(this.path+"/")&&
   !path.slice(this.path.length+1).includes("/")&&value[this.key]===this.value)
   .slice(0,this.limitCount).map(([path,value])=>({
    id:path.split("/").at(-1),data:()=>clone(value)}));
  return {docs,size:docs.length};
 }
}
class Database{
 constructor(){this.store=new Map();this.reads=[];this.writes=[];}
 collection(key){return new Coll(this,key);}
 seed(path,value){this.store.set(path,clone(value));}
 async runTransaction(fn){
  const staged=[];
  const tx={
   get:async r=>{this.reads.push(r.path);return r.get();},
   update:(r,d)=>staged.push(["update",r.path,clone(d)]),
   create:(r,d)=>staged.push(["create",r.path,clone(d)])
  };
  const result=await fn(tx);
  for(const [method,path] of staged){
   if(method==="update"&&!this.store.has(path))throw Error("NOT_FOUND");
   if(method==="create"&&this.store.has(path))throw Error("ALREADY_EXISTS");
  }
  for(const [method,path,value] of staged){
   this.store.set(path,method==="create"?value:{...this.store.get(path),...value});
   this.writes.push({method,path});
  }
  return result;
 }
}
class ErrorCode extends Error{
 constructor(code,message){super(message);this.code=code;}
}
const zero=()=>Object.fromEntries(KEYS.map(key=>[key,0]));
const day="2026-10-31";
const prefix="companies/partner/partnerWorkEntries/"+day+"__";
const totalPath="companies/hub/partnerWorkCountDays/"+day+"/reports/partner";
function setup(){
 const db=new Database(),stamp={timestamp:"server"};
 db.seed("companies/hub",{active:true,companyKind:"internal",ownerUid:"owner"});
 db.seed("companies/partner",{name:"協力店 A",active:true,companyKind:"partner",hubCompanyId:"hub"});
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 db.seed("companies/other",{name:"協力店 B",active:true,companyKind:"partner",hubCompanyId:"elsewhere"});
 db.seed("partnerRelations/other",{partnerCompanyId:"other",hubCompanyId:"elsewhere",
  active:true,countSharingApproved:true});
 const makeReq=(uid="owner",data={})=>({uid,data});
 const service=makeHubCountCorrections({
  db,HttpsError:ErrorCode,FieldValue:{serverTimestamp:()=>stamp},enabled:()=>true,
  now:()=>Date.parse("2026-11-07T07:00:00+09:00"),
  verifyHubOwner:async(req,tx)=>{
   const uid=req.uid;
   if(uid!=="owner")return {kind:"partner",role:"owner",uid,hubId:"partner"};
   return {kind:"hub",role:"owner",uid,hubId:"hub"};
  }
 });
 const entry=(staffId,counts,extras={})=>{
  const totalCount=Object.values(counts).reduce((a,b)=>a+b,0);
  db.seed(prefix+staffId,{
   companyId:"partner",hubCompanyId:"hub",staffId,date:day,version:1,counts,
   totalCount,privateCounts:{private1:4},privateTotalCount:4,
   teamIdSnapshot:"team_original",staffNameSnapshot:"担当者A",
   createdAt:{timestamp:"past"},createdByUid:"member",
   ...extras
  });
 };
 const aggregate=(counts,extras={})=>db.seed(totalPath,{
  source:"staff-entries-v1",companyId:"partner",partnerCompanyId:"partner",
  hubCompanyId:"hub",date:day,partnerName:"協力店 A",
  counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0),
  createdAt:{timestamp:"past"},...extras
 });
 return {db,service,makeReq,entry,aggregate};
}

test("owner lists existing entries: count-only, no finance or private count leakage, no writes",async()=>{
 const {db,service,makeReq,entry,aggregate}=setup(),counts={...zero(),NURO:1,"SB光・AIR":5};
 entry("s1",counts);
 aggregate(counts);
 const saved=clone([...db.store]);
 const result=await service.list(makeReq("owner",{date:day,partnerCompanyId:"partner"}));
 assert.equal(result.scope,"existing-partner-counts-only");
 assert.equal(result.role,"hub");
 assert.equal(result.entries.length,1);
 assert.equal(result.entries[0].version,1);
 assert.equal(result.entries[0].staffName,"担当者A");
 assert.deepEqual(result.entries[0].sbBreakdown,{"SB光":0,"SB AIR":0,"旧未分類":5});
 assert.doesNotMatch(JSON.stringify(result),/private1|privateCounts|revenue|price|cashback/i);
 assert.deepEqual([...db.store],saved);
 assert.equal(db.writes.length,0);
});

test("hub owner corrects existing count and SB classification with version and append-only audit",async()=>{
 const {db,service,makeReq,entry,aggregate}=setup();
 const initial={...zero(),NURO:1,"SB光・AIR":5};
 entry("s1",initial);
 aggregate(initial);
 db.seed("products/finance",{companyId:"hub",revenue:500000});
 db.seed("records/finance",{companyId:"hub",totalRevenue:120000});
 const before=clone([...db.store]);
 const updated={...initial,NURO:3};
 const result=await service.correct(makeReq("owner",{
  date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:1,
  counts:updated,sbBreakdown:{"SB光":3,"SB AIR":2,"旧未分類":0},
  correctionReason:"光3件とAIR2件への内訳訂正"
 }));
 assert.equal(result.version,2);
 assert.equal(result.totalCount,8);
 assert.equal(result.containsFinance,false);
 const row=db.store.get(prefix+"s1"),summary=db.store.get(totalPath);
 assert.equal(row.version,2);
 assert.equal(row.totalCount,8);
 assert.deepEqual(row.sbBreakdown,{"SB光":3,"SB AIR":2,"旧未分類":0});
 assert.deepEqual(summary.sbBreakdown,{"SB光":3,"SB AIR":2,"旧未分類":0});
 assert.equal(summary.totalCount,8);
 assert.equal(row.privateCounts.private1,4);
 assert.equal(row.privateTotalCount,4);
 assert.equal(row.teamIdSnapshot,"team_original");
 assert.equal(row.staffNameSnapshot,"担当者A");
 assert.deepEqual(row.createdAt,{timestamp:"past"});
 assert.deepEqual(db.store.get("products/finance"),before.find(x=>x[0]==="products/finance")[1]);
 assert.deepEqual(db.store.get("records/finance"),before.find(x=>x[0]==="records/finance")[1]);
 const audit=db.store.get("companies/partner/partnerWorkAudits/"+day+"__s1__v2");
 assert.equal(audit.kind,"hub_owner_count_correction_v1");
 assert.equal(audit.changedByUid,"owner");
 assert.deepEqual(audit.previousCounts,initial);
 assert.deepEqual(audit.counts,updated);
 assert.equal(audit.previousSbBreakdown["旧未分類"],5);
 assert.equal(audit.sbBreakdown["SB光"],3);
 assert.ok(!JSON.stringify(audit).includes("privateCounts"));
 assert.deepEqual(db.writes.map(x=>x.method),["update","update","create"]);
});

test("owner correction preserves old unknown SB count and audit history when no split supplied",async()=>{
 const {db,service,makeReq,entry,aggregate}=setup();
 const original={...zero(),"SB光・AIR":5};
 entry("s1",original);aggregate(original);
 const first=await service.correct(makeReq("owner",{
  date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:1,
  counts:{...original,YMMNP:1},correctionReason:"前回未反映のYMMNPを追加"
 }));
 assert.equal(first.version,2);
 assert.equal(db.store.get(prefix+"s1").sbBreakdown,undefined);
 assert.equal(db.store.get(totalPath).sbBreakdown,undefined);
 const second=await service.correct(makeReq("owner",{
  date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:2,
  counts:{...original,YMMNP:1},sbBreakdown:{"SB光":2,"SB AIR":2,"旧未分類":1},
  correctionReason:"本人に確認した分類に修正"
 }));
 assert.equal(second.version,3);
 assert.equal(db.store.get(totalPath).counts["SB光・AIR"],5);
 assert.equal(db.store.get(totalPath).totalCount,6);
 assert.equal(db.store.get("companies/partner/partnerWorkAudits/"+day+"__s1__v2").version,2);
 assert.equal(db.store.get("companies/partner/partnerWorkAudits/"+day+"__s1__v3").version,3);
});

test("no-op with matching counts and semantic SB split never bumps version or writes audit",async()=>{
 const {db,service,makeReq,entry,aggregate}=setup();
 const counts={...zero(),NURO:1,"SB光・AIR":5};
 entry("s1",counts);aggregate(counts);
 const before=clone([...db.store]);
 for(const rawSplit of [
  undefined,{"SB光":0,"SB AIR":0,"旧未分類":5}
 ]){
  const data={date:day,partnerCompanyId:"partner",staffId:"s1",
   expectedVersion:1,counts,correctionReason:"既存内容を再保存しようとした"};
  if(rawSplit!==undefined)data.sbBreakdown=rawSplit;
  await assert.rejects(service.correct(makeReq("owner",data)),err=>
   err?.code==="failed-precondition");
  assert.deepEqual([...db.store],before,"no-op must preserve entry, summary and audit");
  assert.equal(db.writes.length,0);
 }
 // Distinguish a genuine category correction with unchanged total.
 const classified=await service.correct(makeReq("owner",{
  date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:1,
  counts,sbBreakdown:{"SB光":2,"SB AIR":3,"旧未分類":0},
  correctionReason:"契約票で確認済みの内訳に変更"
 }));
 assert.equal(classified.version,2);
 assert.equal(db.store.get(prefix+"s1").totalCount,6);
 assert.deepEqual(db.store.get(prefix+"s1").sbBreakdown,
  {"SB光":2,"SB AIR":3,"旧未分類":0});
 assert.equal(db.writes.length,3);
 const after=clone([...db.store]);
 await assert.rejects(service.correct(makeReq("owner",{
  date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:2,
  counts,sbBreakdown:{"SB光":2,"SB AIR":3,"旧未分類":0},
  correctionReason:"同じ内訳を繰り返し送信"
 })),err=>err?.code==="failed-precondition");
 assert.deepEqual([...db.store],after);
 assert.equal(db.writes.length,3,"no second audit/history revision");
});

test("wrong actor, company, expired relation, or forged request fields: no writes",async()=>{
 const {db,service,makeReq,entry,aggregate}=setup(),counts={...zero(),NURO:1};
 entry("s1",counts);aggregate(counts);
 const mutation={date:day,partnerCompanyId:"partner",staffId:"s1",expectedVersion:1,
  counts,correctionReason:"件数の入力誤りを訂正"};
 const saved=clone([...db.store]);
 await assert.rejects(service.correct(makeReq("partner_user",mutation)));
 await assert.rejects(service.list(makeReq("partner_user",{date:day,partnerCompanyId:"partner"})));
 await assert.rejects(service.correct(makeReq("owner",{...mutation,partnerCompanyId:"other"})));
 await assert.rejects(service.correct(makeReq("owner",{...mutation,privateCounts:{private1:0}})));
 await assert.rejects(service.correct(makeReq("owner",{...mutation,source:"sales-records"})));
 assert.deepEqual([...db.store],saved);
 assert.equal(db.writes.length,0);
 db.store.get("partnerRelations/partner").countSharingApproved=false;
 const inactive=clone([...db.store]);
 await assert.rejects(service.correct(makeReq("owner",mutation)));
 assert.deepEqual([...db.store],inactive);
});

test("conflict, missing entry, bad reason, bad split and new arbitrary staff all fail closed",async()=>{
 const {db,service,makeReq,entry,aggregate}=setup(),counts={...zero(),"SB光・AIR":5};
 entry("s1",counts);aggregate(counts);
 const base={date:day,partnerCompanyId:"partner",staffId:"s1",
  expectedVersion:1,counts,correctionReason:"内訳の聞き取り訂正"};
 const snapshot=clone([...db.store]);
 for(const changes of [
  {expectedVersion:0},{expectedVersion:2},{staffId:"s2"},
  {correctionReason:"短い"},{correctionReason:"売上を20万円に修正"},
  {counts:{...counts,NURO:-1}},
  {counts:{...counts,NURO:"1"}},
  {counts:{...counts,extra:1}},
  {sbBreakdown:{"SB光":4,"SB AIR":3,"旧未分類":0}},
  {sbBreakdown:{"SB光":4,"SB AIR":1}},
  {date:"2027-01-01"}
 ]){
  await assert.rejects(service.correct(makeReq("owner",{...base,...changes})));
  assert.deepEqual([...db.store],snapshot);
 }
 assert.equal(db.writes.length,0);
});

test("corrupted aggregate, legacy source and mismatched entry abort without repair",async()=>{
 const {db,service,makeReq,entry,aggregate}=setup(),counts={...zero(),NURO:3};
 entry("s1",counts);aggregate(counts);
 const request=makeReq("owner",{date:day,partnerCompanyId:"partner",staffId:"s1",
  expectedVersion:1,counts:{...counts,NURO:4},
  correctionReason:"NURO報告の件数を訂正"});
 for(const summaryChange of [
  {source:"legacy-one-company-report"},
  {totalCount:999},
  {partnerCompanyId:"another"},
  {counts:{...counts,NURO:0}}
 ]){
  const original=clone(db.store.get(totalPath));
  db.store.set(totalPath,{...original,...summaryChange});
  const snapshot=clone([...db.store]);
  await assert.rejects(service.correct(request));
  assert.deepEqual([...db.store],snapshot);
  db.store.set(totalPath,original);
 }
 assert.equal(db.writes.length,0);
});

test("only staging module was added; original immutable published Functions and Rules are untouched",()=>{
 const code=require("node:fs").readFileSync(
  require("node:path").join(__dirname,"../staging/partner-owner-correction-v3/service.cjs"),"utf8");
 assert.match(code,/STAGING ONLY/);
 assert.match(code,/verifyHubOwner/);
 assert.match(code,/previousVersion/);
 assert.doesNotMatch(code,/firestore\.rules|firebase deploy|collection\("records"\)|collection\("products"\)/);
});
