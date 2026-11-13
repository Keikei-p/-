import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createStagedOwnerVisibleCountHandler}
 from "../ranking/owner-visible-count-server-handler.mjs";
const require=createRequire(import.meta.url);
const {createJointCountHttpAdapter}=require(
 "../functions-ranking-approvals/joint-count-http-adapter.cjs");

const DAY="2026-11-08",MONTH="2026-11",TIME="2026-11-08T12:00:00Z";
const copy=x=>structuredClone(x);
const docs=()=>new Map([
 ["companies/hub",{name:"本社",companyKind:"internal",active:true,ownerUid:"hubOwner"}],
 ["companies/partner",{name:"協力店",companyKind:"partner",hubCompanyId:"hub",
  active:true,ownerUid:"partnerOwner"}],
 ["partnerRelations/partner",{hubCompanyId:"hub",partnerCompanyId:"partner",
  active:true,countSharingApproved:true,combinedRankingApprovedByHub:true,
  combinedRankingApprovedByPartner:true,individualNamesApprovedByHub:true,
  individualNamesApprovedByPartner:true}],
 ["companies/hub/rankingApprovals/partner",{
  companyId:"hub",hubCompanyId:"hub",partnerCompanyId:"partner",
  approvedByUid:"hubOwner",active:true,scope:"combined_rank_only",
  version:1,combinedRankingApproved:true,individualNamesApproved:true}],
 ["companies/partner/rankingApprovals/hub",{
  companyId:"partner",hubCompanyId:"hub",partnerCompanyId:"partner",
  approvedByUid:"partnerOwner",active:true,scope:"combined_rank_only",
  version:1,combinedRankingApproved:true,individualNamesApproved:true}],
 ["companies/hub/rankingProductVisibility/shared",{
  hubCompanyId:"hub",ownerUid:"hubOwner",version:1,
  enabledHubProductIds:["nuro"],partnerOverrides:{}}],
 ["products/nuro",{companyId:"hub",name:"NURO光",active:true,
  unitPrice:10000,revenue:20000,cashback:5000}]
]);
function fake(){
 const state=docs(),ops=[];
 for(const [uid,cid,access,memberType] of [
  ["hubOwner","hub","internal","direct"],
  ["partnerOwner","partner","partner","cooperator"]
 ]){
  const row={uid,companyId:cid,active:true,companyRole:"owner",
   email:uid+"@example.test",accessKind:access,memberType,
   canViewRevenue:access==="internal",canViewUnitPrice:access==="internal"};
  state.set("users/"+uid,row);
  state.set("companies/"+cid+"/members/"+uid,copy(row));
 }
 class Ref{
  constructor(path){this.path=path;this.id=path.split("/").at(-1);}
  collection(x){return new Coll(this.path+"/"+x);}
 }
 class Coll{
  constructor(path,filter=()=>true,max=Infinity){
   this.path=path;this.filter=filter;this.max=max;
  }
  doc(x){return new Ref(this.path+"/"+x);}
  where(key,op,value){
   assert.equal(op,"==");
   return new Coll(this.path,v=>this.filter(v)&&v[key]===value,this.max);
  }
  limit(n){return new Coll(this.path,this.filter,n);}
 }
 const db={collection:x=>new Coll(x),runTransaction:async(fn,options)=>{
  ops.push({kind:"transaction",options});
  const tx={get:async ref=>{
   ops.push({kind:"get",path:ref.path});
   if(ref instanceof Ref){
    const row=state.get(ref.path);
    return {id:ref.id,exists:row!==undefined,data:()=>copy(row)};
   }
   const rows=[...state].filter(([p,v])=>
    p.startsWith(ref.path+"/")&&
    !p.slice(ref.path.length+1).includes("/")&&ref.filter(v))
    .slice(0,ref.max).map(([p,v])=>({
     id:p.split("/").at(-1),exists:true,data:()=>copy(v)
    }));
   return {docs:rows,size:rows.length};
  }};
  return fn(tx);
 }};
 const auth={
  verifyIdToken:async(token,revoked)=>{
   assert.equal(revoked,true);
   const uid=token.includes("partner")?"partnerOwner":"hubOwner";
   return {uid,email:uid+"@example.test",email_verified:true};
  },
  getUser:async uid=>({uid,email:uid+"@example.test",
   emailVerified:true,disabled:false})
 };
 const FieldValue={serverTimestamp:()=>{throw Error("NO_WRITES");}};
 return {state,ops,db,auth,FieldValue};
}
function source(cid,n){
 const uid=cid+"Staff",teamId="team",recordId=cid+"Record";
 const productId=cid==="hub"?"nuro":"p-nuro";
 return {companyId:cid,companyLabel:cid==="hub"?"本社":"協力店",
  kind:cid==="hub"?"own":"partner",isComplete:true,consentVerified:true,
  readTime:TIME,completeWindows:{current:true,previous:false},
  teams:[{id:teamId,name:"営業班",goalCount:null}],
  roster:[{uid,teamId,name:"営業担当"}],
  products:[{companyId:cid,sourceId:productId,name:"NURO光",
   active:true,sortOrder:0}],
  records:[{companyId:cid,sourceId:recordId,uid,teamId,date:DAY,
   totalCount:n,reportStatus:"submitted",memberNameSnapshot:"営業担当",
   teamNameSnapshot:"営業班",workLocation:""}],
  lines:[{companyId:cid,recordId,sourceId:cid+"Line",uid,teamId,
   date:DAY,productId,count:n}]
 };
}
const countInput=context=>({
 hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
 period:{kind:"month",day:"2026-11-01",asOf:"2026-11-09"},
 sources:[source("hub",2),source("partner",5)],
 productGroups:[
  {companyId:"hub",productId:"nuro",groupId:"nuro",groupName:"NURO光"},
  {companyId:"partner",productId:"p-nuro",groupId:"nuro",groupName:"NURO光"}
 ],mappingsReviewed:true,
 // Deliberately malicious loader-supplied role must never override Auth.
 context:{...context,role:"hub_owner",viewerUid:"forged"}
});
const request=(uid="hub",query="month=2026-11",extra={})=>
 new Request("https://nico-factory.web.app/v1/owner-visible-counts?"+query,{
  method:extra.method||"GET",
  headers:{Authorization:"Bearer "+(uid==="partner"?"partner":"hub").repeat(8),
   Origin:extra.origin||"https://nico-factory.web.app"}
 });
