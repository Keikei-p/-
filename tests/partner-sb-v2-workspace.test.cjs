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


/*
 * Cross-service contract test: one synthetic dataset passes through the
 * partner's real staged submit/view, the hub owner's authenticated correction,
 * hub day/team reports and actual index.html monthly ranking functions.
 * NO FIREBASE credentials / NO DEPLOY / no writes to existing production.
 */
test("partner submit -> authenticated hub correction -> company/team totals -> real ranking cache refresh agree exactly",async()=>{
 const fs=require("node:fs");
 const path=require("node:path");
 const vm=require("node:vm");
 const {makeAuthenticatedOwnerCorrectionV3}=
  require("../staging/partner-owner-correction-v3/trusted-auth.cjs");
 const {makeVerifiedPartnerRankingInvalidator}=await import(
  "../ranking/partner-count-cache-invalidation.mjs");
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const beforeFinance=clone([...db.store].filter(([key])=>
  /^(?:products|records)\//.test(key)));
 const financeSnapshot=()=>clone([...db.store].filter(([key])=>
  /^(?:products|records)\//.test(key)));
 const oldTeam=(await api.manage(req("p",{action:"addTeam",name:"光受付班"}))).teamId;
 const newTeam=(await api.manage(req("p",{action:"addTeam",name:"MNP班"}))).teamId;
 const oldPerson=(await api.manage(req("p",{action:"addManaged",
  teamId:oldTeam,name:"担当者A"}))).staffId;
 const newPerson=(await api.manage(req("p",{action:"addManaged",
  teamId:newTeam,name:"担当者B"}))).staffId;
 const first={...zero(),NURO:1,"SB光・AIR":5};
 const second={...zero(),NURO:2,"SB光・AIR":3};
 assert.equal((await api.submit(req("p",{
  date,staffId:oldPerson,expectedVersion:0,counts:first
 }))).version,1);
 assert.equal((await api.submit(req("p",{
  date,staffId:newPerson,expectedVersion:0,counts:second
 }))).version,1);
 const summaryPath="companies/hub/partnerWorkCountDays/"+date+"/reports/partner";
 const originalEntryPath="companies/partner/partnerWorkEntries/"+date+"__"+oldPerson;
 const secondEntryPath="companies/partner/partnerWorkEntries/"+date+"__"+newPerson;
 const oldEntry=clone(db.store.get(originalEntryPath));
 const secondEntry=clone(db.store.get(secondEntryPath));
 const initialSummary=clone(db.store.get(summaryPath));
 assert.equal(initialSummary.totalCount,11);
 assert.equal(initialSummary.counts.NURO,3);
 assert.equal(initialSummary.counts["SB光・AIR"],8);
 const auth=()=>({
  getUser:async uid=>({uid,email:uid+"@example.com",
   emailVerified:true,disabled:false}),
  verifyIdToken:async(jwt,check)=>{
   assert.equal(check,true);
   assert.equal(jwt,"h".repeat(30));
   return {uid:"h",email:"h@example.com",email_verified:true};
  }
 });
 const ownerCorrection=makeAuthenticatedOwnerCorrectionV3({
  db,getAuth:auth,FieldValue:{serverTimestamp:()=>({seconds:NOW/1000})},
  HttpsError:CallError,enabled:()=>true,
  now:()=>Date.parse("2026-11-07T07:00:00+09:00")
 });
 const ownerRequest=data=>req("h",data);
 const ownerBefore=await ownerCorrection.list(ownerRequest({
  date,partnerCompanyId:"partner"
 }));
 assert.equal(ownerBefore.entries.length,2);
 assert.doesNotMatch(JSON.stringify(ownerBefore),/revenue|unitPrice|cashback|privateCounts|totalRevenue/i);
 const firstVisible=ownerBefore.entries.find(x=>x.staffId===oldPerson);
 assert.deepEqual(firstVisible.sbBreakdown,{"SB光":0,"SB AIR":0,"旧未分類":5});
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const extract=name=>{
  let start=html.indexOf("function "+name+"(");
  assert(start>=0,"existing production ranking function "+name);
  if(html.slice(start-6,start)==="async ")start-=6;
  const end=html.indexOf("\n}",start);
  assert(end>start,"rank function terminator "+name);
  return html.slice(start,end+2);
 };
 const cache=new Map(),rankRequests=[];
 const rankScope={uid:"h",hubCompanyId:"hub"};
 const ctx=vm.createContext({
  PARTNER_QUICK_RANK_KEYS:KEYS,
  currentPartnerRankingKey:month=>rankScope.uid+"|"+rankScope.hubCompanyId+"|"+month,
  partnerRankingDailyCache:cache,
  getTodayString:()=>date,
  readPartnerQuickDay:async({date:day})=>{
   rankRequests.push(["quick",day]);
   // The historical quick total must NEVER be added to staff ledger totals.
   return {data:{role:"hub",date:day,
    partners:day===date?[{partnerCompanyId:"partner",name:"協力店",
     counts:{...zero(),NURO:90},totalCount:90}]:[]}};
  },
  readPartnerWorkDay:async({date:day})=>{
   rankRequests.push(["staff",day]);
   return {data:await api.view(req("h",{date:day}))};
  }
 });
 vm.runInContext([
  extract("validatedPartnerRankingDay"),
  extract("mergedPartnerRankingDay"),
  extract("readPartnerRankingMonth")
 ].join("\n"),ctx);
 const beforeRank=await ctx.readPartnerRankingMonth("2026-10");
 assert.equal(beforeRank.complete,true);
 assert.equal(beforeRank.rows.length,1);
 assert.equal(beforeRank.rows[0].totalCount,11,"staff ledger wins over old quick 90");
 assert.equal(beforeRank.rows[0].counts["SB光・AIR"],8);
 assert.equal(rankRequests.filter(x=>x[0]==="staff").length,31);
 const next={...first,NURO:3}; // +2 in company and old team, no altered raw sale
 const receipt=await ownerCorrection.correct(ownerRequest({
  date,partnerCompanyId:"partner",staffId:oldPerson,expectedVersion:1,
  counts:next,sbBreakdown:{"SB光":2,"SB AIR":2,"旧未分類":1},
  correctionReason:"契約内容を照合して光とAIRの分類を訂正"
 }));
 assert.equal(receipt.saved,true);
 assert.equal(receipt.version,2);
 assert.equal(receipt.totalCount,8);
 const afterEntry=db.store.get(originalEntryPath);
 const afterSummary=db.store.get(summaryPath);
 assert.equal(afterEntry.version,2);
 assert.equal(afterEntry.totalCount,8);
 assert.deepEqual(afterEntry.privateCounts,oldEntry.privateCounts);
 assert.equal(afterEntry.teamIdSnapshot,oldEntry.teamIdSnapshot);
 assert.deepEqual(db.store.get(secondEntryPath),secondEntry);
 assert.equal(afterSummary.totalCount,13);
 assert.equal(afterSummary.counts.NURO,5);
 assert.equal(afterSummary.counts["SB光・AIR"],8);
 assert.deepEqual(afterSummary.sbBreakdown,
  {"SB光":2,"SB AIR":2,"旧未分類":4});
 assert.equal(afterSummary.totalCount,
  afterEntry.totalCount+secondEntry.totalCount);
 const oldAudit="companies/partner/partnerWorkAudits/"+date+
  "__"+oldPerson+"__v1";
 const correctedAudit="companies/partner/partnerWorkAudits/"+date+
  "__"+oldPerson+"__v2";
 assert.equal(db.store.get(oldAudit).version,1);
 assert.equal(db.store.get(correctedAudit).kind,
  "hub_owner_count_correction_v1");
 assert.deepEqual(financeSnapshot(),beforeFinance);
 const hub=await api.view(req("h",{date,partnerCompanyId:"partner",
  includeTeamStatus:true}));
 assert.equal(hub.role,"hub");
 assert.equal(hub.partners.length,1);
 assert.equal(hub.partners[0].totalCount,13);
 assert.equal(hub.partners[0].counts.NURO,5);
 assert.deepEqual(hub.partners[0].sbBreakdown,
  {"SB光":2,"SB AIR":2,"旧未分類":4});
 assert.equal(hub.partnerTeamDetails.verifiedSharedCount,13);
 assert.equal(hub.partnerTeamDetails.unverifiedTeamCount,0);
 assert.equal(hub.partnerTeamDetails.unreconciledWithCompanyReport,false);
 assert.equal(hub.partnerTeamDetails.teams.length,2);
 assert.equal(hub.partnerTeamDetails.teams.reduce((s,t)=>s+t.totalCount,0),13);
 assert.equal(hub.teamReports.length,1);
 assert.equal(hub.teamReports[0].verified,true);
 assert.equal(hub.teamReports[0].teams.reduce((s,t)=>s+t.totalCount,0),13);
 assert.doesNotMatch(JSON.stringify(hub),/totalRevenue|unitPrice|cashback|privateCounts/i);
 const ownerAfter=await ownerCorrection.list(ownerRequest({
  date,partnerCompanyId:"partner"
 }));
 assert.equal(ownerAfter.entries.find(x=>x.staffId===oldPerson).version,2);
 const staleWithoutRefresh=await ctx.readPartnerRankingMonth("2026-10");
 assert.equal(staleWithoutRefresh.rows[0].totalCount,11,
  "reproduces existing 1h stale historical cache before invalidation");
 let resetMonth=[],recheck=null;
 const invalidate=makeVerifiedPartnerRankingInvalidator({
  dailyCache:cache,getActiveScope:()=>rankScope,
  resetVisibleMonth:month=>{resetMonth.push(month)},
  requestRefresh:async month=>{recheck=await ctx.readPartnerRankingMonth(month)}
 });
 await invalidate({date,month:"2026-10",partnerCompanyId:"partner",version:2});
 assert.deepEqual(resetMonth,["2026-10"]);
 assert.equal(recheck.complete,true);
 assert.equal(recheck.rows.length,1);
 assert.equal(recheck.rows[0].totalCount,13);
 assert.equal(recheck.rows[0].counts.NURO,5);
 assert.equal(recheck.rows[0].counts["SB光・AIR"],8);
 assert.equal(rankRequests.filter(x=>x[0]==="staff").length,32,
  "only the corrected date must be reread");
 const frozen=clone([...db.store]);
 await assert.rejects(ownerCorrection.correct(ownerRequest({
  date,partnerCompanyId:"partner",staffId:oldPerson,expectedVersion:1,
  counts:next,sbBreakdown:{"SB光":2,"SB AIR":2,"旧未分類":1},
  correctionReason:"前回の訂正を重複送信しようとした"
 })),error=>error?.code==="aborted");
 assert.deepEqual(clone([...db.store]),frozen,
  "stale version must not change counts, sales, audits or team history");
 assert.deepEqual(financeSnapshot(),beforeFinance);
});


/*
 * Permissioned partner resume after a hub owner writes a versioned correction.
 * The same actual staging services operate on one synthetic database.
 * There is no live Firebase or production data connection in this test.
 */
function partnerResumeOwnerService(db){
 const {makeAuthenticatedOwnerCorrectionV3}=
  require("../staging/partner-owner-correction-v3/trusted-auth.cjs");
 return makeAuthenticatedOwnerCorrectionV3({
  db,
  getAuth:()=>({
   verifyIdToken:async(jwt,check)=>{
    assert.equal(jwt,"h".repeat(30));
    assert.equal(check,true);
    return {uid:"h",email:"h@example.com",email_verified:true};
   },
   getUser:async uid=>{
    assert.equal(uid,"h");
    return {uid,email:"h@example.com",emailVerified:true,disabled:false};
   }
  }),
  FieldValue:{serverTimestamp:()=>({seconds:NOW/1000})},
  HttpsError:CallError,
  enabled:()=>true,
  now:()=>Date.parse("2026-11-07T07:00:00+09:00")
 });
}
test("after owner count correction, partner stale save rejects then fresh save works without losing private counts, split or audit",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const product=(await api.manage(req("p",{
  action:"addPrivateProduct",name:"協力店限定プラン"
 }))).productId;
 const team=(await api.manage(req("p",{
  action:"addTeam",name:"代理訂正後の通常入力班"
 }))).teamId;
 const staffId=(await api.manage(req("p",{
  action:"addManaged",name:"担当者A",teamId:team
 }))).staffId;
 const initialCounts={...zero(),NURO:1,"SB光・AIR":5};
 const submitted=await api.submit(req("p",{date,staffId,
  counts:initialCounts,privateCounts:{[product]:3},expectedVersion:0}));
 assert.equal(submitted.version,1);
 assert.equal(submitted.totalCount,6);
 const entryPath="companies/partner/partnerWorkEntries/"+date+"__"+staffId;
 const summaryPath="companies/hub/partnerWorkCountDays/"+date+"/reports/partner";
 const auditPath=v=>"companies/partner/partnerWorkAudits/"+date+
  "__"+staffId+"__v"+v;
 const original=clone(db.store.get(entryPath));
 const originalFinance=clone([...db.store].filter(([id])=>
  /^(?:products|records)\//.test(id)));
 const correction=partnerResumeOwnerService(db),ownerReq=data=>req("h",data);
 const changedCounts={...initialCounts,NURO:3};
 const ownerSaved=await correction.correct(ownerReq({
  date,partnerCompanyId:"partner",staffId,expectedVersion:1,
  counts:changedCounts,
  sbBreakdown:{"SB光":2,"SB AIR":2,"旧未分類":1},
  correctionReason:"原票で確認した登録漏れと光AIR分類の訂正"
 }));
 assert.equal(ownerSaved.version,2);
 assert.equal(ownerSaved.totalCount,8);
 const afterOwner=clone(db.store.get(entryPath));
 assert.deepEqual(afterOwner.privateCounts,original.privateCounts);
 assert.deepEqual(afterOwner.createdAt,original.createdAt);
 assert.deepEqual(afterOwner.staffNameSnapshot,original.staffNameSnapshot);
 assert.deepEqual(afterOwner.teamIdSnapshot,original.teamIdSnapshot);
 assert.equal(db.store.get(auditPath(1)).version,1);
 assert.equal(db.store.get(auditPath(2)).kind,"hub_owner_count_correction_v1");
 assert.equal(db.store.get(auditPath(2)).privateCounts,undefined);
 const beforeStale=clone([...db.store]);
 await assert.rejects(api.submit(req("p",{
  date,staffId,expectedVersion:1,
  counts:{...changedCounts,NURO:999},
  privateCounts:{[product]:99}
 })),e=>e?.code==="aborted");
 assert.deepEqual(clone([...db.store]),beforeStale);
 assert.equal(db.store.has(auditPath(3)),false);
 // Refetch and explicitly use the CURRENT version. Neither the page nor
 // the backend may blindly retry the stale mutation or silently reset data.
 const fresh=await api.view(req("p",{date}));
 const item=fresh.records.find(x=>x.staffId===staffId);
 assert.equal(item.version,2);
 assert.equal(item.counts.NURO,3);
 assert.equal(item.privateCounts[product],3);
 assert.deepEqual(item.sbBreakdown,
  {"SB光":2,"SB AIR":2,"旧未分類":1});
 // Old page versions can still modify *unrelated* categories after refresh,
 // preserving the classified SB combined count without supplying a new split.
 const resumedCounts={...item.counts,NURO:4};
 const resumed=await api.submit(req("p",{
  date,staffId,expectedVersion:item.version,
  counts:resumedCounts,privateCounts:{[product]:4}
 }));
 assert.equal(resumed.version,3);
 assert.equal(resumed.totalCount,9);
 assert.equal(resumed.privateTotalCount,4);
 const final=db.store.get(entryPath),summary=db.store.get(summaryPath);
 assert.equal(final.version,3);
 assert.equal(final.totalCount,9);
 assert.equal(final.privateCounts[product],4);
 assert.equal(final.privateTotalCount,4);
 assert.equal(final.counts.NURO,4);
 assert.equal(final.counts["SB光・AIR"],5);
 assert.deepEqual(final.sbBreakdown,
  {"SB光":2,"SB AIR":2,"旧未分類":1});
 assert.equal(summary.totalCount,9);
 assert.equal(summary.counts.NURO,4);
 assert.equal(summary.counts["SB光・AIR"],5);
 assert.deepEqual(summary.sbBreakdown,
  {"SB光":2,"SB AIR":2,"旧未分類":1});
 assert.equal(db.store.get(auditPath(1)).version,1);
 assert.equal(db.store.get(auditPath(2)).version,2);
 assert.equal(db.store.get(auditPath(3)).version,3);
 assert.deepEqual(db.store.get(auditPath(2)).previousCounts,initialCounts);
 assert.deepEqual(db.store.get(auditPath(3)).previousCounts,changedCounts);
 const ownerView=await correction.list(ownerReq({date,partnerCompanyId:"partner"}));
 assert.equal(ownerView.entries[0].version,3);
 assert.equal(ownerView.entries[0].totalCount,9);
 assert.equal(ownerView.containsFinance,false);
 assert.doesNotMatch(JSON.stringify(ownerView),/privateCounts|unitPrice|totalRevenue|cashback/i);
 const hub=await api.view(req("h",{date,partnerCompanyId:"partner",includeTeamStatus:true}));
 assert.equal(hub.partners[0].totalCount,9);
 assert.equal(hub.partnerTeamDetails.verifiedSharedCount,9);
 assert.equal(hub.partnerTeamDetails.teams[0].totalCount,9);
 assert.equal(hub.teamReports[0].verified,true);
 assert.deepEqual(clone([...db.store].filter(([id])=>
  /^(?:products|records)\//.test(id))),originalFinance);
});

test("after owner SB classification, legacy split-less partner cannot change combined total, but can resume safely with explicit split",async()=>{
 const {db,api,req,zero}=setup(),date="2026-10-31";
 const team=(await api.manage(req("p",{action:"addTeam",name:"光AIR内訳班"}))).teamId;
 const staffId=(await api.manage(req("p",{
  action:"addManaged",name:"担当者B",teamId:team
 }))).staffId;
 const originalCounts={...zero(),"SB光・AIR":5};
 const original=await api.submit(req("p",{
  date,staffId,counts:originalCounts,expectedVersion:0
 }));
 assert.equal(original.version,1);
 const correction=partnerResumeOwnerService(db),ownerReq=data=>req("h",data);
 const classified={"SB光":2,"SB AIR":2,"旧未分類":1};
 const owner=await correction.correct(ownerReq({
  date,partnerCompanyId:"partner",staffId,expectedVersion:1,
  counts:originalCounts,sbBreakdown:classified,
  correctionReason:"SB光とAIRの内訳を証憑で確認"
 }));
 assert.equal(owner.version,2);
 assert.equal(owner.totalCount,5);
 const entryPath="companies/partner/partnerWorkEntries/"+date+"__"+staffId;
 const summaryPath="companies/hub/partnerWorkCountDays/"+date+"/reports/partner";
 const frozen=clone([...db.store]);
 // A pre-correction form MUST fail version check before any write.
 await assert.rejects(api.submit(req("p",{
  date,staffId,expectedVersion:1,
  counts:{...originalCounts,"SB光・AIR":6}
 })),e=>e?.code==="aborted");
 assert.deepEqual(clone([...db.store]),frozen);
 // Refreshed legacy UI may safely change other products but cannot change
 // the classified combined SB number unless it supplies the new split.
 await assert.rejects(api.submit(req("p",{
  date,staffId,expectedVersion:2,
  counts:{...originalCounts,"SB光・AIR":6}
 })),/SB_SPLIT_OLD_CLIENT_MUST_REFRESH/);
 assert.deepEqual(clone([...db.store]),frozen);
 assert.equal(db.store.has("companies/partner/partnerWorkAudits/"+date+"__"+staffId+"__v3"),false);
 const refreshed=await api.view(req("p",{date}));
 const current=refreshed.records.find(x=>x.staffId===staffId);
 assert.equal(current.version,2);
 assert.deepEqual(current.sbBreakdown,classified);
 const explicitSplit={"SB光":2,"SB AIR":3,"旧未分類":1};
 const partner=await api.submit(req("p",{
  date,staffId,expectedVersion:current.version,
  counts:{...current.counts,"SB光・AIR":6},
  sbBreakdown:explicitSplit
 }));
 assert.equal(partner.version,3);
 assert.equal(partner.totalCount,6);
 assert.equal(db.store.get(summaryPath).totalCount,6);
 assert.deepEqual(db.store.get(summaryPath).sbBreakdown,explicitSplit);
 const ownerNext=await correction.correct(ownerReq({
  date,partnerCompanyId:"partner",staffId,expectedVersion:3,
  counts:{...current.counts,NURO:2,"SB光・AIR":6},
  sbBreakdown:explicitSplit,
  correctionReason:"確認できたNURO2件を代理反映"
 }));
 assert.equal(ownerNext.version,4);
 assert.equal(ownerNext.totalCount,8);
 assert.equal(db.store.get(entryPath).totalCount,8);
 assert.equal(db.store.get(summaryPath).totalCount,8);
 assert.deepEqual(db.store.get(summaryPath).sbBreakdown,explicitSplit);
 for(const version of [1,2,3,4])
  assert.equal(db.store.has("companies/partner/partnerWorkAudits/"+date+"__"+
   staffId+"__v"+version),true,"audit revision "+version+" retained");
 const hub=await api.view(req("h",{date,partnerCompanyId:"partner",includeTeamStatus:true}));
 assert.equal(hub.partners[0].totalCount,8);
 assert.equal(hub.partnerTeamDetails.verifiedSharedCount,8);
 assert.equal(hub.teamReports[0].teams[0].totalCount,8);
 assert.equal(hub.partnerTeamDetails.unreconciledWithCompanyReport,false);
});
