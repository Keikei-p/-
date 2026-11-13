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
 where(k,op,v){assert(["==",">=","<="].includes(op));return new Query(this.db,this.path,[{k,op,v}]);}
 limit(n){return new Query(this.db,this.path,null,n);}
}
class Query {
 constructor(db,path,filter,lim=Infinity){this.db=db;this.path=path;this.filter=filter;this.lim=lim;}
 limit(n){return new Query(this.db,this.path,this.filter,n);}
 where(k,op,v){assert(["==",">=","<="].includes(op));
  return new Query(this.db,this.path,[...(this.filter||[]),{k,op,v}],this.lim)}
 async get(){const docs=[];for(const [p,v] of this.db.store){
  if(p.startsWith(this.path+"/")&&!p.slice(this.path.length+1).includes("/")&&
     (this.filter||[]).every(f=>f.op==="=="?v[f.k]===f.v:
      f.op===">="?v[f.k]>=f.v:v[f.k]<=f.v))
    docs.push({exists:true,id:p.split("/").at(-1),data:()=>clone(v)});
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
function setup(sharedRankingOn=false,publicationWriteOn=false,ownerReadOn=false,ownerWriteOn=false){
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
  enabled:()=>true,sharedRankingEnabled:()=>sharedRankingOn,
  submissionPublicationEnabled:()=>publicationWriteOn,
  ownerCorrectionReadEnabled:()=>ownerReadOn,
  ownerCorrectionWriteEnabled:()=>ownerWriteOn,now:()=>NOW});
 const req=(uid,data={})=>({auth:{uid,token:{email:uid+"@example.com",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+uid.repeat(30)}},data});
 const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
 return {db,api,req,zero};
}

test("existing hub Owner without legacy optional member.companyId can list and invite",async()=>{
 const {db,api,req}=setup();
 const ownerUserBefore=clone(db.store.get("users/h"));
 const original=clone(db.store.get("records/old"));
 const finance=clone(db.store.get("products/money"));
 const ownerMember=clone(db.store.get("companies/hub/members/h"));
 delete ownerMember.companyId; // all 8 internal authenticated accounts in the live audit lack this field
 db.seed("companies/hub/members/h",ownerMember);
 const list=await api.view(req("h",{date:"2026-10-31"}));
 assert.equal(list.role,"hub");
 assert.ok(Array.isArray(list.registeredCompanies));
 const invite=await api.manage(req("h",{action:"hubCreateInvite",companyName:"新会社",role:"leader",email:"n@example.com"}));
 assert.match(invite.token,/^[A-Za-z0-9_-]{43}$/);
 assert.deepEqual(db.store.get("companies/hub/members/h"),ownerMember);
 assert.deepEqual(db.store.get("users/h"),ownerUserBefore);
 assert.deepEqual(db.store.get("records/old"),original);
 assert.deepEqual(db.store.get("products/money"),finance);
});

test("existing hub Owner still denies a present foreign membership companyId and revoked roles",async()=>{
 for(const mutate of [
  m=>{m.companyId="other";},
  m=>{m.companyRole="member";},
  m=>{m.active=false;}
 ]){
  const {db,api,req}=setup(),member=clone(db.store.get("companies/hub/members/h"));
  mutate(member);db.seed("companies/hub/members/h",member);
  const before=clone([...db.store]);
  await assert.rejects(api.view(req("h",{date:"2026-10-31"})),e=>e.code==="permission-denied");
  await assert.rejects(api.manage(req("h",{action:"hubCreateInvite",companyName:"新会社",role:"leader",email:"n@example.com"})),e=>e.code==="permission-denied");
  assert.deepEqual([...db.store],before);
 }
});

test("verified email invite preview never changes membership, and refuses wrong account or expired link",async()=>{
 const {db,api,req}=setup();
 const team=(await api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"partner",name:"確認班"}))).teamId;
 const created=await api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",
  teamId:team,role:"leader",email:"n@example.com"}));
 assert.equal(created.partnerCompanyId,"partner");
 assert.equal(created.teamId,team);
 assert.ok(Number.isFinite(created.expiresAt));
 const before=clone([...db.store]);
 const preview=await api.accept(req("n",{token:created.token,previewOnly:true}));
 assert.deepEqual(preview,{valid:true,companyName:"協力店",teamName:"確認班",role:"leader"});
 assert.deepEqual([...db.store],before,"preview must not write records or membership");
 await assert.rejects(api.accept(req("x",{token:created.token,previewOnly:true})),{code:"permission-denied"});
 await assert.rejects(api.accept(req("n",{token:created.token,previewOnly:false})),{code:"invalid-argument"});
 assert.deepEqual([...db.store],before);
 const hashed=require("node:crypto").createHash("sha256").update(created.token).digest("hex");
 db.store.get("partnerWorkInvites/"+hashed).expiresAt={toMillis:()=>NOW-1000};
 await assert.rejects(api.accept(req("n",{token:created.token,previewOnly:true})),{code:"failed-precondition"});
});

test("existing verified hub owner may join as separate count-only partner without missing legacy email fields",async()=>{
 const {db,api,req}=setup();
 // Existing production profiles may lack redundant email data. Firebase Auth
 // has already verified the signed-in email, and finance must remain untouched.
 delete db.store.get("users/h").email;
 delete db.store.get("companies/hub/members/h").email;
 delete db.store.get("companies/hub/members/h").companyId;
 const originals=clone([...db.store]);
 const team=(await api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"partner",name:"既存検証班"}))).teamId;
 const invite=await api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",
  teamId:team,role:"leader",email:"h@example.com"}));
 const preview=await api.accept(req("h",{token:invite.token,previewOnly:true}));
 assert.equal(preview.valid,true);
 const result=await api.accept(req("h",{token:invite.token,name:"既存オーナー",transferCurrentCompany:false}));
 assert.equal(result.secondaryMembership,true);
 assert.equal(result.transferredFromInternal,false);
 assert.equal(db.store.get("users/h").companyId,"hub");
 assert.equal(db.store.get("companies/hub/members/h").active,true);
 const extra=db.store.get("companies/partner/members/h");
 assert.equal(extra.canViewRevenue,false);
 assert.equal(extra.canViewUnitPrice,false);
 const view=await api.view(req("h",{date:"2026-10-31",workspaceCompanyId:"partner"}));
 assert.equal(view.role,"leader");
 assert.deepEqual(db.store.get("products/money"),originals.find(([k])=>k==="products/money")[1]);
 assert.deepEqual(db.store.get("records/old"),originals.find(([k])=>k==="records/old")[1]);
 await assert.rejects(api.accept(req("h",{token:invite.token,name:"二度目"})),{code:"failed-precondition"});
});

test("legacy email fallback refuses explicit mismatched user or member email",async()=>{
 for(const path of ["users/h","companies/hub/members/h"]){
  const {db,api,req}=setup();
  db.store.get(path).email="wrong@example.com";
  const team=(await api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"partner",name:"別班"}))).teamId;
  const invite=await api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",
   teamId:team,role:"member",email:"h@example.com"}));
  await assert.rejects(api.accept(req("h",{token:invite.token,name:"拒否"})),{code:"failed-precondition"});
  assert.equal(db.store.get("companies/partner/members/h"),undefined);
 }
});

test("first company is created with direct leader/member invite, no representative or finance mutation",async()=>{
 for(const role of ["leader","member"]){
  const {db,api,req,zero}=setup();
  for(const key of [...db.store.keys()])if(key.startsWith("companies/partner")||key==="partnerRelations/partner"||key==="users/p")db.store.delete(key);
  const before=new Map([...db.store].map(([k,v])=>[k,clone(v)]));
  const invite=await api.manage(req("h",{action:"hubCreateInvite",companyName:"新協力店",role,email:"n@example.com"}));
  const joined=await api.accept(req("n",{token:invite.token,name:"参加者"}));
  const cid=joined.partnerCompanyId,c=db.store.get("companies/"+cid);
  assert.equal(c.name,"新協力店");assert.equal(c.ownerUid,undefined);
  assert.equal(db.store.get("users/n").role,role);
  assert.equal(db.store.get("users/n").companyRole,"member");
  assert.equal(db.store.get("users/n").canViewRevenue,false);
  assert.equal(db.store.get("users/n").canViewUnitPrice,false);
  await api.submit(req("n",{date:"2026-10-31",staffId:"n",counts:{...zero(),NURO:2},expectedVersion:0}));
  const own=await api.view(req("n",{date:"2026-10-31"})),hub=await api.view(req("h",{date:"2026-10-31"}));
  assert.equal(own.records[0].totalCount,2);assert.equal(hub.partners[0].totalCount,2);
  if(role==="leader")await api.manage(req("n",{action:"addTeam",name:"2班"}));
  else await assert.rejects(api.manage(req("n",{action:"addTeam",name:"2班"})));
  for(const [k,v] of before)assert.deepEqual(db.store.get(k),v);
  const size=db.store.size;
  await assert.rejects(api.manage(req("h",{action:"hubCreateInvite",companyName:"新協力店",role,email:"x@example.com"})),{code:"already-exists"});
  assert.equal(db.store.size,size);
 }
});

test("new company invite fails closed for partner callers, revoked hub owners and invalid input",async()=>{
 for(const patch of [{companyName:""},{companyName:"売上100円"},{companyName:"Ａ".repeat(81)},{role:"owner"},{teamId:"foreign"},{email:"bad"}]){
  const {db,api,req}=setup(),before=clone([...db.store]);
  await assert.rejects(api.manage(req("h",{action:"hubCreateInvite",companyName:"新会社",role:"leader",email:"n@example.com",...patch})));
  assert.deepEqual([...db.store],before);
 }
 const {db,api,req}=setup();
 const payload={action:"hubCreateInvite",companyName:"新会社",role:"leader",email:"n@example.com"};
 await assert.rejects(api.manage(req("p",payload)));
 const transaction=db.runTransaction.bind(db);
 db.runTransaction=fn=>{db.store.get("companies/hub/members/h").active=false;return transaction(fn);};
 await assert.rejects(api.manage(req("h",payload)));
 assert.equal([...db.store.keys()].filter(k=>k.startsWith("partnerWorkInvites/")).length,0);
});

