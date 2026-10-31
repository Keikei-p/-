"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeWorkspace,KEYS}=require("../functions-partner-workspace/service.cjs");
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
  for(const [op,p,d] of changes)this.store.set(p,op==="create"?d:{...this.store.get(p),...d});
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
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",active:false,countSharingApproved:false});
 db.seed("products/money",{companyId:"hub",unitPrice:98765,totalRevenue:12345});
 db.seed("records/old",{companyId:"hub",totalRevenue:808080,results:{a:{count:5,revenuePerUnit:100}}});
 const getAuth=()=>({
  getUser:async uid=>({uid,disabled:false,emailVerified:true,email:uid+"@example.com"}),
  verifyIdToken:async token=>{const uid=token[0];return {uid,email:uid+"@example.com",email_verified:true};}
 });
 const Timestamp={fromMillis:ms=>({toMillis:()=>ms})},FieldValue={serverTimestamp:()=>({seconds:NOW/1000})};
 const api=makeWorkspace({db,getAuth,Timestamp,FieldValue,HttpsError:CallError,
  enabled:()=>true,now:()=>NOW});
 const req=(uid,data={})=>({auth:{uid,token:{email:uid+"@example.com",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+uid.repeat(30)}},data});
 const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
 return {db,api,req,zero};
}
test("partner owner makes team and managed staff, saves and corrects without touching original sales",async()=>{
 const {db,api,req,zero}=setup();
 const originalRecords=clone(db.store.get("records/old")),originalMoney=clone(db.store.get("products/money"));
 const team=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"スタッフ一",teamId:team}))).staffId;
 const day="2026-10-31";
 const first=await api.submit(req("p",{date:day,staffId:staff,
  counts:{...zero(),NURO:2,YMMNP:1},expectedVersion:0}));
 assert.equal(first.version,1);
 const hub=await api.view(req("h",{date:day}));
 assert.equal(hub.role,"hub");assert.equal(hub.partners.length,1);
 assert.equal(hub.partners[0].totalCount,3);
 assert.equal(JSON.stringify(hub).includes("unitPrice"),false);
 const own=await api.view(req("p",{date:day}));
 assert.equal(own.staff.length,1);assert.equal(own.records[0].totalCount,3);
 assert.equal(own.records[0].teamIdSnapshot,team,"saved team must be visible to count-only dashboard");
 await assert.rejects(api.submit(req("p",{date:day,staffId:staff,counts:zero(),expectedVersion:0})),
  e=>e.code==="aborted");
 const correct=await api.submit(req("p",{date:day,staffId:staff,counts:{...zero(),NURO:1},expectedVersion:1}));
 assert.equal(correct.version,2);
 const latest=await api.view(req("h",{date:day}));assert.equal(latest.partners[0].totalCount,1);
 assert.equal([...db.store.keys()].filter(k=>k.includes("partnerWorkAudits/")).length,2);
 assert.deepEqual(db.store.get("records/old"),originalRecords);
 assert.deepEqual(db.store.get("products/money"),originalMoney);
});
test("team migration leaves existing per-day partner counts and team attribution unchanged",async()=>{
 const {db,api,req,zero}=setup();
 const oldTeam=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const newTeam=(await api.manage(req("p",{action:"addTeam",name:"2班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"StaffOne",teamId:oldTeam}))).staffId;
 const date="2026-10-31";
 await api.submit(req("p",{date,staffId:staff,counts:{...zero(),NURO:2},expectedVersion:0}));
 await api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:newTeam}));
 let info=await api.view(req("p",{date}));
 assert.equal(info.staff[0].teamId,newTeam);
 assert.equal(info.records[0].teamIdSnapshot,oldTeam);
 await api.submit(req("p",{date,staffId:staff,counts:{...zero(),NURO:3},expectedVersion:1}));
 info=await api.view(req("p",{date}));
 assert.equal(info.records[0].teamIdSnapshot,oldTeam);
 assert.equal(info.records[0].totalCount,3);
 assert.equal(db.store.get("companies/partner/partnerWorkEntries/"+date+"__"+staff).teamIdSnapshot,oldTeam);
 assert.equal(db.store.get("records/old").totalRevenue,808080);
 assert.equal(db.store.get("products/money").unitPrice,98765);
});
test("owner invites leader, leader accepts own team and manages name-only staff, ordinary member cannot manage",async()=>{
 const {db,api,req,zero}=setup();
 const team=(await api.manage(req("p",{action:"addTeam",name:"第2班"}))).teamId;
 const invited=await api.manage(req("p",{action:"createInvite",email:"l@example.com",teamId:team,role:"leader"}));
 assert.equal(invited.token.length,43);
 const result=await api.accept(req("l",{token:invited.token,name:"リーダーさん"}));assert.equal(result.joined,true);
 assert.equal(db.store.get("users/l").canViewRevenue,false);
 assert.equal(db.store.get("users/l").canViewUnitPrice,false);
 assert.equal(db.store.get("users/l").teamId,team);
 await assert.rejects(api.accept(req("l",{token:invited.token,name:"リーダーさん"})),e=>e.code==="failed-precondition");
 const managed=(await api.manage(req("l",{action:"addManaged",name:"アシスタント",teamId:team}))).staffId;
 await api.submit(req("l",{date:"2026-10-31",staffId:managed,
  counts:{...zero(),SBMNP:3},expectedVersion:0}));
 const memInvite=await api.manage(req("l",{action:"createInvite",email:"m@example.com",teamId:team,role:"member"}));
 await api.accept(req("m",{token:memInvite.token,name:"メンバーさん"}));
 await api.submit(req("m",{date:"2026-10-31",staffId:"m",counts:{...zero(),NURO:1},expectedVersion:0}));
 const total=await api.view(req("h",{date:"2026-10-31"}));assert.equal(total.partners[0].totalCount,4);
 await assert.rejects(api.submit(req("m",{date:"2026-10-31",staffId:managed,counts:zero(),expectedVersion:1})),
 e=>e.code==="permission-denied");
 await assert.rejects(api.manage(req("m",{action:"addManaged",name:"不許可",teamId:team})),
 e=>e.code==="permission-denied");
 const memberView=await api.view(req("m",{date:"2026-10-31"}));
 assert.equal(memberView.staff.length,1);assert.equal(memberView.staff[0].id,"m");
});
test("no unauthenticated or disabled access, malformed count and finance fields denied",async()=>{
 const {api,req,zero}=setup();
 const team=(await api.manage(req("p",{action:"addTeam",name:"A班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"補助",teamId:team}))).staffId;
 const date="2026-10-31";
 for(const counts of [{...zero(),NURO:10000},{...zero(),売上:1234},{...zero(),YMMNP:-1}]){
  await assert.rejects(api.submit(req("p",{date,staffId:staff,counts,expectedVersion:0})),
   e=>e.code==="invalid-argument");
 }
 await assert.rejects(api.view(req("p",{date:"2026-11-01"})),e=>e.code==="invalid-argument");
 await assert.rejects(api.submit(req("h",{date,staffId:staff,counts:zero(),expectedVersion:0})),
  e=>e.code==="permission-denied");
 const invalid=req("p",{date});invalid.rawRequest.headers={};
 await assert.rejects(api.view(invalid),e=>e.code==="unauthenticated");
 const env=makeWorkspace({db:setup().db,getAuth:()=>({}),FieldValue:{},
  Timestamp:{},HttpsError:CallError,enabled:()=>false});
 await assert.rejects(env.view(req("p",{date})),e=>e.code==="unavailable");
});
test("security invariants: only isolated partner collections; no destructive database methods",()=>{
 const fs=require("node:fs");
 const code=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 assert.doesNotMatch(code,/\.delete\s*\(/);
 assert.doesNotMatch(code,/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/);
 assert.doesNotMatch(code,/\btx\.set\s*\(/);
 assert.match(code,/canViewRevenue:false,canViewUnitPrice:false/);
 assert.match(code,/partnerWorkAudits/);
});
