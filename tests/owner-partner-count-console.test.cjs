"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {makeOwnerPartnerCorrections}=require("../functions-partner-workspace/owner-partner-count-operations.cjs");
const {KEYS}=require("../functions-partner-workspace/service.cjs");
const clone=x=>x===undefined?undefined:structuredClone(x);
const day="2026-11-06";
function counts(n=4){return Object.fromEntries(KEYS.map(k=>[k,k==="SB光・AIR"?n:0]));}
class Ref{
 constructor(db,p){this.db=db;this.path=p;this.id=p.split("/").at(-1);}
 collection(n){return new Collection(this.db,this.path+"/"+n);}
 async get(){const data=this.db.store.get(this.path);
  return {id:this.id,exists:data!==undefined,data:()=>clone(data)};}
}
class Collection{
 constructor(db,p){this.db=db;this.path=p;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 where(k,op,v){assert.equal(op,"==");
  return {limit:max=>({get:async()=>{
   const docs=[...this.db.store.entries()].filter(([p,d])=>
    p.startsWith(this.path+"/")&&
    !p.slice(this.path.length+1).includes("/")&&d[k]===v)
    .slice(0,max).map(([p,d])=>({id:p.split("/").at(-1),data:()=>clone(d)}));
   return {size:docs.length,docs};
  }})};
 }
}
class FakeDB{
 constructor(){this.store=new Map();this.writes=[];}
 collection(n){return new Collection(this,n);}
 seed(p,v){this.store.set(p,clone(v));}
 async runTransaction(fn){
  const changes=[];
  const tx={get:r=>r.get(),update:(r,data)=>changes.push(["update",r.path,clone(data)]),
   create:(r,data)=>changes.push(["create",r.path,clone(data)])};
  const result=await fn(tx);
  for(const [kind,p] of changes){
   if(kind==="create"&&this.store.has(p))throw Error("already-exists");
   if(kind==="update"&&!this.store.has(p))throw Error("not-found");
  }
  for(const [kind,p,v] of changes){
   this.store.set(p,kind==="create"?v:{...this.store.get(p),...v});
   this.writes.push({kind,path:p});
  }
  return result;
 }
}
function fixture(){
 const db=new FakeDB();
 const source={companyId:"partner1",hubCompanyId:"hub",staffId:"staff1",date:day,
  counts:counts(4),totalCount:4,privateCounts:{extra1:2},privateTotalCount:2,
  teamIdSnapshot:"oldteam",staffNameSnapshot:"田中",version:3,
  revenue:234567,customHistoricalNote:"keep",workLocation:"現場A"};
 const report={source:"staff-entries-v1",hubCompanyId:"hub",
  partnerCompanyId:"partner1",partnerName:"協力店A",
  date:day,counts:counts(4),totalCount:4,otherProtectedFlag:"safe"};
 db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 db.seed("companies/partner1",{companyKind:"partner",hubCompanyId:"hub",
  active:true,name:"協力店A"});
 db.seed("companies/partner1/partnerWorkEntries/"+day+"__staff1",source);
 db.seed("companies/hub/partnerWorkCountDays/"+day+"/reports/partner1",report);
 const fail=code=>{const e=Error(code||"permission-denied");e.code=code||"permission-denied";throw e};
 const validateCounts=raw=>{
  if(!raw||Object.keys(raw).length!==9||KEYS.some(k=>!Number.isSafeInteger(raw[k])||
      raw[k]<0||raw[k]>9999))fail("invalid-argument");
  const n=Object.fromEntries(KEYS.map(k=>[k,raw[k]]));
  return {counts:n,total:Object.values(n).reduce((a,b)=>a+b,0)};
 };
 const validatePrivateCounts=raw=>{
  if(!raw||typeof raw!=="object")fail();
  const n=Object.fromEntries(Object.entries(raw));
  if(Object.values(n).some(v=>!Number.isSafeInteger(v)||v<0))fail();
  return {counts:n,total:Object.values(n).reduce((a,b)=>a+b,0)};
 };
 const ops=makeOwnerPartnerCorrections({db,
  actor:async r=>({uid:r.auth.uid}),
  scope:async uid=>uid==="owner"?{kind:"hub",cid:"hub",role:"owner"}:
    uid==="other_owner"?{kind:"hub",cid:"other_hub",role:"owner"}:
    uid==="leader"?{kind:"partner",cid:"partner1",hubId:"hub",role:"leader"}:
    {kind:"hub",cid:"hub",role:"member"},
  collection:(cid,n)=>db.collection("companies").doc(cid).collection(n),
  FieldValue:{serverTimestamp:()=>({synthetic:true})},fail,
  validDate:x=>{if(x!==day)fail("invalid-argument");return x;},
  validateCounts,validatePrivateCounts,KEYS,
  legacyPolicyFor:async()=>({mode:"legacy",blockedCategories:[]}),
  assertLegacyEdit:()=>true
 });
 const req=(uid,data)=>({auth:{uid},data});
 return {db,ops,req,source,report};
}
test("Hub Owner reads exactly one partner company and only saved count fields",async()=>{
 const {db,ops,req}=fixture(),old=clone([...db.store]);
 const p=await ops.viewDay(req("owner",{date:day,partnerCompanyId:"partner1"}));
 assert.equal(p.scope,"hub_owner_partner_count_correction");
 assert.equal(p.companyName,"協力店A");
 assert.equal(p.records.length,1);
 assert.equal(p.records[0].staffName,"田中");
 assert.equal(p.records[0].counts["SB光・AIR"],4);
 assert.equal(p.records[0].version,3);
 assert.equal(p.existingRecordsOnly,true);
 assert.equal(p.financialFieldsIncluded,false);
 assert.doesNotMatch(JSON.stringify(p),/revenue|unitPrice|234567|customHistoricalNote|workLocation/);
 assert.deepEqual([...db.store],old);
});
test("Owner count correction updates only one original row and its matching daily aggregate with immutable audit",async()=>{
 const {db,ops,req,source,report}=fixture();
 const n={...counts(4),"NURO":2};
 const answer=await ops.correctDay(req("owner",{partnerCompanyId:"partner1",
  date:day,staffId:"staff1",counts:n,expectedVersion:3,reason:"現場の契約件数を照合"}));
 assert.equal(answer.saved,true);assert.equal(answer.version,4);
 assert.equal(answer.totalCount,6);assert.equal(answer.correctionLogged,true);
 const entry=db.store.get("companies/partner1/partnerWorkEntries/"+day+"__staff1");
 assert.deepEqual(entry.counts,n);
 assert.equal(entry.totalCount,6);assert.equal(entry.version,4);
 for(const k of ["privateCounts","privateTotalCount","teamIdSnapshot","staffNameSnapshot",
  "revenue","customHistoricalNote","workLocation"])
  assert.deepEqual(entry[k],source[k],k);
 const summary=db.store.get("companies/hub/partnerWorkCountDays/"+day+"/reports/partner1");
 assert.equal(summary.totalCount,6);
 assert.equal(summary.counts.NURO,2);
 assert.equal(summary.otherProtectedFlag,report.otherProtectedFlag);
 const aud=db.store.get("companies/partner1/partnerWorkAudits/"+day+"__staff1__v4");
 assert.equal(aud.correctionActorUid,"owner");
 assert.equal(aud.correctionType,"owner_proxy_count_correction");
 assert.deepEqual(aud.previousCounts,counts(4));
 assert.deepEqual(aud.counts,n);
 assert.deepEqual(db.writes.map(x=>x.path).sort(),[
  "companies/partner1/partnerWorkEntries/"+day+"__staff1",
  "companies/hub/partnerWorkCountDays/"+day+"/reports/partner1",
  "companies/partner1/partnerWorkAudits/"+day+"__staff1__v4"].sort());
});
test("Stale version, unauthorized hub, partner user and new record are denied without writes",async()=>{
 const {db,ops,req}=fixture(),original=clone([...db.store]);
 const payload={partnerCompanyId:"partner1",date:day,
  staffId:"staff1",counts:{...counts(4),NURO:1},
  expectedVersion:2,reason:"契約件数の再確認"};
 for(const uid of ["leader","member","other_owner"]){
  await assert.rejects(ops.viewDay(req(uid,{partnerCompanyId:"partner1",date:day})));
  await assert.rejects(ops.correctDay(req(uid,{...payload,expectedVersion:3})));
 }
 await assert.rejects(ops.correctDay(req("owner",payload)));
 await assert.rejects(ops.correctDay(req("owner",{...payload,expectedVersion:1,
  staffId:"unknown"})));
 await assert.rejects(ops.correctDay(req("owner",{...payload,expectedVersion:3,
  reason:""})));
 await assert.rejects(ops.correctDay(req("owner",{...payload,expectedVersion:3,
  counts:{...counts(4),NURO:1,unexpected:9}})));
 assert.deepEqual([...db.store],original);
 assert.equal(db.writes.length,0);
});
test("A dual partner workspace Owner is refused even if primary role still claims hub owner",async()=>{
 const {db,ops,req}=fixture();
 db.seed("partnerWorkspaceContexts/owner",{active:true,kind:"partner_secondary"});
 await assert.rejects(ops.viewDay(req("owner",{partnerCompanyId:"partner1",date:day})));
 await assert.rejects(ops.correctDay(req("owner",{
  partnerCompanyId:"partner1",date:day,staffId:"staff1",
  counts:{...counts(4),NURO:1},expectedVersion:3,reason:"入力誤りの修正"})));
 assert.equal(db.writes.length,0);
});
test("Unapproved company, mismatched saved total or missing aggregate block changes",async()=>{
 for(const change of ["inactive","bad_total","no_summary"]){
  const {db,ops,req}=fixture();
  if(change==="inactive")db.seed("partnerRelations/partner1",{
   partnerCompanyId:"partner1",hubCompanyId:"hub",active:false,countSharingApproved:true});
  if(change==="bad_total"){
   const p="companies/hub/partnerWorkCountDays/"+day+"/reports/partner1";
   db.seed(p,{...db.store.get(p),totalCount:5});
  }
  if(change==="no_summary")db.store.delete("companies/hub/partnerWorkCountDays/"+day+"/reports/partner1");
  await assert.rejects(ops.correctDay(req("owner",{partnerCompanyId:"partner1",
   date:day,staffId:"staff1",expectedVersion:3,
   counts:{...counts(4),NURO:1},reason:"件数整合確認"})));
  assert.equal(db.writes.length,0,change);
 }
});
test("Unchanged counts do not create history or overwrite saved values",async()=>{
 const {db,ops,req}=fixture(),old=clone([...db.store]);
 const r=await ops.correctDay(req("owner",{
  partnerCompanyId:"partner1",date:day,staffId:"staff1",
  counts:counts(4),expectedVersion:3,reason:"照合後変更不要"}));
 assert.equal(r.unchanged,true);
 assert.deepEqual([...db.store],old);assert.equal(db.writes.length,0);
});
test("Owner does not bypass active partner publication gate and never reattributes retired teams",async()=>{
 const {db,ops,req}=fixture();
 // For a real gate, the source is authoritative even if a team is retired.
 // Source snapshot must be retained by the atomic patch.
 await ops.correctDay(req("owner",{partnerCompanyId:"partner1",date:day,
  staffId:"staff1",counts:{...counts(4),NURO:1},
  expectedVersion:3,reason:"修正理由を保存"}));
 assert.equal(db.store.get("companies/partner1/partnerWorkEntries/"+day+"__staff1")
  .teamIdSnapshot,"oldteam");
});
test("Owner can classify SB光3 and Air1 while keeping old combined 4, prices and history unchanged",async()=>{
 const {db,ops,req,source,report}=fixture(),original=clone([...db.store]);
 const result=await ops.classifyOwnerInternet(req("owner",{
  partnerCompanyId:"partner1",date:day,staffId:"staff1",
  hikari:3,air:1,sourceVersion:3,expectedRevision:0,
  reason:"契約書の光Air内訳を照合"}));
 assert.equal(result.saved,true);
 assert.equal(result.combinedCount,4);
 assert.equal(result.correctionLogged,true);
 const stored=db.store.get("companies/partner1/partnerInternetSplits/"+day+"__staff1");
 assert.equal(stored.hikari,3);assert.equal(stored.air,1);
 assert.equal(stored.combinedCount,4);assert.equal(stored.revision,1);
 const audit=db.store.get("companies/partner1/partnerInternetSplitAudits/"+day+"__staff1__v1");
 assert.equal(audit.correctionActorUid,"owner");
 assert.equal(audit.correctionType,"hub_owner_internet_classification");
 assert.equal(audit.previousHikari,null);
 assert.equal(audit.previousAir,null);
 for(const [p,v] of original)assert.deepEqual(db.store.get(p),v,p);
 assert.deepEqual(db.store.get("companies/partner1/partnerWorkEntries/"+day+"__staff1"),source);
 assert.deepEqual(db.store.get("companies/hub/partnerWorkCountDays/"+day+"/reports/partner1"),report);
 assert.deepEqual(db.writes.map(x=>x.path).sort(),[
  "companies/partner1/partnerInternetSplits/"+day+"__staff1",
  "companies/partner1/partnerInternetSplitAudits/"+day+"__staff1__v1"].sort());
});
test("Owner cannot fabricate split totals or mutate another company's data",async()=>{
 const {db,ops,req}=fixture(),original=clone([...db.store]);
 const base={partnerCompanyId:"partner1",date:day,staffId:"staff1",
  hikari:3,air:1,sourceVersion:3,expectedRevision:0,
  reason:"販売契約を再確認"};
 const examples=[
  {...base,hikari:4},{...base,air:2},{...base,sourceVersion:2},
  {...base,expectedRevision:1},{...base,staffId:"unknown"},
  {...base,partnerCompanyId:"other"},{...base,reason:""},
  {...base,extra:"unauthorized"},{...base,hikari:"3"}
 ];
 for(const data of examples)await assert.rejects(ops.classifyOwnerInternet(req("owner",data)));
 for(const who of ["leader","other_owner","member"])
  await assert.rejects(ops.classifyOwnerInternet(req(who,base)));
 assert.deepEqual([...db.store],original);assert.equal(db.writes.length,0);
});
test("Owner Hikari/Air reclassification is revision-checked and audit-only, never overwrites legacy counts",async()=>{
 const {db,ops,req,source}=fixture();
 const base={partnerCompanyId:"partner1",date:day,staffId:"staff1",
  hikari:3,air:1,sourceVersion:3,expectedRevision:0,reason:"契約確認後に振分"};
 await ops.classifyOwnerInternet(req("owner",base));
 const r=await ops.classifyOwnerInternet(req("owner",{
  ...base,hikari:2,air:2,expectedRevision:1}));
 assert.equal(r.revision,2);
 await assert.rejects(ops.classifyOwnerInternet(req("owner",base)));
 const unchanged=await ops.classifyOwnerInternet(req("owner",{
  ...base,hikari:2,air:2,expectedRevision:2}));
 assert.equal(unchanged.unchanged,true);
 assert.equal(db.store.get("companies/partner1/partnerInternetSplitAudits/"+day+"__staff1__v1").hikari,3);
 assert.equal(db.store.get("companies/partner1/partnerInternetSplitAudits/"+day+"__staff1__v2").hikari,2);
 assert.deepEqual(db.store.get("companies/partner1/partnerWorkEntries/"+day+"__staff1"),source);
});
test("Corrupt legacy nine-category source refuses Owner split without changing historical counts",async()=>{
 const {db,ops,req}=fixture();
 const path="companies/partner1/partnerWorkEntries/"+day+"__staff1";
 db.seed(path,{...db.store.get(path),totalCount:5});
 const original=clone([...db.store]);
 await assert.rejects(ops.classifyOwnerInternet(req("owner",{
  partnerCompanyId:"partner1",date:day,staffId:"staff1",
  hikari:3,air:1,sourceVersion:3,expectedRevision:0,
  reason:"契約内容を照合"})));
 assert.deepEqual([...db.store],original);
 assert.equal(db.writes.length,0);
});
test("Owner company console uses existing menu, no sign-out, and revokes stale account DOM",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const server=fs.readFileSync(path.join(__dirname,
  "../functions-partner-workspace/service.cjs"),"utf8");
 const endpoints=fs.readFileSync(path.join(__dirname,
  "../functions-partner-workspace/index.js"),"utf8");
 const i=html.indexOf("async function openOwnerPartnerProxy("),
  e=html.indexOf("async function loadPartnerCompanyList()",i);
 assert(i>0&&e>i);
 const block=html.slice(i,e);
 assert.match(html,/id="ownerPartnerProxyPanel"/);
 assert.match(html,/協力店管理/);
 assert.match(html,/company\.name\+" の管理画面を開く"/);
 assert.match(block,/partnerCompanyId:companyId/);
 assert.match(block,/currentUser\?\.uid!==uid/);
 assert.match(block,/submitOwnerPartnerCorrection/);
 assert.match(block,/readOwnerPartnerCorrectionDay/);
 assert.doesNotMatch(block,/\b(?:signOut|signIn|login|setDoc|deleteDoc|updateDoc|writeBatch)\s*\(/);
 assert.match(html,/function resetPartnerInline\(\)\{\n ownerCatalogReset\(\);\n ownerProxyReset\(\)/);
 assert.match(server,/makeOwnerPartnerCorrections/);
 assert.match(endpoints,/exports\.submitOwnerPartnerCorrection=onCall/);
 assert.match(endpoints,/exports\.getOwnerPartnerCorrectionDay=onCall/);
 assert.ok(html.includes("async function openOwnerSplitEditor("));
 assert.ok(html.includes("submitOwnerPartnerInternetSplit"));
 assert.ok(html.includes("SB光・Airの内訳を訂正"));
 assert.ok(endpoints.includes("exports.submitOwnerPartnerInternetSplit=onCall"));
});