test("direct hub invite needs no representative: leader manages own company teams, invites and preserves history",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 // An existing partner company does not need an owner/representative account.
 db.store.delete("users/p");db.store.delete("companies/partner/members/p");
 delete db.store.get("companies/partner").ownerUid;
 const original=clone(db.store.get("records/old"));
 const first=(await api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"partner",name:"初期班"}))).teamId;
 const invite=await api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",teamId:first,role:"leader",email:"l@example.com"}));
 await api.accept(req("l",{token:invite.token,name:"リーダー"}));
 const profile=db.store.get("users/l");
 assert.equal(profile.companyRole,"member");assert.equal(profile.role,"leader");
 assert.equal(profile.canViewRevenue,false);assert.equal(profile.canViewUnitPrice,false);
 const second=(await api.manage(req("l",{action:"addTeam",name:"追加班"}))).teamId;
 const member=await api.manage(req("l",{action:"createInvite",teamId:second,role:"member",email:"m@example.com"}));
 await api.accept(req("m",{token:member.token,name:"メンバー"}));
 await api.submit(req("m",{date:"2026-10-30",staffId:"m",counts:{...zero(),NURO:3},expectedVersion:0}));
 const before=clone(db.store.get("companies/partner/partnerWorkEntries/2026-10-30__m"));
 await api.manage(req("l",{action:"moveStaff",staffId:"m",teamId:first}));
 assert.equal(db.store.get("users/m").teamId,first);
 assert.equal(db.store.get("companies/partner/members/m").teamId,first);
 assert.deepEqual(db.store.get("companies/partner/partnerWorkEntries/2026-10-30__m"),before);
 await api.submit(req("m",{date,staffId:"m",counts:{...zero(),NURO:2},expectedVersion:0}));
 const own=await api.view(req("l",{date})),hub=await api.view(req("h",{date}));
 assert.equal(own.teams.length,2);assert.equal(own.records[0].totalCount,2);
 assert.equal(hub.partners[0].totalCount,2);
 for(const result of [own,hub])assert.doesNotMatch(JSON.stringify(result),/unitPrice|totalRevenue|revenuePerUnit/);
 for(const action of ["addTeam","moveStaff","createInvite"])
  await assert.rejects(api.manage(req("m",{action,name:"不許可",staffId:"l",teamId:second,role:"leader",email:"x@example.com"})));
 db.seed("companies/other/partnerWorkTeams/foreign",{name:"他社班",companyId:"other",active:true});
 await assert.rejects(api.manage(req("l",{action:"moveStaff",staffId:"m",teamId:"foreign"})));
 await assert.rejects(api.manage(req("l",{action:"hubCreateInvite",partnerCompanyId:"other",teamId:"foreign",role:"leader",email:"x@example.com"})));
 assert.deepEqual(db.store.get("records/old"),original);
 const nextLeader=await api.manage(req("l",{action:"createInvite",teamId:second,role:"leader",email:"n@example.com"}));
 await api.accept(req("n",{token:nextLeader.token,name:"次のリーダー"}));
 assert.equal(db.store.get("users/n").role,"leader");
 assert.equal(db.store.get("users/n").companyRole,"member");
});

test("pending partner invitation rechecks revoked issuer and cannot be replayed or used by a different email",async()=>{
 const {db,api,req}=setup();
 const teamId=(await api.manage(req("p",{action:"addTeam",name:"班"}))).teamId;
 const result=await api.manage(req("p",{action:"createInvite",teamId,role:"leader",email:"l@example.com"}));
 await assert.rejects(api.accept(req("x",{token:result.token,name:"別人"})));
 db.store.get("companies/partner/members/p").active=false;
 await assert.rejects(api.accept(req("l",{token:result.token,name:"失効"})));
 assert.equal(db.store.has("users/l"),false);
});

test("inviter demotion between initial scope and transaction cannot issue a link",async()=>{
 const {db,api,req}=setup();
 const teamId=(await api.manage(req("p",{action:"addTeam",name:"班"}))).teamId;
 const invite=await api.manage(req("p",{action:"createInvite",teamId,role:"leader",email:"l@example.com"}));
 await api.accept(req("l",{token:invite.token,name:"リーダー"}));
 const transaction=db.runTransaction.bind(db),before=db.store.size;
 db.runTransaction=async fn=>{
  db.store.get("users/l").role="member";
  db.store.get("companies/partner/members/l").role="member";
  return transaction(fn);
 };
 await assert.rejects(api.manage(req("l",{action:"createInvite",teamId,role:"member",email:"m@example.com"})));
 assert.equal(db.store.size,before);
});
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
 await assert.rejects(api.submit(req("p",{date:day,staffId:staff,counts:zero(),expectedVersion:0})),
  e=>e.code==="aborted");
 const correct=await api.submit(req("p",{date:day,staffId:staff,counts:{...zero(),NURO:1},expectedVersion:1}));
 assert.equal(correct.version,2);
 const latest=await api.view(req("h",{date:day}));assert.equal(latest.partners[0].totalCount,1);
 assert.equal([...db.store.keys()].filter(k=>k.includes("partnerWorkAudits/")).length,2);
 assert.deepEqual(db.store.get("records/old"),originalRecords);
 assert.deepEqual(db.store.get("products/money"),originalMoney);
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
 // Historical profile field cleanup is allowed ONLY after an immutable
 // archive is written in the same Firestore transaction; no document delete.
 assert.match(code,/tx\.create\(archivedRef/);
 assert.doesNotMatch(code.replaceAll("FieldValue.delete()",""),/\.delete\s*\(/);
 assert.doesNotMatch(code,/\.collection\s*\(\s*["'](?:records|products|recordCorrections|revenueGoals)["']\s*\)/);
 assert.doesNotMatch(code,/\btx\.set\s*\(/);
 assert.match(code,/canViewRevenue:false,canViewUnitPrice:false/);
 assert.match(code,/partnerWorkAudits/);
});

test("partner team ranking reads saved original team at registration; staff move never rewrites previous results",async()=>{
 const {db,api,req,zero}=setup();
 const firstTeam=(await api.manage(req("p",{action:"addTeam",name:"旧1班"}))).teamId;
 const secondTeam=(await api.manage(req("p",{action:"addTeam",name:"新2班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当A",teamId:firstTeam}))).staffId;
 await api.submit(req("p",{date:"2026-10-30",staffId:staff,counts:{...zero(),NURO:4},expectedVersion:0}));
 const oldKey="companies/partner/partnerWorkEntries/2026-10-30__"+staff;
 const before=clone(db.store.get(oldKey));
 assert.equal(before.teamIdSnapshot,firstTeam);
 await api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:secondTeam}));
 const old=await api.view(req("p",{date:"2026-10-30"}));
 assert.equal(old.records[0].totalCount,4);
 assert.equal(old.records[0].teamIdSnapshot,firstTeam,"old record remains with historical team");
 assert.equal(old.staff[0].teamId,secondTeam,"current placement may change without rewriting history");
 await api.submit(req("p",{date:"2026-10-31",staffId:staff,counts:{...zero(),YMMNP:2},expectedVersion:0}));
 const latest=await api.view(req("p",{date:"2026-10-31"}));
 assert.equal(latest.records[0].teamIdSnapshot,secondTeam);
 assert.equal(latest.records[0].totalCount,2);
 assert.deepEqual(db.store.get(oldKey),before,"historical counts and at-time team never edited");
 assert.equal(JSON.stringify(old).includes("totalRevenue"),false);
 assert.equal(JSON.stringify(old).includes("revenuePerUnit"),false);
 assert.equal(JSON.stringify(latest).includes("unitPrice"),false);
});
test("legacy partner entries missing a historical team snapshot are unverified, never assigned to current team",async()=>{
 const {db,api,req,zero}=setup();
 const team=(await api.manage(req("p",{action:"addTeam",name:"第1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当B",teamId:team}))).staffId;
 await api.submit(req("p",{date:"2026-10-31",staffId:staff,counts:{...zero(),NURO:1},expectedVersion:0}));
 const ref="companies/partner/partnerWorkEntries/2026-10-31__"+staff;
 const saved=clone(db.store.get(ref));
 delete saved.teamIdSnapshot;
 db.seed(ref,saved);
 const result=await api.view(req("p",{date:"2026-10-31"}));
 assert.equal(result.records[0].teamIdSnapshot,null);
 assert.equal(result.records[0].totalCount,1);
 assert.deepEqual(db.store.get(ref),saved,"no repair or data writes during read");
});

test("partner owner adds private products and own counts; hub never learns private names, counts or aggregate difference",async()=>{
 const {db,api,req,zero}=setup();
 const team=(await api.manage(req("p",{action:"addTeam",name:"個人班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当A",teamId:team}))).staffId;
 const product=(await api.manage(req("p",{action:"addPrivateProduct",name:"独自水道契約"}))).productId;
 const before=clone(db.store.get("records/old"));
 const first=await api.submit(req("p",{date:"2026-10-31",staffId:staff,
  counts:{...zero(),NURO:2},privateCounts:{[product]:9},expectedVersion:0}));
 assert.equal(first.totalCount,2);
 assert.equal(first.privateTotalCount,9);
 const own=await api.view(req("p",{date:"2026-10-31"}));
 assert.deepEqual(own.privateProducts.map(p=>({id:p.id,name:p.name,active:p.active})),
  [{id:product,name:"独自水道契約",active:true}]);
 assert.equal(own.records[0].privateTotalCount,9);
 assert.equal(own.records[0].privateCounts[product],9);
 assert.equal(own.records[0].totalCount,2);
 const hub=await api.view(req("h",{date:"2026-10-31"}));
 assert.equal(hub.partners[0].totalCount,2);
 assert.equal(hub.partners[0].counts.NURO,2);
 assert.equal("privateProducts" in hub,false);
 for(const leak of [product,"独自水道契約","privateCount","9"]){
  assert.equal(JSON.stringify(hub).includes(leak),false,leak+" leaked into hub");
 }
 const saved=db.store.get("companies/partner/partnerWorkEntries/2026-10-31__"+staff);
 assert.equal(saved.privateTotalCount,9);
 const shared=db.store.get("companies/hub/partnerWorkCountDays/2026-10-31/reports/partner");
 assert.equal(JSON.stringify(shared).includes("private"),false);
 assert.equal(shared.totalCount,2);
 assert.deepEqual(db.store.get("records/old"),before);
});
test("private counts can be corrected and product disabled without erasing historical counts",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"A班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当B",teamId:team}))).staffId;
 const product=(await api.manage(req("p",{action:"addPrivateProduct",name:"自社限定契約"}))).productId;
 await api.submit(req("p",{date,staffId:staff,counts:zero(),privateCounts:{[product]:4},expectedVersion:0}));
 // Old unchanged 9-key clients cannot erase the new, private count-only ledger.
 await api.submit(req("p",{date,staffId:staff,counts:{...zero(),NURO:1},expectedVersion:1}));
 let own=await api.view(req("p",{date}));
 assert.equal(own.records[0].privateTotalCount,4);
 assert.equal(own.records[0].totalCount,1);
 await api.manage(req("p",{action:"setPrivateProduct",productId:product,
  name:"自社限定契約改名",active:false}));
 own=await api.view(req("p",{date}));
 assert.equal(own.privateProducts[0].active,false);
 assert.equal(own.records[0].privateCounts[product],4);
 await assert.rejects(api.submit(req("p",{date,staffId:staff,counts:zero(),
   privateCounts:{[product]:5},expectedVersion:2})),
  e=>e.code==="failed-precondition");
 const corrected=await api.submit(req("p",{date,staffId:staff,counts:zero(),
   privateCounts:{[product]:0},expectedVersion:2}));
 assert.equal(corrected.privateTotalCount,0);
 const audits=[...db.store.keys()].filter(k=>k.includes("partnerWorkAudits/"));
 assert.equal(audits.length,3);
 assert.equal(db.store.get("companies/hub/partnerWorkCountDays/2026-10-31/reports/partner").totalCount,0);
});
test("private product management is only for owner; money/foreign ID/private key injection are denied",async()=>{
 const {api,req,zero}=setup();
 const team=(await api.manage(req("p",{action:"addTeam",name:"第1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当C",teamId:team}))).staffId;
 for(const name of ["1件20000円","売上500","", "A".repeat(81)]){
  await assert.rejects(api.manage(req("p",{action:"addPrivateProduct",name})),
    e=>e.code==="invalid-argument");
 }
 await assert.rejects(api.manage(req("h",{action:"addPrivateProduct",name:"秘密商品"})),
  e=>e.code==="invalid-argument"||e.code==="permission-denied");
 await assert.rejects(api.submit(req("p",{date:"2026-10-31",staffId:staff,
  counts:zero(),privateCounts:{"foreign":3},expectedVersion:0})),
  e=>e.code==="failed-precondition");
 const product=(await api.manage(req("p",{action:"addPrivateProduct",name:"秘密商品"}))).productId;
 await assert.rejects(api.submit(req("p",{date:"2026-10-31",staffId:staff,
  counts:zero(),privateCounts:{[product]:-1},expectedVersion:0})),
  e=>e.code==="invalid-argument");
 await assert.rejects(api.submit(req("p",{date:"2026-10-31",staffId:staff,
  counts:zero(),privateCounts:{"revenue/price":10},expectedVersion:0})),
  e=>e.code==="invalid-argument");
});

