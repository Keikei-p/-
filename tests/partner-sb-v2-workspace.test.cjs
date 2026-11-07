"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeWorkspace,KEYS}=require("../staging/partner-sb-v2/service.cjs");
const clone=x=>x==null?x:Array.isArray(x)?x.map(clone):
 typeof x==="object"?(typeof x.toMillis==="function"?{toMillis:x.toMillis}:
 Object.fromEntries(Object.entries(x).map(([key,value])=>[key,clone(value)]))):x;
const NOW=Date.parse("2026-10-31T02:00:00+09:00");
class Ref {
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(k){return new Coll(this.db,this.path+"/"+k);}
 async get(){const v=this.db.store.get(this.path);return {exists:v!==undefined,data:()=>clone(v),id:this.id};}
}
class Coll {
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){return new Ref(this.db,this.path+"/"+(id||"auto"+(++this.db.serial)));}
 where(k,op,v){assert.equal(op,"==");return new Query(this.db,this.path,{k,v});}
 limit(n){return new Query(this.db,this.path,null,n);}
}
class Query {
 constructor(db,path,filter,lim=Infinity){this.db=db;this.path=path;this.filter=filter;this.lim=lim;}
 limit(n){return new Query(this.db,this.path,this.filter,n);}
 async get(){const docs=[];for(const [p,v] of this.db.store){
  if(p.startsWith(this.path+"/")&&!p.slice(this.path.length+1).includes("/")&&
     (!this.filter||v[this.filter.k]===this.filter.v))
    docs.push({id:p.split("/").at(-1),data:()=>clone(v)});
  }const rows=docs.slice(0,this.lim);return {size:rows.length,docs:rows};}
}
class DB {
 constructor(){this.store=new Map();this.serial=0;}
 collection(x){return new Coll(this,x);}
 seed(p,d){this.store.set(p,clone(d));}
 async runTransaction(fn){
  const changes=[],tx={
    get:r=>r.get(),create:(r,d)=>changes.push(["create",r.path,clone(d)]),
    update:(r,d)=>changes.push(["update",r.path,clone(d)])
  };
  const result=await fn(tx);
  for(const [op,p] of changes){if(op==="create"&&this.store.has(p))throw Error("duplicate");
   if(op==="update"&&!this.store.has(p))throw Error("missing");}
  for(const [op,p,d] of changes){
   const next=op==="create"?d:{...this.store.get(p),...d};
   for(const [key,value] of Object.entries(next))
    if(value?.__deleteField===true)delete next[key];
   this.store.set(p,next);
  }
  return result;
 }
}
class CallError extends Error{constructor(code,message){super(message);this.code=code;}}
function setup(){
 const db=new DB();
 const partnerUser=(uid,role,teamId=null)=>({uid,companyId:"partner",companyRole:role==="owner"?"owner":"member",
 role,teamId,active:true,accessKind:"partner",memberType:"cooperator",
 canViewRevenue:false,canViewUnitPrice:false});
 db.seed("companies/hub",{name:"自社",ownerUid:"h",active:true,companyKind:"internal"});
 db.seed("users/h",{uid:"h",companyId:"hub",companyRole:"owner",role:"leader",active:true,accessKind:"internal"});
 db.seed("companies/hub/members/h",{uid:"h",companyId:"hub",companyRole:"owner",role:"leader",active:true,accessKind:"internal"});
 db.seed("companies/partner",{name:"協力店",ownerUid:"p",companyKind:"partner",hubCompanyId:"hub",active:true});
 db.seed("users/p",partnerUser("p","leader")); // partner owner has leader role but owner companyRole
 db.store.get("users/p").companyRole="owner";
 db.seed("companies/partner/members/p",db.store.get("users/p"));
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",active:true,countSharingApproved:true});
 db.seed("products/money",{companyId:"hub",unitPrice:98765,totalRevenue:12345});
 db.seed("records/old",{companyId:"hub",totalRevenue:808080,results:{a:{count:5,revenuePerUnit:100}}});
 const getAuth=()=>({
  getUser:async uid=>({uid,disabled:false,emailVerified:true,email:uid+"@example.com"}),
  verifyIdToken:async token=>{const uid=token[0];return {uid,email:uid+"@example.com",email_verified:true};}
 });
 const Timestamp={fromMillis:ms=>({toMillis:()=>ms})},FieldValue={
  serverTimestamp:()=>({seconds:NOW/1000}),
  delete:()=>({__deleteField:true})
 };
 const api=makeWorkspace({db,getAuth,Timestamp,FieldValue,HttpsError:CallError,
  enabled:()=>true,now:()=>NOW});
 const req=(uid,data={})=>({auth:{uid,token:{email:uid+"@example.com",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+uid.repeat(30)}},data});
 const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
 return {db,api,req,zero};
}

