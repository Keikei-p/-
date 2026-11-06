"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {makePartnerAdditionalOperations}=require("../functions-partner-workspace/partner-additional-operations.cjs");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Query(this.db,this.path+"/"+name);}
 async get(){const row=this.db.rows.get(this.path);
  return {id:this.id,exists:row!==undefined,data:()=>row===undefined?undefined:structuredClone(row)};}
}
class Query{
 constructor(db,path,filters=[],limitN=Infinity){this.db=db;this.path=path;this.filters=filters;this.limitN=limitN;}
 doc(name){return new Ref(this.db,this.path+"/"+name);}
 collection(name){return new Query(this.db,this.path+"/"+name);}
 where(k,op,val){return new Query(this.db,this.path,[...this.filters,[k,op,val]],this.limitN);}
 limit(n){return new Query(this.db,this.path,this.filters,n);}
 async get(){
  const docs=[];
  for(const [path,row] of this.db.rows){
   if(!path.startsWith(this.path+"/")||path.slice(this.path.length+1).includes("/"))continue;
   if(!this.filters.every(([k,op,val])=>op==="=="?row[k]===val:
      op===">="?row[k]>=val:op==="<="?row[k]<=val:false))continue;
   docs.push({id:path.split("/").at(-1),data:()=>structuredClone(row)});
  }
  return {docs:docs.slice(0,this.limitN),size:Math.min(docs.length,this.limitN)};
 }
}
class MemoryDB{
 constructor(){this.rows=new Map();this.writes=[];}
 collection(name){return new Query(this,name);}
 seed(path,value){this.rows.set(path,structuredClone(value));}
 async runTransaction(callback){
  const changes=[];
  const tx={
   get:ref=>ref.get(),
   create:(ref,value)=>changes.push({kind:"create",path:ref.path,value:structuredClone(value)}),
   update:(ref,value)=>changes.push({kind:"update",path:ref.path,value:structuredClone(value)})
  };
  const result=await callback(tx);
  for(const item of changes){
   if(item.kind==="create"&&this.rows.has(item.path))
    throw Error("cannot override existing document");
   if(item.kind==="update"&&!this.rows.has(item.path))
    throw Error("cannot update missing document");
  }
  for(const item of changes){
   const original=this.rows.get(item.path)||{};
   this.seed(item.path,item.kind==="update"?{...original,...item.value}:item.value);
   this.writes.push(item.path);
  }
  return result;
 }
}
class CallError extends Error{
 constructor(code){super(code);this.code=code;}
}
function arrange(){
 const db=new MemoryDB();
 db.seed("products/new",{companyId:"hub",name:"追加商材X",active:true,
  sortOrder:2,unitPrice:80000,revenue:999999});
 db.seed("products/nuro",{companyId:"hub",name:"NURO光",active:true,
  sortOrder:1,unitPrice:12345});
 db.seed("products/foreign",{companyId:"other",name:"他社秘密",active:true,
  price:333333});
 db.seed("companies/hub/partnerCatalogSettings/publication",{
  revision:1,productIds:["new","nuro"]
 });
 db.seed("companies/partner/partnerWorkStaff/staff",{
  companyId:"partner",uid:"staff",name:"田中",active:true,kind:"account",teamId:"teamB"
 });
 db.seed("companies/partner/partnerWorkStaff/other",{
  companyId:"partner",uid:"other",name:"佐藤",active:true,kind:"account",teamId:"teamB"
 });
 db.seed("companies/partner/partnerWorkTeams/teamB",{
  companyId:"partner",name:"第2班",active:true
 });
 const legacy={companyId:"partner",hubCompanyId:"hub",date:"2026-11-06",
  staffId:"staff",teamIdSnapshot:"teamB",staffNameSnapshot:"田中",
  counts:Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?5:0])),
  totalCount:5,version:1,privateCounts:{},privateTotalCount:0};
 db.seed("companies/partner/partnerWorkEntries/2026-11-06__staff",legacy);
 const role=uid=>uid==="leader"?{kind:"partner",cid:"partner",hubId:"hub",
  role:"leader",uid}:uid==="staff"?{kind:"partner",cid:"partner",hubId:"hub",
  role:"member",uid}:uid==="hub"?{kind:"hub",cid:"hub",role:"owner",uid}:
  {kind:"partner",cid:"foreign",hubId:"other",role:"member",uid};
 const api=makePartnerAdditionalOperations({
  db,actor:async req=>({uid:req.auth.uid}),
  scope:async uid=>role(uid),
  collection:(cid,name)=>db.collection("companies").doc(cid).collection(name),
  fail:code=>{throw new CallError(code||"permission-denied");},
  FieldValue:{serverTimestamp:()=>({timestamp:true})},
  validDate:day=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>"2026-11-06")
    throw new CallError("invalid-argument");
   return day;
  },
  validName:name=>typeof name==="string"&&name.length>=1&&name.length<=60,
  canStaff:(role,person)=>["leader","owner"].includes(role.role)||
   role.role==="member"&&person.uid===role.uid,
  jstToday:()=>"2026-11-06",KEYS
 });
 const req=(uid,data={})=>({auth:{uid},data});
 return {db,api,req,legacy};
}
const day="2026-11-06",path="companies/partner/partnerAdditionalCountEntries/2026-11-06__staff";
test("only active published unlinked NEW products appear, never money-bearing masters",async()=>{
 const {db,api,req}=arrange();
 const before=structuredClone([...db.rows]);
 for(const uid of ["leader","staff"]){
  const d=await api.viewAdditionalCounts(req(uid,{date:day}));
  assert.equal(d.scope,"partner_extra_counts");
  assert.deepEqual(d.products.map(p=>p.id),["new"]);
  assert.doesNotMatch(JSON.stringify(d),/unitPrice|revenue|999999|12345|other|foreign|価格|売上/);
 }
 const staffOnly=await api.viewAdditionalCounts(req("staff",{date:day}));
 assert.deepEqual(staffOnly.records,[]);
 assert.deepEqual([...db.rows],before);
});
test("authorized save uses only new count, append audit and permanent usage documents",async()=>{
 const {db,api,req,legacy}=arrange();
 const result=await api.submitAdditionalCounts(req("leader",{
  date:day,staffId:"staff",changes:{new:3},expectedVersion:0
 }));
 assert.equal(result.saved,true);
 assert.equal(result.totalCount,3);
 assert.equal(result.version,1);
 assert.deepEqual(db.writes,[
  path,
  "companies/partner/partnerAdditionalCountAudits/2026-11-06__staff__v1",
  "companies/hub/partnerAdditionalProductUsage/new"
 ]);
 assert.deepEqual(db.rows.get("companies/partner/partnerWorkEntries/2026-11-06__staff"),legacy);
 assert.deepEqual(db.rows.get(path).counts,{new:3});
 assert.equal(db.rows.get(path).teamIdSnapshot,"teamB");
 assert.equal(db.rows.get(path).staffNameSnapshot,"田中");
 const d=await api.viewAdditionalCounts(req("leader",{date:day}));
 assert.equal(d.records.length,1);
 assert.deepEqual(d.records[0].counts,{new:3});
 assert.equal(d.records[0].archivedTotal,0);
 assert.equal(d.records[0].version,1);
});
test("version conflict and unapproved, legacy, foreign staff or hub submissions do no writes",async()=>{
 const {db,api,req}=arrange();
 const bad=[
  ["leader",{date:day,staffId:"staff",changes:{nuro:1},expectedVersion:0}],
  ["leader",{date:day,staffId:"staff",changes:{foreign:1},expectedVersion:0}],
  ["staff",{date:day,staffId:"other",changes:{new:1},expectedVersion:0}],
  ["hub",{date:day,staffId:"staff",changes:{new:1},expectedVersion:0}],
  ["leader",{date:day,staffId:"staff",changes:{new:1},expectedVersion:1}],
  ["leader",{date:day,staffId:"staff",changes:{new:-1},expectedVersion:0}]
 ];
 for(const [uid,data] of bad)
  await assert.rejects(api.submitAdditionalCounts(req(uid,data)));
 assert.deepEqual(db.writes,[]);
});
test("unpublish never erases saved count, disables new edits and archives hidden quantity",async()=>{
 const {db,api,req}=arrange();
 await api.submitAdditionalCounts(req("leader",{
  date:day,staffId:"staff",changes:{new:3},expectedVersion:0
 }));
 const saved=structuredClone(db.rows.get(path));
 db.seed("companies/hub/partnerCatalogSettings/publication",{
  revision:2,productIds:["nuro"]
 });
 const d=await api.viewAdditionalCounts(req("leader",{date:day}));
 assert.deepEqual(d.products,[]);
 assert.deepEqual(d.records[0].counts,{});
 assert.equal(d.records[0].archivedTotal,3);
 await assert.rejects(api.submitAdditionalCounts(req("leader",{
  date:day,staffId:"staff",changes:{new:4},expectedVersion:1
 })));
 assert.deepEqual(db.rows.get(path),saved);
 assert.deepEqual(db.writes,[
  path,"companies/partner/partnerAdditionalCountAudits/2026-11-06__staff__v1",
  "companies/hub/partnerAdditionalProductUsage/new"
 ]);
});