test("prototype-shaping private product keys cannot alter totals or saved records",async()=>{
 const {db,api,req,zero}=setup();
 const team=(await api.manage(req("p",{action:"addTeam",name:"検証班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"確認担当",teamId:team}))).staffId;
 const day="2026-10-31";
 const prior=clone(db.store.get("records/old"));
 for(const bad of ["__proto__","constructor","prototype"]){
  const injected=JSON.parse('{"'+bad+'":7}');
  await assert.rejects(api.submit(req("p",{date:day,staffId:staff,
   counts:zero(),privateCounts:injected,expectedVersion:0})),
   e=>e.code==="invalid-argument",bad+" must never be a saved private count");
 }
 assert.equal(db.store.has("companies/partner/partnerWorkEntries/"+day+"__"+staff),false);
 assert.equal(db.store.has("companies/hub/partnerWorkCountDays/"+day+"/reports/partner"),false);
 assert.deepEqual(db.store.get("records/old"),prior);
 const valid=(await api.manage(req("p",{action:"addPrivateProduct",name:"オリジナル契約"}))).productId;
 const saved=await api.submit(req("p",{date:day,staffId:staff,counts:{...zero(),NURO:1},
   privateCounts:{[valid]:2},expectedVersion:0}));
 assert.equal(saved.totalCount,1);
 assert.equal(saved.privateTotalCount,2);
 const hub=await api.view(req("h",{date:day}));
 assert.equal(hub.partners[0].totalCount,1);
 assert.equal(JSON.stringify(hub).includes("privateTotalCount"),false);
});

test("correcting a prior day's counts after transfer preserves saved team/name, counts and money-free hub",async()=>{
 const {db,api,req,zero}=setup();
 const first=(await api.manage(req("p",{action:"addTeam",name:"旧班"}))).teamId;
 const second=(await api.manage(req("p",{action:"addTeam",name:"新班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"元の担当",teamId:first}))).staffId;
 const date="2026-10-30",key="companies/partner/partnerWorkEntries/"+date+"__"+staff;
 await api.submit(req("p",{date,staffId:staff,counts:{...zero(),NURO:2},expectedVersion:0}));
 const initial=clone(db.store.get(key));
 assert.equal(initial.teamIdSnapshot,first);
 await api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:second}));
 const person=db.store.get("companies/partner/partnerWorkStaff/"+staff);
 assert.equal(person.teamId,second);
 assert.deepEqual(person.teamHistory,[{effectiveDate:"2026-10-31",fromTeamId:first,toTeamId:second}]);
 // Name changes must never rewrite immutable original name attribution.
 db.seed("companies/partner/partnerWorkStaff/"+staff,{...person,name:"現在の担当"});
 const fixed=await api.submit(req("p",{date,staffId:staff,
    counts:{...zero(),NURO:3},expectedVersion:1}));
 assert.equal(fixed.version,2);
 const saved=db.store.get(key);
 assert.equal(saved.teamIdSnapshot,first);
 assert.equal(saved.staffNameSnapshot,"元の担当");
 assert.equal(saved.totalCount,3);
 assert.deepEqual(saved.counts,{...zero(),NURO:3});
 const read=await api.view(req("p",{date}));
 assert.equal(read.records[0].teamIdSnapshot,first);
 const hub=await api.view(req("h",{date}));
 assert.equal(hub.partners[0].totalCount,3);
 assert.equal(JSON.stringify(hub).includes("revenue"),false);
 assert.equal(db.store.get("records/old").totalRevenue,808080);
});

test("partner account transfer appends BOTH user and member history atomically",async()=>{
 const {db,api,req}=setup();
 const one=(await api.manage(req("p",{action:"addTeam",name:"第一班"}))).teamId;
 const two=(await api.manage(req("p",{action:"addTeam",name:"第二班"}))).teamId;
 const invite=await api.manage(req("p",{action:"createInvite",
    email:"l@example.com",teamId:one,role:"leader"}));
 await api.accept(req("l",{token:invite.token,name:"リーダー一"}));
 const initial=[{effectiveDate:"2026-09-01",fromTeamId:null,toTeamId:one}];
 for(const path of ["users/l","companies/partner/members/l"]){
    db.seed(path,{...db.store.get(path),teamHistory:clone(initial)});
 }
 await api.manage(req("p",{action:"moveStaff",staffId:"l",teamId:two}));
 const expected=[...initial,{effectiveDate:"2026-10-31",fromTeamId:one,toTeamId:two}];
 for(const path of ["users/l","companies/partner/members/l",
    "companies/partner/partnerWorkStaff/l"]){
    const data=db.store.get(path);
    assert.equal(data.teamId,two);
    assert.deepEqual(data.teamHistory,path.includes("partnerWorkStaff")?expected.slice(-1):expected);
    if(!path.includes("partnerWorkStaff")){
      assert.equal(data.canViewRevenue,false);
      assert.equal(data.canViewUnitPrice,false);
    }
 }
 const saved=clone(db.store.get("users/l"));
 // Calling the same transfer again must NOT append a second history record.
 await api.manage(req("p",{action:"moveStaff",staffId:"l",teamId:two}));
 assert.deepEqual(db.store.get("users/l"),saved);
});

test("same-day second transfer, invalid history, and 100-item history cap abort all writes",async()=>{
 const {db,api,req}=setup();
 const one=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const two=(await api.manage(req("p",{action:"addTeam",name:"2班"}))).teamId;
 const three=(await api.manage(req("p",{action:"addTeam",name:"3班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"スタッフ",teamId:one}))).staffId;
 const key="companies/partner/partnerWorkStaff/"+staff;
 await api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:two}));
 const moved=clone(db.store.get(key));
 await assert.rejects(api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:three})),
    e=>e.code==="failed-precondition");
 assert.deepEqual(db.store.get(key),moved);
 db.seed(key,{...moved,teamHistory:"invalid"});
 await assert.rejects(api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:three})),
    e=>e.code==="failed-precondition");
 assert.equal(db.store.get(key).teamId,two);
 const tooMany=Array.from({length:100},(_,i)=>({
    effectiveDate:"2026-09-"+String(i%28+1).padStart(2,"0"),
    fromTeamId:one,toTeamId:two
 }));
 db.seed(key,{...moved,teamHistory:tooMany});
 await assert.rejects(api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:three})),
    e=>e.code==="failed-precondition");
 assert.equal(db.store.get(key).teamId,two);
});

test("editing legacy rows without original attribution does not invent today's team",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-30";
 const one=(await api.manage(req("p",{action:"addTeam",name:"A班"}))).teamId;
 const two=(await api.manage(req("p",{action:"addTeam",name:"B班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当",teamId:one}))).staffId;
 await api.submit(req("p",{date,staffId:staff,counts:{...zero(),NURO:1},expectedVersion:0}));
 const key="companies/partner/partnerWorkEntries/"+date+"__"+staff;
 const record=clone(db.store.get(key));
 delete record.teamIdSnapshot;delete record.staffNameSnapshot;
 db.seed(key,record);
 await api.manage(req("p",{action:"moveStaff",staffId:staff,teamId:two}));
 await api.submit(req("p",{date,staffId:staff,
   counts:{...zero(),NURO:2},expectedVersion:1}));
 const saved=db.store.get(key);
 assert.equal(saved.teamIdSnapshot,null);
 assert.equal(saved.staffNameSnapshot,null);
 assert.equal(saved.totalCount,2);
 const view=await api.view(req("p",{date}));
 assert.equal(view.records[0].teamIdSnapshot,null);
});

test("invited inactive partner cannot create teams, invite members, read or save counts",async()=>{
 const {db,api,req,zero}=setup();
 const relation="partnerRelations/partner";
 db.seed(relation,{partnerCompanyId:"partner",hubCompanyId:"hub",
   active:false,countSharingApproved:false});
 const originalCount=db.store.size;
 await assert.rejects(api.manage(req("p",{action:"addTeam",name:"非承認班"})),
   e=>e.code==="permission-denied");
 await assert.rejects(api.view(req("p",{date:"2026-10-31"})),
   e=>e.code==="permission-denied");
 await assert.rejects(api.submit(req("p",{date:"2026-10-31",staffId:"any",
   counts:zero(),expectedVersion:0})),e=>e.code==="permission-denied");
 assert.equal(db.store.size,originalCount);
 assert.equal([...db.store.keys()].some(key=>key.includes("partnerWorkEntries")),false);
});
test("approval revocation removes saved reports from hub view without modifying original records",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"承認班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"登録者",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,counts:{...zero(),NURO:4},expectedVersion:0}));
 const key="companies/hub/partnerWorkCountDays/"+date+"/reports/partner";
 const old=clone(db.store.get(key));
 assert.equal((await api.view(req("h",{date}))).partners[0].totalCount,4);
 for(const state of [
   {active:false,countSharingApproved:true},
   {active:true,countSharingApproved:false},
   {active:false,countSharingApproved:false}
 ]){
   db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",...state});
   assert.deepEqual((await api.view(req("h",{date}))).partners,[]);
   await assert.rejects(api.submit(req("p",{date,staffId:staff,
       counts:zero(),expectedVersion:1})),e=>e.code==="permission-denied");
 }
 assert.deepEqual(db.store.get(key),old);
 assert.equal(db.store.get("records/old").totalRevenue,808080);
});

