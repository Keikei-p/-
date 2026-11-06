"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {monthBounds,projectSavedPartnerMonth}=require("../functions-partner-workspace/partner-saved-month.cjs");
const {makeWorkspace,KEYS}=require("../functions-partner-workspace/service.cjs");
const NOW=Date.parse("2026-11-06T12:00:00+09:00");
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
class Ref{
 constructor(db,p){this.db=db;this.path=p;this.id=p.split("/").at(-1);}
 collection(name){return new Query(this.db,this.path+"/"+name);}
 async get(){const value=this.db.rows.get(this.path);return {
  id:this.id,exists:value!==undefined,data:()=>value===undefined?undefined:structuredClone(value)};}
}
class Query{
 constructor(db,path,filters=[],max=Infinity){this.db=db;this.path=path;this.filters=filters;this.max=max;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 where(key,op,val){return new Query(this.db,this.path,[...this.filters,[key,op,val]],this.max);}
 limit(n){return new Query(this.db,this.path,this.filters,n);}
 async get(){
  const docs=[];for(const [p,x] of this.db.rows){
   if(!p.startsWith(this.path+"/")||p.slice(this.path.length+1).includes("/"))continue;
   if(!this.filters.every(([k,op,v])=>op==="=="?x[k]===v:
      op===">="?x[k]>=v:op==="<="?x[k]<=v:false))continue;
   docs.push({id:p.split("/").at(-1),data:()=>structuredClone(x)});
  }
  return {docs:docs.slice(0,this.max),size:Math.min(docs.length,this.max)};
 }
}
class DB{
 constructor(){this.rows=new Map();}
 collection(id){return {
  doc:(key)=>new Ref(this,id+"/"+key),
  where:(k,op,v)=>new Query(this,id).where(k,op,v),
  limit:(n)=>new Query(this,id).limit(n)
 };}
 seed(path,data){this.rows.set(path,structuredClone(data));}
}
class CallError extends Error{constructor(code,message){super(message);this.code=code;}}
function seed(){
 const db=new DB();
 const internal={uid:"h",companyId:"hub",companyRole:"owner",active:true,
  memberType:"internal",accessKind:"internal"};
 const partner={uid:"p",companyId:"partner",companyRole:"owner",role:"leader",
  active:true,accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false};
 const member={uid:"m",companyId:"partner",companyRole:"member",role:"member",
  teamId:"teamB",active:true,accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false};
 db.seed("companies/hub",{ownerUid:"h",companyKind:"internal",active:true});
 db.seed("companies/partner",{ownerUid:"p",hubCompanyId:"hub",
  companyKind:"partner",active:true});
 for(const u of [internal,partner,member]){
  db.seed("users/"+u.uid,u);
  db.seed("companies/"+u.companyId+"/members/"+u.uid,u);
 }
 db.seed("partnerRelations/partner",{partnerCompanyId:"partner",hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 for(const id of ["teamA","teamB"]){
  db.seed("companies/partner/partnerWorkTeams/"+id,{
   companyId:"partner",name:id==="teamA"?"旧班":"新班",active:id==="teamB"});
 }
 const insert=(date,staffId,teamId,n,patch={})=>{
  const counts={...zero(),NURO:n};
  db.seed("companies/partner/partnerWorkEntries/"+date+"__"+staffId,{
   date,companyId:"partner",hubCompanyId:"hub",staffId,
   staffNameSnapshot:staffId==="m"?"田中":"佐藤",
   teamIdSnapshot:teamId,counts,totalCount:n,
   // A malicious financial field in the stored row must never serialize.
   totalRevenue:987654321,unitPrice:777777,cbCounts:{NURO:{"20000":n}},
   ...patch
  });
 };
 insert("2026-10-09","p","teamA",2);
 insert("2026-10-21","p","teamB",3);
 insert("2026-10-21","m","teamB",4);
 insert("2026-11-04","p","teamB",5);
 insert("2026-11-05","m","teamB",6);
 db.seed("products/finance",{revenue:987654321,companyId:"hub"});
 db.seed("records/finance",{totalRevenue:1234567,companyId:"hub"});
 const getAuth=()=>({
  getUser:async uid=>({uid,disabled:false,emailVerified:true,email:uid+"@example.com"}),
  verifyIdToken:async bearer=>({uid:bearer[0],
   email:bearer[0]+"@example.com",email_verified:true})
 });
 const api=makeWorkspace({db,getAuth,FieldValue:{serverTimestamp:()=>({})},
  Timestamp:{fromMillis:ms=>({toMillis:()=>ms})},
  HttpsError:CallError,enabled:()=>true,now:()=>NOW});
 const req=(uid,data)=>({auth:{uid,token:{email:uid+"@example.com",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+uid.repeat(30)}},data});
 return {db,api,req,insert};
}
test("month bounds never include future days or spill October rows into November",()=>{
 assert.deepEqual(monthBounds("2026-10","2026-11-06"),
  {month:"2026-10",first:"2026-10-01",last:"2026-10-31"});
 assert.equal(monthBounds("2026-11","2026-11-06").last,"2026-11-06");
 for(const month of ["2026-12","2024-01","2026-00","2026-13","2026-2"]){
  assert.throws(()=>monthBounds(month,"2026-11-06"),/UNVERIFIED/);
 }
});
test("owner sees saved October and November one-month count / team / people parity",async()=>{
 const {db,api,req}=seed();
 const before=structuredClone([...db.rows]);
 const october=await api.viewSavedMonth(req("p",{month:"2026-10"}));
 const november=await api.viewSavedMonth(req("p",{month:"2026-11"}));
 assert.equal(october.totalCount,9);
 assert.equal(november.totalCount,11);
 assert.equal(october.teams.length,2);
 assert.equal(october.people.length,2);
 assert.equal(october.people.find(x=>x.name==="佐藤").teamHistoryMixed,true);
 assert.equal(october.complete,false);
 assert.equal(october.provisional,true);
 assert.equal(november.counts.NURO,11);
 assert.equal(october.financialFieldsIncluded,false);
 assert.equal(october.productionDocumentWrites,0);
 assert.deepEqual([...db.rows],before,"read must not mutate any saved values");
 for(const data of [october,november]){
  assert.doesNotMatch(JSON.stringify(data),
   /totalRevenue|unitPrice|cbCounts|987654321|777777|1234567|partnerWorkEntries/);
 }
});
test("clickable team details preserve each person's original month/team/product counts",async()=>{
 const {api,req,db}=seed();
 const before=structuredClone([...db.rows]);
 const october=await api.viewSavedMonth(req("p",{month:"2026-10"}));
 const oldTeam=october.teams.find(t=>t.name==="旧班");
 const newTeam=october.teams.find(t=>t.name==="新班");
 assert(oldTeam&&newTeam);
 assert.equal(oldTeam.totalCount,2);
 assert.equal(oldTeam.members.length,1);
 assert.equal(oldTeam.members[0].name,"佐藤");
 assert.equal(oldTeam.members[0].counts.NURO,2);
 assert.equal(newTeam.totalCount,7);
 assert.deepEqual(newTeam.members.map(x=>[x.name,x.totalCount]),
  [["田中",4],["佐藤",3]]);
 assert.equal(newTeam.members[0].counts.NURO,4);
 for(const team of october.teams){
  assert.equal(team.members.reduce((n,m)=>n+m.totalCount,0),team.totalCount);
  assert.equal(team.members.reduce((n,m)=>n+m.counts.NURO,0),team.counts.NURO);
  assert.equal(team.members.every(x=>typeof x.key==="string"&&x.key.length===64),true);
 }
 const november=await api.viewSavedMonth(req("p",{month:"2026-11"}));
 assert.equal(november.teams.length,1);
 assert.deepEqual(november.teams[0].members.map(x=>[x.name,x.counts.NURO]),
  [["田中",6],["佐藤",5]]);
 assert.deepEqual([...db.rows],before,"aggregation is read-only");
 assert.doesNotMatch(JSON.stringify({october,november}),
  /unitPrice|totalRevenue|cbCounts|1234567|987654321|777777/);
});
test("member team drilldown contains only the authenticated member's saved work",async()=>{
 const {api,req}=seed();
 const month=await api.viewSavedMonth(req("m",{month:"2026-10"}));
 assert.equal(month.teams.length,1);
 assert.equal(month.teams[0].members.length,1);
 assert.equal(month.teams[0].members[0].name,"田中");
 assert.equal(month.teams[0].members[0].totalCount,4);
 assert.equal(month.teams[0].members[0].counts.NURO,4);
 assert.equal(month.teams[0].totalCount,4);
});
test("hub Owner can read related partner counts but not arbitrary company",async()=>{
 const {api,req}=seed();
 const owned=await api.viewSavedMonth(req("h",{month:"2026-10",partnerCompanyId:"partner"}));
 assert.equal(owned.totalCount,9);
 assert.equal(owned.people.length,2);
 await assert.rejects(api.viewSavedMonth(req("h",{month:"2026-10",partnerCompanyId:"foreign"})),
  e=>e.code==="permission-denied");
 await assert.rejects(api.viewSavedMonth(req("p",{month:"2026-10",partnerCompanyId:"partner"})),
  e=>e.code==="permission-denied");
});
test("partner member sees only own staff, not owner and other person's counts",async()=>{
 const {api,req}=seed();
 const out=await api.viewSavedMonth(req("m",{month:"2026-10"}));
 assert.equal(out.totalCount,4);
 assert.equal(out.people.length,1);
 assert.equal(out.people[0].name,"田中");
 assert.equal(out.teams.length,1);
});
test("historical unattributed team stays unknown rather than guessed from current team",async()=>{
 const {api,req,insert}=seed();
 insert("2026-10-30","p",null,2);
 const out=await api.viewSavedMonth(req("p",{month:"2026-10"}));
 assert.equal(out.totalCount,11);
 assert.equal(out.unattributedCount,2);
 assert.equal(out.unattributedRows,1);
 assert.equal(out.missingHistoricalTeamAttribution,true);
 assert.equal(out.teams.reduce((n,x)=>n+x.totalCount,0),9);
});
test("invalid stored totals, financial company mismatch and duplicate attribution fail closed",async()=>{
 for(const patch of [{totalCount:999},{companyId:"foreign"},{counts:{NURO:1}},{staffId:"stranger"}]){
  const {api,req,db}=seed();
  const path="companies/partner/partnerWorkEntries/2026-10-21__m";
  db.seed(path,{...db.rows.get(path),...patch});
  await assert.rejects(api.viewSavedMonth(req("h",{month:"2026-10",partnerCompanyId:"partner"})),
   e=>e.code==="data-loss");
 }
});
test("pure reducer rejects foreign staff rows in a member-scoped response",()=>{
 const row={id:"2026-10-05__other",data:()=>({
  date:"2026-10-05",companyId:"partner",hubCompanyId:"hub",staffId:"other",
  teamIdSnapshot:"teamA",counts:{...zero(),NURO:1},totalCount:1
 })};
 assert.throws(()=>projectSavedPartnerMonth({
  hubId:"hub",partnerId:"partner",month:"2026-10",rows:[row],
  categoryKeys:KEYS,role:"member",actorUid:"member"
 }),/UNVERIFIED/);
});