// Staged backend tests: original live module and records remain untouched.


test("SB Hikari/Air optional v2: historical combined counts remain unknown until explicit correction",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const baseEntry="companies/partner/partnerWorkEntries/"+date+"__";
 const team=(await api.manage(req("p",{action:"addTeam",name:"通信班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当者A",teamId:team}))).staffId;
 const beforeFinance=clone(db.store.get("records/old"));
 const beforeProduct=clone(db.store.get("products/money"));
 const first=await api.submit(req("p",{date,staffId:staff,
  counts:{...zero(),"SB光・AIR":5},expectedVersion:0}));
 assert.equal(first.totalCount,5);
 const legacy=clone(db.store.get(baseEntry+staff));
 assert.equal(legacy.sbBreakdown,undefined);
 const oldRead=await api.view(req("p",{date}));
 assert.equal(oldRead.records[0].sbBreakdown,undefined);
 assert.equal(oldRead.records[0].counts["SB光・AIR"],5);
 assert.equal(oldRead.sbBreakdownSchema,"sb-separated-v1");
 assert.deepEqual(db.store.get(baseEntry+staff),legacy,"read must not rewrite old history");
 // The only supported correction is a versioned explicit allocation of the 5 original counts.
 const second=await api.submit(req("p",{date,staffId:staff,
  counts:{...zero(),"SB光・AIR":5},
  sbBreakdown:{"SB光":2,"SB AIR":3,"旧未分類":0},expectedVersion:1}));
 assert.equal(second.totalCount,5);
 assert.equal(second.version,2);
 const stored=db.store.get(baseEntry+staff);
 assert.deepEqual(stored.sbBreakdown,{"SB光":2,"SB AIR":3,"旧未分類":0});
 assert.equal(stored.counts["SB光・AIR"],5);
 assert.equal(stored.totalCount,5);
 const partner=await api.view(req("p",{date})),hub=await api.view(req("h",{date}));
 assert.deepEqual(partner.records[0].sbBreakdown,stored.sbBreakdown);
 assert.deepEqual(hub.partners[0].sbBreakdown,stored.sbBreakdown);
 assert.equal(hub.partners[0].totalCount,5);
 assert.equal(hub.partners[0].counts["SB光・AIR"],5);
 assert.deepEqual(db.store.get("records/old"),beforeFinance);
 assert.deepEqual(db.store.get("products/money"),beforeProduct);
 const audit=clone(db.store.get("companies/partner/partnerWorkAudits/"+date+"__"+staff+"__v2"));
 assert.deepEqual(audit.previousSbBreakdown,{"SB光":0,"SB AIR":0,"旧未分類":5});
 assert.deepEqual(audit.sbBreakdown,stored.sbBreakdown);
 assert.equal(audit.previousCounts["SB光・AIR"],5);
 assert.equal(db.store.get(baseEntry+staff).version,2);
});