test("hub lists registered partner companies even before any count report; pending ones cannot be invited",async()=>{
 const {db,api,req}=setup(),date="2026-10-31";
 db.seed("companies/pending",{name:"未稼働協力店",ownerUid:"q",companyKind:"partner",
  hubCompanyId:"hub",active:true});
 db.seed("partnerRelations/pending",{partnerCompanyId:"pending",hubCompanyId:"hub",
  active:false,countSharingApproved:false});
 const result=await api.view(req("h",{date}));
 assert.equal(result.partners.length,0,"unreported partner is NOT a zero-count report");
 assert.deepEqual(result.registeredCompanies.map(x=>[x.partnerCompanyId,x.name,x.active]),[
  ["partner","協力店",true],["pending","未稼働協力店",false]
 ]);
 assert.deepEqual(result.registeredCompanies[1].teams,[]);
 await assert.rejects(api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"pending",
  teamId:"any",email:"x@example.com",role:"leader"})),e=>e.code==="failed-precondition");
 await assert.rejects(api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"pending",
  name:"第1班"})),e=>e.code==="failed-precondition");
 assert.deepEqual([...db.store.keys()].filter(x=>x.includes("partnerWorkInvites/")),[]);
 assert.equal(db.store.get("records/old").totalRevenue,808080);
});
test("hub can add partner team and invite both leader and member using company-first selector",async()=>{
 const {db,api,req}=setup();
 const originalProduct=clone(db.store.get("products/money")),originalSales=clone(db.store.get("records/old"));
 const team=(await api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"partner",
  name:"協力店 1班"}))).teamId;
 let hub=await api.view(req("h",{date:"2026-10-31"}));
 assert.equal(hub.partners.length,0,"new registered partner does not fake a report");
 assert.deepEqual(hub.registeredCompanies[0].teams,[{id:team,name:"協力店 1班"}]);
 for(const [uid,role] of [["l","leader"],["m","member"]]){
  const result=await api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",
   teamId:team,email:uid+"@example.com",role}));
  assert.equal(result.token.length,43);
  const out=await api.accept(req(uid,{token:result.token,name:role==="leader"?"紹介リーダー":"紹介メンバー"}));
  assert.equal(out.joined,true);
  const user=db.store.get("users/"+uid),membership=db.store.get("companies/partner/members/"+uid);
  assert.equal(user.companyId,"partner");
  assert.equal(user.role,role);
  assert.equal(membership.teamId,team);
  for(const data of [user,membership]){
   assert.equal(data.accessKind,"partner");
   assert.equal(data.memberType,"cooperator");
   assert.equal(data.canViewRevenue,false);
   assert.equal(data.canViewUnitPrice,false);
   assert.equal(data.canCreateInvite,false);
  }
  await assert.rejects(api.accept(req(uid,{token:result.token,name:"重複"})),e=>e.code==="failed-precondition");
 }
 assert.deepEqual(db.store.get("products/money"),originalProduct);
 assert.deepEqual(db.store.get("records/old"),originalSales);
 assert.equal(db.store.has("companies/hub/members/l"),false,"hub must not own invited partner member");
});
test("hub cannot invite across companies, impersonate an internal owner or accept after revocation",async()=>{
 const {db,api,req}=setup();
 const team=(await api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"partner",
  name:"協力店 1班"}))).teamId;
 for(const who of ["p","h"]){
  if(who==="h")continue;
  await assert.rejects(api.manage(req(who,{action:"hubCreateInvite",partnerCompanyId:"partner",
   teamId:team,email:"l@example.com",role:"leader"})),e=>e.code==="permission-denied");
 }
 db.seed("companies/foreign-partner",{name:"別会社",ownerUid:"f",companyKind:"partner",hubCompanyId:"else",active:true});
 db.seed("partnerRelations/foreign-partner",{partnerCompanyId:"foreign-partner",
  hubCompanyId:"else",active:true,countSharingApproved:true});
 await assert.rejects(api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"foreign-partner",
  teamId:team,email:"l@example.com",role:"leader"})),e=>e.code==="failed-precondition");
 await assert.rejects(api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",
  teamId:"missing",email:"l@example.com",role:"leader"})),e=>e.code==="failed-precondition");
 const valid=await api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",
  teamId:team,email:"l@example.com",role:"leader"}));
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",
  active:false,countSharingApproved:false});
 await assert.rejects(api.accept(req("l",{token:valid.token,name:"止められた招待"})),
  e=>e.code==="failed-precondition");
 assert.equal(db.store.has("users/l"),false);
 assert.equal(db.store.has("companies/partner/members/l"),false);
 db.seed("users/h",{...db.store.get("users/h"),memberType:"cooperator"});
 await assert.rejects(api.view(req("h",{date:"2026-10-31"})),e=>e.code==="permission-denied");
 await assert.rejects(api.manage(req("h",{action:"hubAddTeam",partnerCompanyId:"partner",
  name:"不正な班"})),e=>e.code==="permission-denied");
});
test("partner invitation panel contains company, team, role and email with no raw finance SDK",()=>{
 const fs=require("node:fs"),html=fs.readFileSync(require("node:path").join(__dirname,"../partner-workspace.html"),"utf8");
 for(const id of ["hubInvitePanel","hubInviteCompanySelect","hubInviteState",
  "hubInviteTeamSelect","hubInviteRoleSelect","hubInviteEmail","hubMakeInvite",
  "hubCreateTeam","hubInviteUrl","hubInviteCopy"])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/action:"hubCreateInvite"/);
 assert.match(html,/action:"hubAddTeam"/);
 assert.match(html,/renderHubInvitePanel\(\)/);
 assert.match(html,/<option value="leader">リーダー<\/option>/);
 assert.match(html,/<option value="member">メンバー<\/option>/);
 assert.doesNotMatch(html,/firebase-firestore\.js|getFirestore\(|\.collection\(["'](?:products|records)["']\)/);
});
test("existing internal Owner switches to SECONDARY partner workspace; original finance stays untouched",async()=>{
 const {db,api,req,zero}=setup();
 const originalUser=clone(db.store.get("users/h"));
 const originalMember=clone(db.store.get("companies/hub/members/h"));
 const originalSales=clone(db.store.get("records/old"));
 const secondary="secondaryPartner";
 db.seed("companies/"+secondary,{name:"協力店テスト",ownerUid:"h",masterUid:"h",
  companyKind:"partner",hubCompanyId:"hub",active:true});
 db.seed("companies/"+secondary+"/members/h",{uid:"h",companyId:secondary,
  companyRole:"owner",role:"leader",teamId:null,active:true,accessKind:"partner",
  memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false});
 db.seed("partnerRelations/"+secondary,{partnerCompanyId:secondary,
  hubCompanyId:"hub",active:true,countSharingApproved:true});
 db.seed("partnerWorkspaceContexts/h",{uid:"h",primaryCompanyId:"hub",
  partnerCompanyId:secondary,hubCompanyId:"hub",
  emailLower:"h@example.com",role:"owner",kind:"partner_secondary",active:true});
 const context={workspaceCompanyId:secondary};
 const team=(await api.manage(req("h",{...context,action:"addTeam",name:"検証班"}))).teamId;
 const staff=(await api.manage(req("h",{...context,action:"addManaged",teamId:team,name:"検証担当"}))).staffId;
 const saved=await api.submit(req("h",{...context,date:"2026-10-31",staffId:staff,
  counts:{...zero(),NURO:2},expectedVersion:0}));
 assert.equal(saved.saved,true);
 const view=await api.view(req("h",{...context,date:"2026-10-31"}));
 assert.equal(view.role,"owner");
 assert.equal(view.companyName,"協力店テスト");
 assert.equal(view.records[0].totalCount,2);
 assert.ok(!JSON.stringify(view).includes("totalRevenue"));
 assert.ok(!JSON.stringify(view).includes("unitPrice"));
 assert.deepEqual(db.store.get("users/h"),originalUser);
 assert.deepEqual(db.store.get("companies/hub/members/h"),originalMember);
 assert.deepEqual(db.store.get("records/old"),originalSales);
 const primary=await api.view(req("h",{date:"2026-10-31"}));
 assert.equal(primary.role,"hub","original internal Owner profile remains intact");
 db.seed("partnerRelations/"+secondary,{partnerCompanyId:secondary,hubCompanyId:"hub",
  active:false,countSharingApproved:false});
 await assert.rejects(api.view(req("h",{...context,date:"2026-10-31"})),
  e=>e.code==="permission-denied");
 await assert.rejects(api.submit(req("h",{...context,date:"2026-10-31",staffId:staff,
  counts:{...zero(),NURO:3},expectedVersion:1})),
  e=>e.code==="permission-denied");
 assert.deepEqual(db.store.get("records/old"),originalSales);
});
test("forged secondary-company ID cannot grant partner Owner access",async()=>{
 const {db,api,req}=setup();
 db.seed("companies/otherPartner",{name:"外国会社",ownerUid:"h",masterUid:"h",
  companyKind:"partner",hubCompanyId:"hub",active:true});
 db.seed("companies/otherPartner/members/h",{uid:"h",companyId:"otherPartner",
  companyRole:"owner",role:"leader",active:true,accessKind:"partner",
  memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false});
 db.seed("partnerRelations/otherPartner",{partnerCompanyId:"otherPartner",
  hubCompanyId:"hub",active:true,countSharingApproved:true});
 const baseline=JSON.stringify([...db.store]);
 await assert.rejects(api.view(req("h",{workspaceCompanyId:"otherPartner",date:"2026-10-31"})),
  e=>e.code==="permission-denied");
 assert.equal(JSON.stringify([...db.store]),baseline);
});

test("registered emails join partner leader/member while source accounts and old financial records remain identical",async()=>{
 const {db,api,req,zero}=setup();
 const originals=new Map();
 for(const [uid,role] of [["l","leader"],["m","member"]]){
   const source={uid,companyId:"hub",email:uid+"@example.com",name:"既存"+uid,
     companyRole:"member",role:"member",teamId:"original",
     active:true,accessKind:"internal",memberType:"direct",
     canViewRevenue:true,canViewUnitPrice:true};
   db.seed("users/"+uid,source);
   db.seed("companies/hub/members/"+uid,{...source});
   originals.set("users/"+uid,clone(source));
   originals.set("companies/hub/members/"+uid,clone(source));
 }
 const oldSales=clone(db.store.get("records/old"));
 const partnerTeam=(await api.manage(req("p",{action:"addTeam",name:"協力店既存メール班"}))).teamId;
 const joined=[];
 for(const [uid,role] of [["l","leader"],["m","member"]]){
  const invite=await api.manage(req("p",{action:"createInvite",email:uid+"@example.com",
    role,teamId:partnerTeam}));
  const result=await api.accept(req(uid,{token:invite.token,name:"既存ユーザー"+uid}));
  assert.equal(result.joined,true);
  assert.equal(result.secondaryMembership,true);
  assert.equal(result.partnerCompanyId,"partner");
  assert.equal(db.store.get("partnerWorkspaceContexts/"+uid).role,role);
  assert.equal(db.store.get("partnerWorkspaceContexts/"+uid).teamId,partnerTeam);
  for(const key of ["users/"+uid,"companies/hub/members/"+uid])
   assert.deepEqual(db.store.get(key),originals.get(key),key+" must not migrate");
  const partner=await api.view(req(uid,{workspaceCompanyId:"partner",date:"2026-10-31"}));
  assert.equal(partner.role,role);
  assert.equal(partner.companyName,"協力店");
  assert.ok(!JSON.stringify(partner).includes("totalRevenue"));
  assert.ok(!JSON.stringify(partner).includes("unitPrice"));
  joined.push(uid);
 }
 assert.deepEqual(joined,["l","m"]);
 const staff=(await api.manage(req("l",{workspaceCompanyId:"partner",
   action:"addManaged",name:"既存メール班担当",teamId:partnerTeam}))).staffId;
 const saved=await api.submit(req("l",{workspaceCompanyId:"partner",
   date:"2026-10-31",staffId:staff,counts:{...zero(),NURO:1},expectedVersion:0}));
 assert.equal(saved.saved,true);
 const own=await api.view(req("l",{workspaceCompanyId:"partner",date:"2026-10-31"}));
 assert.equal(own.records[0].totalCount,1);
 assert.deepEqual(db.store.get("records/old"),oldSales);
 for(const [key,value] of originals)assert.deepEqual(db.store.get(key),value);
});
test("partner Owner changes a secondary staff team without moving original internal staff",async()=>{
 const {db,api,req}=setup();
 const old={uid:"l",companyId:"hub",email:"l@example.com",companyRole:"member",
   role:"member",teamId:"internalTeam",active:true,accessKind:"internal",
   memberType:"direct",canViewRevenue:true,canViewUnitPrice:true};
 db.seed("users/l",old);
 db.seed("companies/hub/members/l",old);
 const original=clone(old),records=clone(db.store.get("records/old"));
 const t1=(await api.manage(req("p",{action:"addTeam",name:"第1班"}))).teamId;
 const t2=(await api.manage(req("p",{action:"addTeam",name:"第2班"}))).teamId;
 const {token}=await api.manage(req("p",{action:"createInvite",email:"l@example.com",
   role:"leader",teamId:t1}));
 await api.accept(req("l",{token,name:"リーダーL"}));
 const moved=await api.manage(req("p",{action:"moveStaff",staffId:"l",teamId:t2}));
 assert.equal(moved.moved,true);
 assert.equal(db.store.get("partnerWorkspaceContexts/l").teamId,t2);
 assert.equal(db.store.get("companies/partner/members/l").teamId,t2);
 assert.equal(db.store.get("companies/partner/partnerWorkStaff/l").teamId,t2);
 assert.equal(db.store.get("partnerWorkspaceContexts/l").teamHistory.length,1);
 assert.deepEqual(db.store.get("users/l"),original);
 assert.deepEqual(db.store.get("companies/hub/members/l"),original);
 assert.deepEqual(db.store.get("records/old"),records);
 const view=await api.view(req("l",{workspaceCompanyId:"partner",date:"2026-10-31"}));
 assert.equal(view.role,"leader");
 assert.equal(view.teamId,t2);
});
test("forged or revoked secondary staff workspace is denied without changes to original profiles",async()=>{
 const {db,api,req}=setup();
 const old={uid:"l",companyId:"hub",email:"l@example.com",companyRole:"member",
   role:"member",teamId:"old",active:true,accessKind:"internal"};
 db.seed("users/l",old);
 db.seed("companies/hub/members/l",{...old});
 const team=(await api.manage(req("p",{action:"addTeam",name:"協力店班"}))).teamId;
 const {token}=await api.manage(req("p",{action:"createInvite",
   email:"l@example.com",teamId:team,role:"leader"}));
 await api.accept(req("l",{token,name:"既存リーダー"}));
 const options={workspaceCompanyId:"partner",date:"2026-10-31"};
 for(const mutation of [
  ()=>db.store.get("partnerWorkspaceContexts/l").role="owner",
  ()=>db.store.get("partnerWorkspaceContexts/l").partnerCompanyId="other",
  ()=>db.store.get("partnerRelations/partner").active=false
 ]){
  const originalCtx=clone(db.store.get("partnerWorkspaceContexts/l"));
  const originalRel=clone(db.store.get("partnerRelations/partner"));
  mutation();
  await assert.rejects(api.view(req("l",options)),e=>e.code==="permission-denied");
  db.seed("partnerWorkspaceContexts/l",originalCtx);
  db.seed("partnerRelations/partner",originalRel);
 }
 assert.equal(db.store.get("users/l").companyId,"hub");
 assert.equal(db.store.get("users/l").accessKind,"internal");
});
test("invalid old-company identities and duplicate context cannot accept a partner staff invite",async()=>{
 for(const defect of ["no-member","foreign-company","partner-marker","duplicate-context"]){
  const {db,api,req}=setup();
  const old={uid:"l",companyId:"hub",email:"l@example.com",
    companyRole:"member",role:"member",teamId:"A",active:true,accessKind:"internal"};
  if(defect==="partner-marker")old.accessKind="partner";
  db.seed("users/l",old);
  if(defect!=="no-member")db.seed("companies/hub/members/l",{
    ...old,companyId:defect==="foreign-company"?"else":"hub"});
  if(defect==="duplicate-context")db.seed("partnerWorkspaceContexts/l",{
    uid:"l",kind:"partner_secondary",active:true,partnerCompanyId:"other"});
  const team=(await api.manage(req("p",{action:"addTeam",name:"検証班"}))).teamId;
  const {token}=await api.manage(req("p",{action:"createInvite",
    role:"member",email:"l@example.com",teamId:team}));
  const before=clone([...db.store]);
  await assert.rejects(api.accept(req("l",{token,name:"別名"})),
    e=>e.code==="failed-precondition");
  assert.deepEqual([...db.store],before);
 }
});
test("hub can inspect partner-company per-team shared product counts without finance or private products",async()=>{
 const {db,api,req,zero}=setup();
 const t1=(await api.manage(req("p",{action:"addTeam",name:"協力店1班"}))).teamId;
 const t2=(await api.manage(req("p",{action:"addTeam",name:"協力店2班"}))).teamId;
 const a=(await api.manage(req("p",{action:"addManaged",name:"担当1",teamId:t1}))).staffId;
 const b=(await api.manage(req("p",{action:"addManaged",name:"担当2",teamId:t2}))).staffId;
 const date="2026-10-31";
 await api.submit(req("p",{date,staffId:a,counts:{...zero(),NURO:2,YMMNP:1},expectedVersion:0}));
 await api.submit(req("p",{date,staffId:b,counts:zero(),expectedVersion:0}));
 const rawBefore=clone(db.store.get("records/old"));
 const totals=(await api.view(req("h",{date,partnerCompanyId:"partner"})));
 assert.equal(totals.role,"hub");
 assert.equal(totals.partnerTeamDetails.partnerCompanyId,"partner");
 assert.equal(totals.partnerTeamDetails.scope,"shared_counts_only");
 const rows=totals.partnerTeamDetails.teams;
 assert.equal(rows.length,2);
 assert.equal(rows.find(x=>x.teamId===t1).totalCount,3);
 assert.equal(rows.find(x=>x.teamId===t1).counts.NURO,2);
 assert.equal(rows.find(x=>x.teamId===t2).totalCount,0);
 assert.equal(rows.find(x=>x.teamId===t2).reportedStaffCount,1,
   "zero count is a submitted report, not a missing report");
 assert.equal(totals.partnerTeamDetails.unverifiedTeamCount,0);
 assert.equal(totals.partnerTeamDetails.unreconciledWithCompanyReport,false);
 const payload=JSON.stringify(totals.partnerTeamDetails);
 for(const key of ["revenuePerUnit","totalRevenue","privateProducts","privateCounts",
  "email","unitPrice","staffId"])assert.equal(payload.includes(key),false,key+" leaked");
 assert.deepEqual(db.store.get("records/old"),rawBefore);
});
test("hub team counts cannot silently attribute legacy or moved staff to their current team",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const t=(await api.manage(req("p",{action:"addTeam",name:"班A"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当者A",teamId:t}))).staffId;
 await api.submit(req("p",{date,staffId:staff,
  counts:{...zero(),NURO:5},expectedVersion:0}));
 const key="companies/partner/partnerWorkEntries/"+date+"__"+staff;
 db.seed(key,{...db.store.get(key),teamIdSnapshot:null});
 const view=await api.view(req("h",{date,partnerCompanyId:"partner"}));
 assert.equal(view.partnerTeamDetails.teams[0].totalCount,0);
 assert.equal(view.partnerTeamDetails.teams[0].reportedStaffCount,0);
 assert.equal(view.partnerTeamDetails.unverifiedTeamCount,5);
 assert.equal(view.partnerTeamDetails.unreconciledWithCompanyReport,false);
});
test("hub cannot query other hub's, pending, revoked or forged partner team details",async()=>{
 const {db,api,req}=setup(),date="2026-10-31";
 const before=JSON.stringify([...db.store]);
 for(const id of ["unknown","other-company","__proto__"]){
  await assert.rejects(api.view(req("h",{date,partnerCompanyId:id})),
   e=>e.code==="permission-denied"||e.code==="invalid-argument");
 }
 assert.equal(JSON.stringify([...db.store]),before);
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",
  active:false,countSharingApproved:false});
 await assert.rejects(api.view(req("h",{date,partnerCompanyId:"partner"})),
  e=>e.code==="permission-denied");
 await assert.rejects(api.view(req("p",{date,partnerCompanyId:"other-company"})),
  e=>e.code==="permission-denied");
});
test("hub can read verified partner TEAM counts; submitted zero is never missing",async()=>{
 const {db,api,req,zero}=setup();
 const a=(await api.manage(req("p",{action:"addTeam",name:"第1班"}))).teamId;
 const b=(await api.manage(req("p",{action:"addTeam",name:"第2班"}))).teamId;
 const staffA=(await api.manage(req("p",{action:"addManaged",name:"山田",teamId:a}))).staffId;
 await api.manage(req("p",{action:"addManaged",name:"田中",teamId:b}));
 const original=clone(db.store.get("records/old"));
 await api.submit(req("p",{date:"2026-10-31",staffId:staffA,counts:zero(),expectedVersion:0}));
 const normal=await api.view(req("h",{date:"2026-10-31"}));
 assert.equal("teamReports" in normal,false,"ordinary daily view must not add expensive scans");
 const report=await api.view(req("h",{
  date:"2026-10-31",includeTeamStatus:true,partnerCompanyId:"partner"
 }));
 assert.equal(report.teamStatusComplete,true);
 assert.equal(report.teamReports.length,1);
 const statuses=new Map(report.teamReports[0].teams.map(x=>[x.id,x]));
 assert.equal(statuses.get(a).status,"submitted");
 assert.equal(statuses.get(a).totalCount,0);
 assert.equal(statuses.get(a).reportedStaffCount,1);
 assert.equal(statuses.get(b).status,"missing");
 assert.equal(statuses.get(b).staffCount,1);
 assert.equal(statuses.get(b).reportedStaffCount,0);
 assert.equal(statuses.get(b).counts.NURO,0);
 assert.equal(report.teamReports[0].verified,true);
 const viewJSON=JSON.stringify(report);
 for(const money of ["totalRevenue","revenuePerUnit","unitPrice","pricingOptions", "98765","808080"])
  assert.equal(viewJSON.includes(money),false,"money leaked: "+money);
 assert.deepEqual(db.store.get("records/old"),original);
});
test("ambiguous old team snapshot never labels the rest of a partner company falsely missing",async()=>{
 const {db,api,req,zero}=setup();
 const one=(await api.manage(req("p",{action:"addTeam",name:"班1"}))).teamId;
 const two=(await api.manage(req("p",{action:"addTeam",name:"班2"}))).teamId;
 const a=(await api.manage(req("p",{action:"addManaged",name:"山田",teamId:one}))).staffId;
 await api.manage(req("p",{action:"addManaged",name:"田中",teamId:two}));
 await api.submit(req("p",{date:"2026-10-31",staffId:a,counts:{...zero(),NURO:2},expectedVersion:0}));
 const path="companies/partner/partnerWorkEntries/2026-10-31__"+a;
 db.seed(path,{...db.store.get(path),teamIdSnapshot:null});
 const result=await api.view(req("h",{date:"2026-10-31",includeTeamStatus:true}));
 assert.equal(result.teamReports[0].verified,false);
 assert.ok(result.teamReports[0].teams.every(x=>x.status!=="missing"));
 assert.ok(result.teamReports[0].teams.some(x=>x.status==="unverified"));
});
test("revoke partner approval rejects team count projection without leaking old history",async()=>{
 const {db,api,req}=setup();
 const old=clone(db.store.get("records/old"));
 db.seed("partnerRelations/partner",{
  partnerCompanyId:"partner",hubCompanyId:"hub",active:false,countSharingApproved:false});
 const result=await api.view(req("h",{date:"2026-10-31",includeTeamStatus:true}));
 assert.deepEqual(result.teamReports,[]);
 assert.equal(result.registeredCompanies[0].active,false);
 await assert.rejects(api.view(req("h",{date:"2026-10-31",
  includeTeamStatus:true,partnerCompanyId:"partner"})),e=>e.code==="permission-denied");
 assert.deepEqual(db.store.get("records/old"),old);
});
test("only real hub Owner can request detailed partner-company team status",async()=>{
 const {api,req}=setup();
 await assert.rejects(api.view(req("p",{date:"2026-10-31",
  includeTeamStatus:true,partnerCompanyId:"hub"})),e=>e.code==="permission-denied");
});

test("same Firebase email transfers from internal active roster to partner without losing historical sales",async()=>{
 const {db,api,req,zero}=setup();
 const beforeUser={uid:"m",companyId:"hub",email:"m@example.com",name:"以前の自社メンバー",
   companyRole:"member",role:"member",teamId:"oldTeam",active:true,
   accessKind:"internal",memberType:"direct",teamHistory:[{
    effectiveDate:"2026-10-30",fromTeamId:"olderTeam",toTeamId:"oldTeam"
   }],canViewRevenue:true,canViewUnitPrice:true,canCreateInvite:true,
   originalField:"keep archive"};
 const beforeMember={...beforeUser,joinedAt:"2026-01-01"};
 db.seed("users/m",beforeUser);
 db.seed("companies/hub/members/m",beforeMember);
 const sales=clone(db.store.get("records/old")),prices=clone(db.store.get("products/money"));
 const team=(await api.manage(req("p",{action:"addTeam",name:"移籍先班"}))).teamId;
 const invite=await api.manage(req("h",{action:"hubCreateInvite",partnerCompanyId:"partner",
   teamId:team,role:"member",email:"m@example.com"}));
 const res=await api.accept(req("m",{token:invite.token,name:"新しい協力店メンバー",
   transferCurrentCompany:true}));
 assert.equal(res.joined,true);
 assert.equal(res.transferredFromInternal,true);
 assert.equal(res.secondaryMembership,false);
 assert.equal(db.store.get("partnerWorkspaceContexts/m"),undefined);
 const newUser=db.store.get("users/m");
 assert.equal(newUser.companyId,"partner");
 assert.equal(newUser.uid,"m");
 assert.equal(newUser.role,"member");
 assert.equal(newUser.canViewRevenue,false);
 assert.equal(newUser.canViewUnitPrice,false);
 assert.equal(newUser.canCreateInvite,false);
 assert.equal(newUser.teamHistory,undefined,"old teamHistory must not be misattributed to partner");
 assert.equal(newUser.originalField,undefined,"old profile must not be merged");
 const oldMember=db.store.get("companies/hub/members/m");
 assert.equal(oldMember.active,false);
 assert.deepEqual({...oldMember,active:true,updatedAt:undefined},
   {...beforeMember,updatedAt:undefined},"only old roster activation may change");
 const historical=db.store.get("partnerHistoricalTransfers/m");
 assert.equal(historical.uid,"m");
 assert.equal(historical.sourceCompanyId,"hub");
 assert.equal(historical.destinationCompanyId,"partner");
 assert.deepEqual(historical.originalUser,beforeUser);
 assert.deepEqual(historical.originalMember,beforeMember);
 assert.deepEqual(db.store.get("records/old"),sales);
 assert.deepEqual(db.store.get("products/money"),prices);
 const self=await api.view(req("m",{date:"2026-10-31"}));
 assert.equal(self.role,"member");
 assert.equal(self.companyName,"協力店");
 assert.ok(!JSON.stringify(self).includes("canViewRevenue"));
 const submitted=await api.submit(req("m",{date:"2026-10-31",staffId:"m",
   counts:{...zero(),NURO:1},expectedVersion:0}));
 assert.equal(submitted.saved,true);
 await assert.rejects(api.accept(req("m",{token:invite.token,name:"二重加入",
  transferCurrentCompany:true})),e=>e.code==="failed-precondition");
});
test("existing email of legacy internal leader without companyRole transfers and keeps original counts",async()=>{
 const {db,api,req}=setup();
 const oldUser={uid:"l",companyId:"hub",email:"l@example.com",
   name:"元自社リーダー",role:"leader",teamId:"oldTeam",active:true,
   accessKind:"internal",memberType:"internal",
   canViewRevenue:true,canViewUnitPrice:true,
   teamHistory:[{effectiveDate:"2026-09-30",fromTeamId:"old0",toTeamId:"oldTeam"}]};
 const oldMember={...oldUser,joinedAt:"2025-10-01"};
 db.seed("users/l",oldUser);
 db.seed("companies/hub/members/l",oldMember);
 const savedSales=clone(db.store.get("records/old"));
 const savedPrices=clone(db.store.get("products/money"));
 const team=(await api.manage(req("p",{action:"addTeam",name:"協力店移籍班"}))).teamId;
 const invite=await api.manage(req("h",{action:"hubCreateInvite",
   partnerCompanyId:"partner",teamId:team,role:"leader",email:"l@example.com"}));
 const result=await api.accept(req("l",{token:invite.token,
   name:"移籍後リーダー",transferCurrentCompany:true}));
 assert.equal(result.joined,true);
 assert.equal(result.transferredFromInternal,true);
 assert.equal(db.store.get("users/l").companyId,"partner");
 assert.equal(db.store.get("users/l").canViewRevenue,false);
 assert.equal(db.store.get("users/l").canViewUnitPrice,false);
 assert.equal(db.store.get("companies/hub/members/l").active,false);
 const archive=db.store.get("partnerHistoricalTransfers/l");
 assert.deepEqual(archive.originalUser,oldUser);
 assert.deepEqual(archive.originalMember,oldMember);
 assert.deepEqual(db.store.get("records/old"),savedSales);
 assert.deepEqual(db.store.get("products/money"),savedPrices);
 const profile=await api.view(req("l",{date:"2026-10-31"}));
 assert.equal(profile.role,"leader");
 assert.equal(profile.companyName,"協力店");
});
test("legacy missing companyRole cannot permit transfer of an actual source owner",async()=>{
 const {db,api,req}=setup();
 const oldUser={uid:"l",companyId:"hub",email:"l@example.com",
   name:"オーナー",role:"leader",teamId:"oldTeam",active:true,
   accessKind:"internal"};
 db.seed("users/l",oldUser);
 db.seed("companies/hub/members/l",{...oldUser});
 db.seed("companies/hub",{...db.store.get("companies/hub"),ownerUid:"l"});
 const team=(await api.manage(req("p",{action:"addTeam",name:"移籍不可班"}))).teamId;
 const invitation=await api.manage(req("p",{action:"createInvite",
   teamId:team,role:"leader",email:"l@example.com"}));
 const before=clone([...db.store.entries()]);
 await assert.rejects(api.accept(req("l",{token:invitation.token,
   name:"不正な移籍",transferCurrentCompany:true})),e=>e.code==="failed-precondition");
 assert.deepEqual([...db.store.entries()],before);
 assert.equal(db.store.has("partnerHistoricalTransfers/l"),false);
});
test("internal owner, foreign-company invite, expired invite and invalid transfer input never migrate original records",async()=>{
 for(const defect of ["owner","foreign","expired","invalid-input"]){
  const {db,api,req}=setup();
  const source={uid:"l",companyId:defect==="foreign"?"foreign":"hub",
   email:"l@example.com",name:"元社員",companyRole:defect==="owner"?"owner":"member",
   role:"leader",teamId:"old",active:true,accessKind:"internal"};
  if(defect==="owner")db.seed("companies/hub",{...db.store.get("companies/hub"),ownerUid:"l"});
  if(defect==="foreign")db.seed("companies/foreign",{active:true,companyKind:"internal",ownerUid:"foreignOwner"});
  const oldCompany=source.companyId;
  db.seed("users/l",source);db.seed("companies/"+oldCompany+"/members/l",{...source});
  const team=(await api.manage(req("p",{action:"addTeam",name:"対象班"}))).teamId;
  const invitation=await api.manage(req("p",{action:"createInvite",email:"l@example.com",
   teamId:team,role:"leader"}));
  if(defect==="expired"){
   const hash=require("node:crypto").createHash("sha256").update(invitation.token).digest("hex");
   db.store.get("partnerWorkInvites/"+hash).expiresAt={toMillis:()=>NOW-1000};
  }
  const originalState=clone([...db.store.entries()]);
  const value=defect==="invalid-input"?"yes":true;
  await assert.rejects(api.accept(req("l",{token:invitation.token,name:"新しい名前",
   transferCurrentCompany:value})),e=>
    ["failed-precondition","invalid-argument"].includes(e.code));
  assert.deepEqual([...db.store.entries()],originalState);
  assert.equal(db.store.has("partnerHistoricalTransfers/l"),false);
 }
});
test("new email registration is not treated as internal transfer even if transfer option checked",async()=>{
 const {db,api,req}=setup();
 const team=(await api.manage(req("p",{action:"addTeam",name:"通常登録"}))).teamId;
 const inv=await api.manage(req("p",{action:"createInvite",email:"m@example.com",
  teamId:team,role:"member"}));
 const output=await api.accept(req("m",{token:inv.token,name:"初めての登録",
  transferCurrentCompany:true}));
 assert.equal(output.secondaryMembership,false);
 assert.equal(output.transferredFromInternal,false);
 assert.equal(db.store.get("users/m").companyId,"partner");
 assert.equal(db.store.has("partnerHistoricalTransfers/m"),false);
});
test("same-email login guidance and explicit transfer action exist in invite UI",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const p=fs.readFileSync(path.join(__dirname,"../partner-workspace.html"),"utf8");
 const invite=fs.readFileSync(path.join(__dirname,"../partner-invite.html"),"utf8");
 assert.match(p,/id="transferExistingInternal"/);
 assert.match(p,/transferCurrentCompany:\$\("transferExistingInternal"\)\.checked/);
 assert.match(p,/auth\/email-already-in-use/);
 assert.match(invite,/auth\/email-already-in-use/);
});

test("new approved monthly and daily ranking API excludes finance and OFF counts, without mutating source",async()=>{
 const {db,api,req,zero}=setup(true),date="2026-10-31";
 db.seed("products/nuro",{companyId:"hub",name:"NURO光",active:true,unitPrice:10000});
 db.seed("products/ym",{companyId:"hub",name:"YM純新規",active:true,unitPrice:20000});
 db.seed("companies/hub/rankingProductVisibility/shared",{
  hubCompanyId:"hub",ownerUid:"h",version:1,
  enabledHubProductIds:["nuro","ym"],partnerOverrides:{partner:["nuro"]}});
 db.seed("companies/hub/rankingSkuMappings/shared",{
  hubCompanyId:"hub",ownerUid:"h",reviewedByUid:"h",active:true,version:1,
  bindings:[{companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
   {companyId:"partner",productId:"partnerSku04",hubProductId:"ym"}]});
 db.seed("companies/hub/rankingCountPublicCatalog/shared",{
  schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:"hub",
  ownerUid:"h",version:1,products:[
   {id:"nuro",companyId:"hub",name:"NURO光",active:true},
   {id:"ym",companyId:"hub",name:"YM純新規",active:true}]});
 Object.assign(db.store.get("partnerRelations/partner"),{
  combinedRankingApprovedByHub:true,combinedRankingApprovedByPartner:true,
  individualNamesApprovedByHub:true,individualNamesApprovedByPartner:true
 });
 for(const [companyId,otherId,uid] of [["hub","partner","h"],["partner","hub","p"]])
  db.seed("companies/"+companyId+"/rankingApprovals/"+otherId,{
   companyId,hubCompanyId:"hub",partnerCompanyId:"partner",
   approvedByUid:uid,active:true,scope:"combined_rank_only",version:1,
   combinedRankingApproved:true,individualNamesApproved:true
  });
 const team=(await api.manage(req("p",{action:"addTeam",name:"集計班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"検証担当",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,counts:{...zero(),NURO:3,"YM純新規":7},expectedVersion:0}));
 const before=clone([...db.store]);
 const owner=await api.view(req("h",{date,sharedCountRankings:true,rankingPeriod:"month"}));
 const partner=await api.view(req("p",{date,sharedCountRankings:true,rankingPeriod:"day"}));
 for(const result of [owner,partner]){
  assert.equal(result.scope,"approved_partner_counts_only");
  assert.equal(result.fullyJoint,false);
  assert.equal(result.includesDirect,false);
  assert.equal(result.totalCount,3);
  assert.equal(result.companies[0].totalCount,3);
  assert.equal(result.people[0].totalCount,3);
  assert.equal(result.teams[0].totalCount,3);
  assert.deepEqual(result.products.map(x=>x.name),["NURO"]);
  assert.equal(result.people[0].rank,1);
  assert.doesNotMatch(JSON.stringify(result),/YM純新規|unitPrice|revenue|70000|updatedByUid|privateCounts|cbCounts|memberUid/);
 }
 assert.equal(owner.period,"month");
 assert.equal(owner.start,"2026-10-01");
 assert.equal(owner.end,date);
 assert.equal(partner.period,"day");
 assert.equal(partner.start,date);
 assert.deepEqual([...db.store],before,"ranking reads may not write existing source records or settings");
 // The old company-level quick count is used only on dates with no staff
 // source; a second quick report on an already verified staff day is ignored.
 db.seed("companies/hub/partnerQuickCountDays/2026-10-30/reports/partner",{
  hubCompanyId:"hub",partnerCompanyId:"partner",date:"2026-10-30",
  partnerCompanyName:"協力店",version:1,
  counts:{...zero(),NURO:4},totalCount:4,
  cashback:123456,unitPrice:50000
 });
 db.seed("companies/hub/partnerQuickCountDays/2026-10-31/reports/partner",{
  hubCompanyId:"hub",partnerCompanyId:"partner",date:"2026-10-31",
  partnerCompanyName:"協力店",version:1,
  counts:{...zero(),NURO:999},totalCount:999
 });
 const mixed=await api.view(req("h",{
  date,sharedCountRankings:true,rankingPeriod:"month"
 }));
 assert.equal(mixed.totalCount,7,"company-only fallback counts once");
 assert.equal(mixed.people[0].totalCount,3,"legacy company-only count is never fabricated as staff");
 assert.equal(mixed.historicalCompanyOnlyCount,4);
 assert.equal(mixed.peopleComplete,false);
 assert.equal(mixed.companies[0].totalCount,7);
 assert.doesNotMatch(JSON.stringify(mixed),/cashback|unitPrice|123456|50000|999/);
 db.store.get("companies/hub/rankingProductVisibility/shared").partnerOverrides.partner=[];
 const off=await api.view(req("p",{date,sharedCountRankings:true}));
 assert.equal(off.companies.length,0,"OFF must not masquerade as saved 0");
 assert.equal(off.products.length,0,"OFF SKUs cannot appear in partner rankings");
 assert.equal(db.store.get("companies/partner/partnerWorkEntries/"+date+"__"+staff).counts.NURO,3);
 // Revoking either owner's name consent must close the new ranking path,
 // without modifying a single saved report.
 db.store.get("partnerRelations/partner").individualNamesApprovedByPartner=false;
 await assert.rejects(api.view(req("h",{date,sharedCountRankings:true})),{
  code:"failed-precondition"
 });
 assert.equal(db.store.get("companies/partner/partnerWorkEntries/"+date+"__"+staff).counts.NURO,3);
});
test("new ranking mode defaults disabled; missing approved mapping fails closed",async()=>{
 const standard=setup();
 await assert.rejects(standard.api.view(standard.req("h",{
  date:"2026-10-31",sharedCountRankings:true})),{code:"unavailable"});
 const on=setup(true);
 await assert.rejects(on.api.view(on.req("h",{
  date:"2026-10-31",sharedCountRankings:true})),{code:"failed-precondition"});
});
test("cross-company forgery cannot escape the server owned relation scope",async()=>{
 const {db,api,req,zero}=setup(true);
 db.seed("companies/hub/rankingProductVisibility/shared",{
  hubCompanyId:"hub",ownerUid:"h",version:1,
  enabledHubProductIds:["nuro"],partnerOverrides:{}});
 db.seed("companies/hub/rankingSkuMappings/shared",{
  hubCompanyId:"hub",ownerUid:"h",reviewedByUid:"h",active:true,version:1,bindings:[]});
 db.seed("products/nuro",{companyId:"hub",name:"NURO光",active:true});
 await assert.rejects(api.view(req("p",{
  date:"2026-10-31",sharedCountRankings:true,partnerCompanyId:"foreign"
 })),{code:"invalid-argument"});
 db.store.get("partnerRelations/partner").countSharingApproved=false;
 const snapshot=clone([...db.store]);
 await assert.rejects(api.view(req("p",{
  date:"2026-10-31",sharedCountRankings:true
 })),{code:"permission-denied"});
 assert.deepEqual([...db.store],snapshot);
});

// Staging only: real partner submit/correction path uses server-verified SKU
// publication inside the same Firestore transaction. No production flags set.
test("transactional partner save honors owner ON/OFF and preserves historical OFF counts",async()=>{
 const {db,api,req,zero}=setup(false,true);
 db.seed("products/money",{...db.store.get("products/money"),name:"内部専用商材",active:true});
 db.seed("products/nuro",{companyId:"hub",name:"NURO",active:true,unitPrice:50000});
 db.seed("products/combined",{companyId:"hub",name:"SB光・AIR（旧合算・未分類）",active:true,unitPrice:9000});
 db.seed("companies/hub/rankingCountPublicCatalog/shared",{
  schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:"hub",ownerUid:"h",version:1,
  products:[{id:"money",companyId:"hub",name:"内部専用商材",active:true},
   {id:"nuro",companyId:"hub",name:"NURO",active:true},
   {id:"combined",companyId:"hub",name:"SB光・AIR（旧合算・未分類）",active:true}]});
 db.seed("companies/hub/rankingProductVisibility/shared",{
  hubCompanyId:"hub",ownerUid:"h",version:1,
  enabledHubProductIds:["nuro","combined"],partnerOverrides:{}});
 db.seed("companies/hub/rankingSkuMappings/shared",{
  hubCompanyId:"hub",ownerUid:"h",reviewedByUid:"h",active:true,version:1,
  bindings:[{companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
   {companyId:"partner",productId:"partnerSku05",hubProductId:"combined"}]});
 const money=clone(db.store.get("products/money"));
 const original=clone(db.store.get("records/old"));
 const team=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"保存担当",teamId:team}))).staffId;
 const date="2026-10-31";
 const save=(counts,version)=>api.submit(req("p",{date,staffId:staff,counts,expectedVersion:version}));
 await save({...zero(),NURO:2,"SB光・AIR":3},0);
 const beforeUnsupported=clone([...db.store]);
 await assert.rejects(api.submit(req("p",{
  date,staffId:staff,expectedVersion:1,counts:{...zero(),NURO:2,"SB光・AIR":3},
  cbCounts:{NURO:{"20000":2}}
 })),{code:"failed-precondition"});
 assert.deepEqual([...db.store],beforeUnsupported,
  "Unsupported cashback tiers must not be silently discarded or persisted");
 const visibility=db.store.get("companies/hub/rankingProductVisibility/shared");
 const publicCatalog=db.store.get("companies/hub/rankingCountPublicCatalog/shared");
 visibility.enabledHubProductIds=["nuro"];visibility.version++;publicCatalog.version++;
 const hidden=await api.view(req("p",{date}));
 assert.deepEqual(hidden.enabledCategories,["NURO"]);
 assert.equal(hidden.records[0].counts.NURO,2);
 assert.equal(hidden.records[0].counts["SB光・AIR"],0,"OFF is never copied to partner HTTP");
 assert.equal(hidden.records[0].totalCount,2);
 assert.equal(db.store.get("companies/partner/partnerWorkEntries/"+date+"__"+staff).counts["SB光・AIR"],3);
 // The browser sends zero for OFF. The same trusted transaction restores
 // the original stored OFF value while saving the new ON figure.
 await save({...zero(),NURO:4,"SB光・AIR":0},1);
 const entryPath="companies/partner/partnerWorkEntries/"+date+"__"+staff;
 const summaryPath="companies/hub/partnerWorkCountDays/"+date+"/reports/partner";
 assert.deepEqual(db.store.get(entryPath).counts,{...zero(),NURO:4,"SB光・AIR":3});
 assert.deepEqual(db.store.get(summaryPath).counts,{...zero(),NURO:4,"SB光・AIR":3});
 assert.equal(db.store.get(summaryPath).totalCount,7);
 const before=clone([...db.store]);
 await assert.rejects(save({...zero(),NURO:4,"SB光・AIR":3},2),e=>e.code==="failed-precondition");
 assert.deepEqual([...db.store],before,"OFF history cannot be explicitly edited by a forged browser");
 visibility.partnerOverrides={partner:[]};visibility.version++;publicCatalog.version++;
 await assert.rejects(save({...zero(),NURO:0,"SB光・AIR":0},2),e=>e.code==="failed-precondition");
 assert.deepEqual(db.store.get(entryPath).counts,{...zero(),NURO:4,"SB光・AIR":3});
 // Turning ON again reveals the original count; its history was not zeroed.
 visibility.partnerOverrides={};visibility.enabledHubProductIds=["nuro","combined"];
 visibility.version++;publicCatalog.version++;
 const restored=await api.view(req("p",{date}));
 assert.deepEqual(restored.enabledCategories,["NURO","SB光・AIR"]);
 assert.equal(restored.records[0].counts["SB光・AIR"],3);
 await save({...zero(),NURO:5,"SB光・AIR":3},2);
 assert.equal(db.store.get(summaryPath).totalCount,8);
 assert.equal([...db.store.keys()].filter(k=>k.includes("partnerWorkAudits/")).length,3);
 assert.deepEqual(db.store.get("records/old"),original);
 assert.deepEqual(db.store.get("products/money"),money);
});
test("publication policy missing or forged SKU mapping fails without creating a count or audit",async()=>{
 const {db,api,req,zero}=setup(false,true);
 const team=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"入力担当",teamId:team}))).staffId;
 const before=clone([...db.store]);
 await assert.rejects(api.submit(req("p",{date:"2026-10-31",staffId:staff,
  counts:{...zero(),NURO:1},expectedVersion:0})),e=>e.code==="failed-precondition");
 assert.deepEqual([...db.store],before);
});


test("same-app location and working-team are saved, read back and audited without finance",async()=>{
 const {db,api,req,zero}=setup();
 const t1=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const t2=(await api.manage(req("p",{action:"addTeam",name:"2班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"テスト担当",teamId:t1}))).staffId;
 const date="2026-10-31",path="companies/partner/partnerWorkEntries/"+date+"__"+staff;
 const financialBefore=clone(db.store.get("records/old"));
 const productBefore=clone(db.store.get("products/money"));
 const first=await api.submit(req("p",{date,staffId:staff,
  workTeamId:t2,workLocation:"広島市 検証現場",
  counts:{...zero(),NURO:2},expectedVersion:0}));
 assert.equal(first.saved,true);
 const read=await api.view(req("p",{date}));
 const entry=read.records.find(x=>x.staffId===staff);
 assert.equal(entry.version,1);
 assert.equal(entry.teamIdSnapshot,t2);
 assert.equal(entry.workLocation,"広島市 検証現場");
 assert.equal(entry.counts.NURO,2);
 assert.equal(entry.totalCount,2);
 assert.equal(db.store.get(path).workLocation,"広島市 検証現場");
 await api.submit(req("p",{date,staffId:staff,
  counts:{...zero(),NURO:3},expectedVersion:1}));
 const latest=(await api.view(req("p",{date}))).records.find(x=>x.staffId===staff);
 assert.equal(latest.workLocation,"広島市 検証現場",
  "standalone partner save must not silently remove same-app location");
 assert.equal(latest.teamIdSnapshot,t2,"corrections cannot reassign original team");
 assert.equal(latest.version,2);
 const saved=clone([...db.store]);
 await assert.rejects(api.submit(req("p",{date,staffId:staff,expectedVersion:2,
  workTeamId:t1,counts:{...zero(),NURO:5}})),{code:"failed-precondition"});
 await assert.rejects(api.submit(req("p",{date,staffId:staff,expectedVersion:2,
  workLocation:"単価15000円",counts:{...zero(),NURO:5}})),{code:"invalid-argument"});
 assert.deepEqual([...db.store],saved);
 assert.equal([...db.store.keys()].filter(k=>k.includes("partnerWorkAudits/")).length,2);
 assert.deepEqual(db.store.get("records/old"),financialBefore);
 assert.deepEqual(db.store.get("products/money"),productBefore);
});


test("Owner correction read/write are independently OFF until signed deployment",async()=>{
 const d={date:"2026-10-31",partnerCompanyId:"partner"};
 for(const args of [[],[false,false,false,true]]){
  const {api,req}=setup(...args);
  await assert.rejects(api.listHubPartnerCounts(req("h",d)),{code:"unavailable"});
  await assert.rejects(api.correctHubPartnerCounts(req("h",d)),{code:"unavailable"});
 }
 const {api,req}=setup(false,false,true,false);
 const listed=await api.listHubPartnerCounts(req("h",d));
 assert.equal(listed.scope,"existing-partner-counts-only");
 assert.deepEqual(listed.entries,[]);
 await assert.rejects(api.correctHubPartnerCounts(req("h",d)),{code:"unavailable"});
});
test("Hub Owner v3 corrects only existing partner staff, the SAME summary and append-only ledger",async()=>{
 const {db,api,req,zero}=setup(false,false,true,true);
 const date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"既存担当",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,expectedVersion:0,
  counts:{...zero(),NURO:2,"SB光・AIR":3},
  workLocation:"広島の営業現場"}));
 const finance=clone(db.store.get("records/old"));
 const products=clone(db.store.get("products/money"));
 const target="companies/partner/partnerWorkEntries/"+date+"__"+staff;
 const summary="companies/hub/partnerWorkCountDays/"+date+"/reports/partner";
 const beforeOwnerList=clone([...db.store]);
 const list=await api.listHubPartnerCounts(req("h",{date,partnerCompanyId:"partner"}));
 assert.equal(list.role,"hub");
 assert.equal(list.scope,"existing-partner-counts-only");
 assert.equal(list.containsFinance,false);
 assert.equal(list.entries.length,1);
 assert.deepEqual(list.entries[0].counts,{...zero(),NURO:2,"SB光・AIR":3});
 assert.deepEqual(list.entries[0].sbBreakdown,
  {"SB光":0,"SB AIR":0,"旧未分類":3},"never silently split legacy SB光/AIR");
 assert.deepEqual([...db.store],beforeOwnerList,"listing cannot change production documents");
 assert.doesNotMatch(JSON.stringify(list),/unitPrice|totalRevenue|revenuePerUnit|cashback|¥|￥/);
 const request={date,partnerCompanyId:"partner",staffId:staff,expectedVersion:1,
  counts:{...zero(),NURO:4,"SB光・AIR":3},
  sbBreakdown:{"SB光":0,"SB AIR":0,"旧未分類":3},
  correctionReason:"登録済み件数の確認訂正"};
 const receipt=await api.correctHubPartnerCounts(req("h",request));
 assert.deepEqual(receipt,{saved:true,scope:"hub-owner-existing-only",
  partnerCompanyId:"partner",staffId:staff,date,version:2,
  totalCount:7,containsFinance:false});
 const saved=db.store.get(target),day=db.store.get(summary);
 assert.deepEqual(saved.counts,request.counts);
 assert.equal(saved.totalCount,7);
 assert.equal(saved.version,2);
 assert.equal(saved.teamIdSnapshot,team);
 assert.equal(saved.workLocation,"広島の営業現場");
 assert.deepEqual(day.counts,request.counts);
 assert.equal(day.totalCount,7);
 const audit=db.store.get("companies/partner/partnerWorkAudits/"+date+"__"+staff+"__v2");
 assert.equal(audit.correctionKind,"hub_owner_existing_count_v3");
 assert.equal(audit.correctedByOwnerUid,"h");
 assert.equal(audit.correctionReason,request.correctionReason);
 assert.equal(audit.previousCounts.NURO,2);
 assert.equal(audit.counts.NURO,4);
 assert.equal(db.store.get("companies/partner/partnerWorkAudits/"+date+"__"+staff+"__v1").counts.NURO,2);
 const verified=await api.listHubPartnerCounts(req("h",{date,partnerCompanyId:"partner"}));
 assert.equal(verified.entries[0].version,2);
 assert.equal(verified.entries[0].counts.NURO,4);
 const partner=await api.view(req("p",{date}));
 assert.equal(partner.records[0].version,2);
 assert.equal(partner.records[0].counts.NURO,4);
 assert.equal(partner.records[0].counts["SB光・AIR"],3);
 assert.deepEqual(db.store.get("records/old"),finance);
 assert.deepEqual(db.store.get("products/money"),products);
 const after=clone([...db.store]);
 await assert.rejects(api.correctHubPartnerCounts(req("h",request)),{code:"aborted"});
 assert.deepEqual([...db.store],after,"stale Owner corrections must not change any ledger");
});
test("Owner correction rejects partner logins, foreign scopes, fake money, and guessed SB split",async()=>{
 const {db,api,req,zero}=setup(false,false,true,true);
 const date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,expectedVersion:0,
  counts:{...zero(),"SB光・AIR":3}}));
 const payload={date,partnerCompanyId:"partner",staffId:staff,expectedVersion:1,
  counts:{...zero(),"SB光・AIR":3,NURO:2},
  sbBreakdown:{"SB光":0,"SB AIR":0,"旧未分類":3},
  correctionReason:"入力済み数値を訂正"};
 const before=clone([...db.store]);
 await assert.rejects(api.listHubPartnerCounts(req("p",{date,partnerCompanyId:"partner"})),
  {code:"permission-denied"});
 await assert.rejects(api.correctHubPartnerCounts(req("p",payload)),
  {code:"permission-denied"});
 for(const changed of [
  {...payload,partnerCompanyId:"foreign"},
  {...payload,staffId:"missing"},
  {...payload,workspaceCompanyId:"partner"},
  {...payload,privateCounts:{NURO:200}},
  {...payload,reason:"売上確認"},
  {...payload,correctionReason:"売上100万円で訂正しました"},
  {...payload,sbBreakdown:{"SB光":1,"SB AIR":0,"旧未分類":2}},
  {...payload,sbBreakdown:{"SB光":0,"SB AIR":0,"旧未分類":2}},
  {...payload,expectedVersion:0}
 ]){
  await assert.rejects(api.correctHubPartnerCounts(req("h",changed)));
 }
 await assert.rejects(api.listHubPartnerCounts(req("h",{
  date,partnerCompanyId:"partner",asOwner:true})),{code:"invalid-argument"});
 assert.deepEqual([...db.store],before,"forged correction must have no side effects");
 db.store.get("partnerRelations/partner").countSharingApproved=false;
 const revoked=clone([...db.store]);
 await assert.rejects(api.listHubPartnerCounts(req("h",{date,partnerCompanyId:"partner"})));
 await assert.rejects(api.correctHubPartnerCounts(req("h",payload)));
 assert.deepEqual([...db.store],revoked,"revocation must block all owner correction paths");
});
test("Owner correction denies quick-only/unknown company summary instead of overwriting it",async()=>{
 const {db,api,req,zero}=setup(false,false,true,true);
 const date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"担当",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,expectedVersion:0,counts:{...zero(),NURO:1}}));
 const summary=db.store.get("companies/hub/partnerWorkCountDays/"+date+"/reports/partner");
 summary.source="quick-legacy-v1";
 const before=clone([...db.store]);
 await assert.rejects(api.correctHubPartnerCounts(req("h",{
  date,partnerCompanyId:"partner",staffId:staff,expectedVersion:1,
  counts:{...zero(),NURO:2},
  sbBreakdown:{"SB光":0,"SB AIR":0,"旧未分類":0},
  correctionReason:"登録件数を確認訂正"})),{code:"failed-precondition"});
 assert.deepEqual([...db.store],before);
});