function handler(f,loader=countInput,enabled=true){
 return createStagedOwnerVisibleCountHandler({
  enabled,db:f.db,auth:f.auth,FieldValue:f.FieldValue,
  loadCompleteVerifiedCountInput:async({month,context})=>{
   assert.equal(month,MONTH);
   return loader(context);
  }
 });
}
test("disabled by default and no Firebase dependencies invoked",async()=>{
 const result=await createStagedOwnerVisibleCountHandler()(request());
 assert.equal(result.status,503);
 assert.deepEqual(await result.json(),{error:"service_disabled"});
});
test("authenticated hub and partner receive consistent ON-only counts, no raw finance",async()=>{
 const f=fake(),run=handler(f);
 const hub=await run(request());
 assert.equal(hub.status,200);
 const owner=await hub.json();
 assert.equal(owner.role,"hub_owner");
 assert.deepEqual(owner.summary,{own:2,partner:5,total:7,unidentified:0});
 const partner=await run(request("partner"));
 assert.equal(partner.status,200);
 const view=await partner.json();
 assert.equal(view.role,"partner_owner");
 assert.equal(view.own.count,5);
 assert.equal(view.publicRanking.products[0].count,7);
 assert(!("companyBreakdown" in view));
 assert(!/revenue|unitPrice|cashback|10000|20000/.test(JSON.stringify(view)));
 assert(f.ops.every(x=>x.kind!=="transaction"||x.options?.readOnly===true));
 assert(f.ops.every(x=>x.kind!=="get"||
  !/\/(?:records|recordCorrections|revenueGoals)\//.test(x.path)));
});

test("authenticated public scopes use only approved ON counts and never accept forged or duplicate scopes",async()=>{
 const f=fake(),run=handler(f),before=structuredClone(f.state);
 for(const [scope,total] of [["joint",7],["own",2],["partner",5]]){
  const response=await run(request("partner","month=2026-11&scope="+scope));
  assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.scope,scope);assert.equal(data.own.count,5);
  for(const rows of Object.values(data.publicRanking))assert.equal(rows.reduce((n,x)=>n+x.count,0),total);
  assert.doesNotMatch(JSON.stringify(data.publicRanking),/companyId|teamId|uid|unitPrice|cashback/);
 }
 assert.deepEqual(f.state,before);
 for(const suffix of ["scope=private","scope=own&scope=partner"]){
  const untouched=fake();let reads=0;
  const bad=handler(untouched,ctx=>{reads++;return countInput(ctx)});
  assert.equal((await bad(request("partner","month=2026-11&"+suffix))).status,400);
  assert.equal(reads,0);assert.equal(untouched.ops.length,0);
 }
});

test("real HTTP boundary preserves scoped totals while independently reconciling the partner's own detail",async()=>{
 const run=handler(fake());
 const reply=()=>({statusCode:null,body:null,setHeader(){},
  status(code){this.statusCode=code;return this},send(body){this.body=body;return this}});
 const raw=scope=>({method:"GET",originalUrl:"/v1/owner-visible-counts?month=2026-11&scope="+scope,
  headers:{origin:"https://nico-factory.web.app",authorization:"Bearer "+"partner".repeat(8)}});
 const adapter=createJointCountHttpAdapter({enabled:()=>true,loadHandler:()=>run});
 for(const [scope,total] of [["joint",7],["own",2],["partner",5]]){
  const res=reply();await adapter(raw(scope),res);assert.equal(res.statusCode,200);
  const data=JSON.parse(res.body);assert.equal(data.scope,scope);assert.equal(data.own.count,5);
  for(const rows of Object.values(data.publicRanking))assert.equal(rows.reduce((n,x)=>n+x.count,0),total);
 }
 for(const mutate of [data=>{data.scope="joint"},data=>{data.own.count++},
  data=>{data.publicRanking.members[0].companyId="secret"}]){
  const bad=createJointCountHttpAdapter({enabled:()=>true,loadHandler:()=>async request=>{
   const data=await (await run(request)).json();mutate(data);
   return new Response(JSON.stringify(data),{status:200});
  }});
  const res=reply();await bad(raw("own"),res);assert.equal(res.statusCode,503);
  assert.deepEqual(JSON.parse(res.body),{error:"request_blocked"});
 }
});
test("global OFF, partner-specific OFF, and re-ON preserve originals",async()=>{
 const f=fake(),run=handler(f),key="companies/hub/rankingProductVisibility/shared";
 const original=copy(f.state.get("products/nuro"));
 f.state.get(key).enabledHubProductIds=[];
 assert.equal((await (await run(request())).json()).summary.total,0);
 f.state.get(key).enabledHubProductIds=["nuro"];
 f.state.get(key).partnerOverrides={partner:[]};
 assert.deepEqual((await (await run(request())).json()).summary,
  {own:2,partner:0,total:2,unidentified:0});
 f.state.get(key).partnerOverrides={};
 assert.equal((await (await run(request())).json()).summary.total,7);
 assert.deepEqual(f.state.get("products/nuro"),original);
});
test("revoked owner, consent, forged loader scope, missing mapping fail closed",async()=>{
 const f=fake(),run=handler(f);
 f.state.get("partnerRelations/partner").combinedRankingApprovedByHub=false;
 assert.equal((await run(request())).status,503);
 f.state.get("partnerRelations/partner").combinedRankingApprovedByHub=true;
 const bad=handler(f,c=>({...countInput(c),approvedCompanyIds:["hub"]}));
 assert.equal((await bad(request())).status,503);
 const mapping=handler(f,c=>({...countInput(c),mappingsReviewed:false}));
 assert.equal((await mapping(request())).status,503);
 f.state.get("companies/hub").ownerUid="attacker";
 assert.equal((await run(request())).status,503);
});
test("malformed methods, query, origin and auth cannot reach data loader",async()=>{
 const f=fake();let calls=0;
 const run=handler(f,c=>{calls++;return countInput(c)});
 for(const req of [
  request("hub","month=2026-11&companyId=unknown"),
  request("hub","month=2026-13"),
  request("hub","month=2026-11",{method:"POST"}),
  request("hub","month=2026-11",{origin:"https://evil.example"})
 ])assert.notEqual((await run(req)).status,200);
 const missing=new Request("https://nico-factory.web.app/v1/owner-visible-counts?month=2026-11");
 assert.equal((await run(missing)).status,401);
 assert.equal(calls,0);
});

test("approved hub owner can scope all four ranking filters without touching source data",async()=>{
 const f=fake(),run=handler(f);
 const stateBefore=copy([...f.state]);
 const byPartner=await run(request("hub",
  "month=2026-11&companyId=partner"));
 assert.equal(byPartner.status,200);
 const visible=await byPartner.json();
 assert.equal(visible.role,"hub_owner");
 assert.deepEqual(visible.filters,{companyId:"partner"});
 assert.deepEqual(visible.summary,{own:0,partner:5,total:5,unidentified:0});
 assert.equal(visible.productRanking[0].count,5);
 const detailed=await run(request("hub",
  "month=2026-11&companyId=partner&teamId=team&uid=partnerStaff&productId=nuro"));
 assert.equal(detailed.status,200);
 const detail=await detailed.json();
 assert.deepEqual(detail.filters,{companyId:"partner",teamId:"team",
  uid:"partnerStaff",productId:"nuro"});
 assert.equal(detail.summary.total,5);
 assert.equal(detail.memberRanking.length,1);
 assert.deepEqual([...f.state],stateBefore,"reporting filters cannot change stored counts");
 assert(f.ops.every(x=>x.kind!=="transaction"||x.options?.readOnly===true));
});
test("real filtered owner API crosses the strict Functions HTTP finance gate intact",async()=>{
 const f=fake(),load=handler(f);
 const http=createJointCountHttpAdapter({
  enabled:()=>true,loadHandler:()=>load
 });
 const send=async(path,actor="hub")=>{
  const req={method:"GET",originalUrl:path,
   headers:{origin:"https://nico-factory.web.app",
    authorization:"Bearer "+actor.repeat(8)}};
  const res={statusCode:null,body:"",headers:{},
   setHeader(k,v){this.headers[k.toLowerCase()]=v;},
   status(n){this.statusCode=n;return this;},
   send(x){this.body=x;return this;}};
  await http(req,res);
  return res;
 };
 for(const [path,counts,filters] of [
  ["/getVerifiedJointCountRanking?month=2026-11",
   {own:2,partner:5,total:7,unidentified:0},{}],
  ["/getVerifiedJointCountRanking?month=2026-11&companyId=partner",
   {own:0,partner:5,total:5,unidentified:0},
   {companyId:"partner"}],
  ["/v1/owner-visible-counts?month=2026-11&companyId=partner&teamId=team&uid=partnerStaff&productId=nuro",
   {own:0,partner:5,total:5,unidentified:0},
   {companyId:"partner",teamId:"team",uid:"partnerStaff",productId:"nuro"}]
 ]){
  const res=await send(path);
  assert.equal(res.statusCode,200,path+" must reach the real role-verified response");
  const output=JSON.parse(res.body);
  assert.equal(output.role,"hub_owner");
  assert.deepEqual(output.summary,counts);
  assert.deepEqual(output.filters,filters);
  assert.equal(output.companyBreakdown.length,2,
   "Owner's verified company registry is preserved for the company selector");
  assert.equal(output.productRanking.reduce((n,r)=>n+r.count,0),counts.total);
  assert.equal(output.teamBreakdown.reduce((n,r)=>n+r.count,0),counts.total);
  assert.equal(output.memberRanking.reduce((n,r)=>n+r.count,0),counts.total);
  assert(!/revenue|unitPrice|cashback|salary|10000|20000/.test(res.body),
   "no financial source field or amount may be published");
 }
 // A partner token cannot transform an Owner filter into another firm's view,
 // even when it reaches the direct Cloud Functions ingress.
 const blocked=await send(
  "/getVerifiedJointCountRanking?month=2026-11&companyId=hub","partner");
 assert.equal(blocked.statusCode,403);
 assert.deepEqual(JSON.parse(blocked.body),{error:"request_blocked"});
 assert(f.ops.every(op=>op.kind!=="transaction"||op.options?.readOnly===true));
});
test("unapproved filter IDs, cross-account and duplicate query are denied before reading counts",async()=>{
 const f=fake();let countReads=0;
 const run=handler(f,c=>{countReads++;return countInput(c);});
 for(const [who,query,expected] of [
  ["hub","month=2026-11&companyId=foreign",403],
  ["hub","month=2026-11&companyId=partner&companyId=hub",400],
  ["hub","month=2026-11&teamId=team",400],
  ["hub","month=2026-11&uid=partnerStaff",400],
  ["hub","month=2026-11&productId=../../records",400],
  ["hub","month=2026-11&companyId=partner%2Frecords",400],
  ["hub","month=2026-11&companyId=",400],
  ["hub","month=2026-11&companyId=partner&salary=5000",400],
  ["partner","month=2026-11&companyId=hub",403],
  ["partner","month=2026-11&productId=nuro",403]
 ]){
  const result=await run(request(who,query));
  assert.equal(result.status,expected,who+" "+query);
  assert.deepEqual(await result.json(),{error:"request_blocked"});
 }
 assert.equal(countReads,0,"no canonical or financial source read after rejected scope");
});
test("opt-in atomic snapshot path serves count-only ranking without legacy publication reads",async()=>{
 const f=fake(),ctx={...countInput({}).context};
 const publication={serverVerified:true,ownerSettingsRead:true,
  ownerUidVerified:true,productMappingsReviewed:true,revision:2,
  hubCompanyId:"hub",snapshotReadTime:TIME,
  enabledHubProductIds:["nuro"],partnerOverrides:[]};
 let calls=0;
 const run=createStagedOwnerVisibleCountHandler({
  enabled:true,db:f.db,auth:f.auth,FieldValue:f.FieldValue,
  loadAtomicVerifiedCountSnapshot:async({month,context})=>{
   calls++;
   assert.equal(month,MONTH);
   const input={...countInput(context),snapshotReadTime:TIME};
   return {input,publication};
  }
 });
 const response=await run(request());
 assert.equal(response.status,200);
 assert.equal((await response.json()).summary.total,7);
 assert.equal(calls,1);
 assert(!f.ops.some(x=>x.kind==="get"&&
  x.path==="companies/hub/rankingProductVisibility/shared"),
  "atomic publication must not trigger an independent settings transaction");
 const bad=createStagedOwnerVisibleCountHandler({
  enabled:true,db:f.db,auth:f.auth,FieldValue:f.FieldValue,
  loadAtomicVerifiedCountSnapshot:async({context})=>({
   input:{...countInput(context),snapshotReadTime:TIME},
   publication:{...publication,snapshotReadTime:"2026-11-09T00:00:01Z"}
  })
 });
 assert.equal((await bad(request())).status,503);
});


test("authenticated canonical month snapshots answer exact day and same-month week without modifying ledgers",async()=>{
 const f=fake(),run=handler(f);
 const originals=[...f.state].map(([k,v])=>[k,copy(v)]);
 const day=await run(request("partner","day=2026-11-08"));
 assert.equal(day.status,200);
 const dp=await day.json();
 assert.equal(dp.period,"day");
 assert.equal(dp.range.start,"2026-11-08");
 assert.equal(dp.range.end,"2026-11-08");
 assert.equal(dp.own.count,5);
 assert.equal(dp.publicRanking.products[0].count,7);
 const week=await run(request("hub","week=2026-11-08"));
 assert.equal(week.status,200);
 const wp=await week.json();
 assert.equal(wp.period,"week");
 assert.equal(wp.range.start,"2026-11-02");
 assert.equal(wp.range.end,"2026-11-08");
 assert.equal(wp.summary.total,7);
 const empty=await run(request("hub","day=2026-11-09"));
 assert.equal(empty.status,200);
 const ep=await empty.json();
 assert.equal(ep.summary.total,0,"no report must not be summed from the whole month");
 const partial=await run(request("partner","week=2026-11-09"));
 assert.equal(partial.status,200);
 assert.equal((await partial.json()).range.end,"2026-11-09");
 assert.deepEqual([...f.state],originals,"read-only period selection never alters source data");
 assert(!f.ops.some(op=>/write|create|update|delete/.test(op.kind)));
});

test("cross-month weeks, future days and invalid query never return a misleading count",async()=>{
 const f=fake(),run=handler(f);
 for(const query of [
  "week=2026-11-01", // starts October 26
  "week=2026-11-30", // finishes December 6
  "day=2026-11-10", // beyond trusted asOf November 9
  "week=2026-11-10", // beyond trusted asOf
  "day=2026-11-31",
  "week=2026-11-32",
  "day=2026-11-08&month=2026-11",
  "day=2026-11-08&day=2026-11-08",
  "kind=month"
 ]){
  const result=await run(request("hub",query));
  assert.equal(result.status,400,"must fail closed: "+query);
  assert.deepEqual(await result.json(),{error:"request_blocked"});
 }
});


test("verified two-month joint week includes both company ledgers without partial owner/partner ranks",async()=>{
 const f=fake(),months=[];
 const publication={serverVerified:true,ownerSettingsRead:true,
  ownerUidVerified:true,productMappingsReviewed:true,revision:2,
  hubCompanyId:"hub",snapshotReadTime:TIME,
  enabledHubProductIds:["nuro"],partnerOverrides:[]};
 const input=countInput({});
 input.period.asOf="2026-11-09";
 input.snapshotReadTime=TIME;
 input.verifiedMonths=["2026-11","2026-10"];
 input.sources=input.sources.map(s=>{
  const recent={...s.records[0],date:"2026-11-01"};
  const currentLine={...s.lines[0],date:"2026-11-01"};
  const old={...recent,sourceId:recent.sourceId+"October",date:"2026-10-31"};
  const oldLine={...currentLine,sourceId:currentLine.sourceId+"October",
   recordId:old.sourceId,date:"2026-10-31"};
  return {...s,completeWindows:{current:true,previous:true},
   records:[recent,old],lines:[currentLine,oldLine]};
 });
 const snapshot=copy(input);
 const run=createStagedOwnerVisibleCountHandler({
  enabled:true,db:f.db,auth:f.auth,FieldValue:f.FieldValue,
  loadAtomicVerifiedCountSnapshot:async ({month,secondMonth,context})=>{
   assert.equal(context.serverVerified,true);
   months.push([month,secondMonth]);
   return {input,publication};
  }
 });
 const own=await run(request("hub","week=2026-11-01"));
 assert.equal(own.status,200);
 const board=await own.json();
 assert.deepEqual(board.summary,{own:4,partner:10,total:14,unidentified:0});
 assert.equal(board.range.start,"2026-10-26");
 assert.equal(board.range.end,"2026-11-01");
 const partner=await run(request("partner","week=2026-11-01"));
 assert.equal(partner.status,200);
 const publicView=await partner.json();
 assert.equal(publicView.role,"partner_owner");
 assert.equal(publicView.own.count,10);
 assert.equal(publicView.publicRanking.products[0].count,14);
 assert.deepEqual(months,[["2026-11","2026-10"],["2026-11","2026-10"]]);
 assert.deepEqual(input,snapshot,"count originals remain immutable");
 assert(!f.ops.some(x=>/write|create|update|delete/.test(x.kind)));
 const corrupted=createStagedOwnerVisibleCountHandler({
  enabled:true,db:f.db,auth:f.auth,FieldValue:f.FieldValue,
  loadAtomicVerifiedCountSnapshot:async()=>({
   input:{...input,verifiedMonths:["2026-11"]},publication
  })
 });
 assert.equal((await corrupted(request("hub","week=2026-11-01"))).status,503);
});