test("SB Hikari/Air v2: old client cannot alter a classified combined total or erase split metadata",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"登録班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当者B",teamId:team}))).staffId;
 const first=await api.submit(req("p",{date,staffId:staff,
  counts:{...zero(),"SB光・AIR":5},
  sbBreakdown:{"SB光":4,"SB AIR":1,"旧未分類":0},expectedVersion:0}));
 assert.equal(first.version,1);
 const safeLegacy=await api.submit(req("p",{date,staffId:staff,
  counts:{...zero(),"SB光・AIR":5,NURO:1},expectedVersion:1}));
 assert.equal(safeLegacy.version,2,"unrelated field update should still be possible");
 const previous=clone(db.store.get("companies/partner/partnerWorkEntries/"+date+"__"+staff));
 assert.deepEqual(previous.sbBreakdown,{"SB光":4,"SB AIR":1,"旧未分類":0});
 const summary=clone(db.store.get("companies/hub/partnerWorkCountDays/"+date+"/reports/partner"));
 await assert.rejects(api.submit(req("p",{date,staffId:staff,
  counts:{...zero(),"SB光・AIR":6,NURO:1},expectedVersion:2})),
  /SB_SPLIT_OLD_CLIENT_MUST_REFRESH/);
 assert.deepEqual(db.store.get("companies/partner/partnerWorkEntries/"+date+"__"+staff),previous);
 assert.deepEqual(db.store.get("companies/hub/partnerWorkCountDays/"+date+"/reports/partner"),summary);
 assert.equal(db.store.has("companies/partner/partnerWorkAudits/"+date+"__"+staff+"__v3"),false);
});

test("SB Hikari/Air v2: mixed legacy and classified staff aggregate without double count",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"複数班"}))).teamId;
 const a=(await api.manage(req("p",{action:"addManaged",name:"旧担当",teamId:team}))).staffId;
 const b=(await api.manage(req("p",{action:"addManaged",name:"新担当",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:a,counts:{...zero(),"SB光・AIR":5},expectedVersion:0}));
 await api.submit(req("p",{date,staffId:b,counts:{...zero(),"SB光・AIR":3},
   sbBreakdown:{"SB光":2,"SB AIR":1,"旧未分類":0},expectedVersion:0}));
 const summary=db.store.get("companies/hub/partnerWorkCountDays/"+date+"/reports/partner");
 assert.equal(summary.counts["SB光・AIR"],8);
 assert.equal(summary.totalCount,8);
 assert.deepEqual(summary.sbBreakdown,{"SB光":2,"SB AIR":1,"旧未分類":5});
 await api.submit(req("p",{date,staffId:b,counts:{...zero(),"SB光・AIR":4},
  sbBreakdown:{"SB光":2,"SB AIR":2,"旧未分類":0},expectedVersion:1}));
 const updated=db.store.get("companies/hub/partnerWorkCountDays/"+date+"/reports/partner");
 assert.equal(updated.counts["SB光・AIR"],9);
 assert.equal(updated.totalCount,9);
 assert.deepEqual(updated.sbBreakdown,{"SB光":2,"SB AIR":2,"旧未分類":5});
});

test("SB Hikari/Air v2: inconsistent split, negative count and forged unknown keys never write",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"安全班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当者C",teamId:team}))).staffId;
 const baseline=clone([...db.store]);
 for(const sbBreakdown of [
  {"SB光":4,"SB AIR":2,"旧未分類":0},
  {"SB光":2,"SB AIR":2},
  {"SB光":5,"SB AIR":-1,"旧未分類":1},
  {"SB光":"3","SB AIR":2,"旧未分類":0},
  {"SB光":0,"SB AIR":0,"旧未分類":5,extra:10}
 ]){
  await assert.rejects(api.submit(req("p",{date,staffId:staff,
   counts:{...zero(),"SB光・AIR":5},sbBreakdown,expectedVersion:0})));
  assert.deepEqual([...db.store],baseline);
 }
});