test("Owner correction updates exact approved joint rankings in both apps from same saved ledger",async()=>{
 const {db,api,req,zero}=setup(true,true,true,true),date="2026-10-31";
 db.seed("products/nuro",{companyId:"hub",name:"NURO光",active:true,unitPrice:60000});
 db.seed("companies/hub/rankingCountPublicCatalog/shared",{
  schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:"hub",ownerUid:"h",
  version:1,products:[{id:"nuro",companyId:"hub",name:"NURO光",active:true}]});
 db.seed("companies/hub/rankingProductVisibility/shared",{
  hubCompanyId:"hub",ownerUid:"h",version:1,
  enabledHubProductIds:["nuro"],partnerOverrides:{partner:["nuro"]}});
 db.seed("companies/hub/rankingSkuMappings/shared",{
  hubCompanyId:"hub",ownerUid:"h",reviewedByUid:"h",active:true,version:1,
  bindings:[{companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"}]});
 Object.assign(db.store.get("partnerRelations/partner"),{
  combinedRankingApprovedByHub:true,combinedRankingApprovedByPartner:true,
  individualNamesApprovedByHub:true,individualNamesApprovedByPartner:true});
 for(const [companyId,otherId,uid] of [["hub","partner","h"],["partner","hub","p"]])
  db.seed("companies/"+companyId+"/rankingApprovals/"+otherId,{
   companyId,hubCompanyId:"hub",partnerCompanyId:"partner",
   approvedByUid:uid,active:true,scope:"combined_rank_only",version:1,
   combinedRankingApproved:true,individualNamesApproved:true
  });
 const team=(await api.manage(req("p",{action:"addTeam",name:"1班"}))).teamId;
 const staff=(await api.manage(req("p",{action:"addManaged",name:"実担当",teamId:team}))).staffId;
 await api.submit(req("p",{date,staffId:staff,expectedVersion:0,
  counts:{...zero(),NURO:2}}));
 const original=await api.view(req("p",{
  date,sharedCountRankings:true,rankingPeriod:"day"}));
 assert.equal(original.totalCount,2);
 const checked=await api.listHubPartnerCounts(req("h",{date,partnerCompanyId:"partner"}));
 assert.equal(checked.entries[0].counts.NURO,2);
 await api.correctHubPartnerCounts(req("h",{
  date,partnerCompanyId:"partner",staffId:staff,expectedVersion:1,
  counts:{...zero(),NURO:5},sbBreakdown:{"SB光":0,"SB AIR":0,"旧未分類":0},
  correctionReason:"確認した正しい件数へ訂正"}));
 const owner=await api.view(req("h",{
  date,sharedCountRankings:true,rankingPeriod:"month"}));
 const partner=await api.view(req("p",{
  date,sharedCountRankings:true,rankingPeriod:"day"}));
 for(const score of [owner,partner]){
  assert.equal(score.totalCount,5);
  assert.equal(score.companies[0].totalCount,5);
  assert.equal(score.teams[0].totalCount,5);
  assert.equal(score.people[0].totalCount,5);
  assert.deepEqual(score.products.map(x=>[x.name,x.totalCount]),[["NURO",5]]);
  assert.doesNotMatch(JSON.stringify(score),/unitPrice|revenue|60000|privateCounts|cashback/i);
 }
 const saved=await api.view(req("p",{date}));
 assert.equal(saved.records[0].counts.NURO,5);
 assert.equal(saved.records[0].version,2);
 const visibility=db.store.get("companies/hub/rankingProductVisibility/shared");
 visibility.partnerOverrides.partner=[];
 visibility.version++;
 const off=await api.view(req("p",{date,sharedCountRankings:true}));
 assert.equal(off.companies.length,0);
 assert.equal(off.products.length,0);
 assert.equal(db.store.get("companies/partner/partnerWorkEntries/"+date+"__"+staff).counts.NURO,5,
  "disabling public ranking can never delete audited Owner correction");
 visibility.partnerOverrides.partner=["nuro"];visibility.version++;
 const reenabled=await api.view(req("p",{date,sharedCountRankings:true}));
 assert.equal(reenabled.totalCount,5);
 assert.equal(reenabled.people[0].totalCount,5);
});