test("Owner read: real shared company / team views reconcile old unknown and verified Light/Air without money",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"光とAIR管理班"}))).teamId;
 const old=(await api.manage(req("p",{action:"addManaged",name:"旧担当",teamId:team}))).staffId;
 const fresh=(await api.manage(req("p",{action:"addManaged",name:"新担当",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:old,expectedVersion:0,
   counts:{...zero(),"SB光・AIR":5,NURO:1}}));
 await api.submit(req("p",{date,staffId:fresh,expectedVersion:0,
   counts:{...zero(),"SB光・AIR":4},
   sbBreakdown:{"SB光":3,"SB AIR":1,"旧未分類":0}}));
 const before=clone([...db.store]);
 const hub=await api.view(req("h",{date,partnerCompanyId:"partner",includeTeamStatus:true}));
 assert.equal(hub.role,"hub");
 assert.equal(hub.sbBreakdownSchema,"sb-separated-v1");
 assert.equal(hub.partners.length,1);
 assert.equal(hub.partners[0].totalCount,10);
 assert.equal(hub.partners[0].counts["SB光・AIR"],9);
 assert.deepEqual(hub.partners[0].sbBreakdown,{"SB光":3,"SB AIR":1,"旧未分類":5});
 const shared=hub.partnerTeamDetails;
 assert.equal(shared.scope,"shared_counts_only");
 assert.equal(shared.teams.length,1);
 assert.equal(shared.teams[0].totalCount,10);
 assert.deepEqual(shared.teams[0].sbBreakdown,{"SB光":3,"SB AIR":1,"旧未分類":5});
 assert.equal(hub.teamReports[0].teams[0].totalCount,10);
 assert.deepEqual(hub.teamReports[0].teams[0].sbBreakdown,
   {"SB光":3,"SB AIR":1,"旧未分類":5});
 assert.equal(hub.teamReports[0].verified,true);
 assert.equal(hub.partnerTeamDetails.unreconciledWithCompanyReport,false);
 assert.doesNotMatch(JSON.stringify(hub),/totalRevenue|unitPrice|revenuePerUnit|cashback/);
 assert.deepEqual([...db.store],before,"Owner reads must not rewrite counts or money history");
});

test("Version-conflict split correction cannot change existing entry, daily summary, finance or audit history",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"訂正テスト班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当者",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,expectedVersion:0,
  counts:{...zero(),"SB光・AIR":5},
  sbBreakdown:{"SB光":2,"SB AIR":3,"旧未分類":0}}));
 const baseline=clone([...db.store]);
 await assert.rejects(api.submit(req("p",{date,staffId:staff,expectedVersion:0,
  counts:{...zero(),"SB光・AIR":5},
  sbBreakdown:{"SB光":3,"SB AIR":2,"旧未分類":0}})));
 assert.deepEqual([...db.store],baseline);
 assert.equal(db.store.has("companies/partner/partnerWorkAudits/"+date+"__"+staff+"__v2"),false);
});

test("Corrupted stored split aggregate stops new input without repairing or resetting production data",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"整合性テスト班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当者",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,expectedVersion:0,
  counts:{...zero(),"SB光・AIR":5},
  sbBreakdown:{"SB光":2,"SB AIR":3,"旧未分類":0}}));
 const summaryPath="companies/hub/partnerWorkCountDays/"+date+"/reports/partner";
 const report=clone(db.store.get(summaryPath));
 db.store.set(summaryPath,{...report,
  sbBreakdown:{"SB光":3,"SB AIR":3,"旧未分類":0}});
 const baseline=clone([...db.store]);
 await assert.rejects(api.submit(req("p",{date,staffId:staff,expectedVersion:1,
  counts:{...zero(),"SB光・AIR":5},
  sbBreakdown:{"SB光":4,"SB AIR":1,"旧未分類":0}})));
 assert.deepEqual([...db.store],baseline);
 assert.equal(db.store.has("companies/partner/partnerWorkAudits/"+date+"__"+staff+"__v2"),false);
});
