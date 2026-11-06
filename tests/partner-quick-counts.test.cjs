"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeQuickCounts,KEYS}=require("../functions-partner-quick/quick-counts.cjs");
const today="2026-10-31", now=()=>Date.parse("2026-10-30T17:20:00.000Z");
const copy=o=>o==null?o:JSON.parse(JSON.stringify(o));
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Collection(this.db,this.path+"/"+name);}
 async get(){const d=this.db.data.get(this.path);return {exists:!!d,data:()=>copy(d),id:this.id};}
}
class Collection{
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 limit(n){return {get:async()=>{const docs=[];for(const [p,d] of this.db.data){if(p.startsWith(this.path+"/")&&!p.slice(this.path.length+1).includes('/'))docs.push({id:p.split('/').at(-1),data:()=>copy(d)});}return {size:docs.slice(0,n).length,docs:docs.slice(0,n)};}};}
 where(field,op,value){assert.equal(op,"==");const col=this;return {limit(n){return {get:async()=>{const all=await col.limit(500).get();const docs=all.docs.filter(x=>x.data()[field]===value).slice(0,n);return {docs,size:docs.length};}};}};}
}
class DB{
 constructor(){this.data=new Map();}
 collection(name){return new Collection(this,name);}
 seed(path,body){this.data.set(path,copy(body));}
 async runTransaction(fn){const changes=[];const tx={get:r=>r.get(),create:(r,d)=>changes.push(["create",r.path,copy(d)]),update:(r,d)=>changes.push(["update",r.path,copy(d)])};const result=await fn(tx);for(const [action,path] of changes){if(action==="create"&&this.data.has(path))throw Error("already-exists");if(action==="update"&&!this.data.has(path))throw Error("not-found");}for(const [action,path,data] of changes)this.data.set(path,action==="create"?data:{...this.data.get(path),...data});return result;}
}
class HttpsError extends Error{constructor(code,msg){super(msg);this.code=code;}}
function setup({enabled=true,authDisabled=false}={}){
 const db=new DB();
 const user=(uid,cid,kind,owner=true)=>({uid,companyId:cid,companyRole:owner?"owner":"member",active:true,
   ...(kind==="partner"?{accessKind:"partner",memberType:"cooperator",canViewRevenue:false,canViewUnitPrice:false}:{accessKind:"internal"})});
 db.seed("companies/hub",{ownerUid:"h",companyKind:"internal",active:true,name:"Hub"});
 db.seed("companies/partner1",{ownerUid:"p",companyKind:"partner",hubCompanyId:"hub",active:true,name:"協力店1"});
 db.seed("companies/otherhub",{ownerUid:"o",companyKind:"internal",active:true,name:"OtherHub"});
 db.seed("users/h",user("h","hub","internal"));
 db.seed("companies/hub/members/h",user("h","hub","internal"));
 db.seed("users/p",user("p","partner1","partner"));
 db.seed("companies/partner1/members/p",user("p","partner1","partner"));
 db.seed("users/o",user("o","otherhub","internal"));
 db.seed("companies/otherhub/members/o",user("o","otherhub","internal"));
 db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",hubCompanyId:"hub",active:true,countSharingApproved:true,catalogAccessApproved:true});
 db.seed("products/private-revenue",{companyId:"hub",revenue:999,unitPrice:100});
 db.seed("records/existing",{companyId:"hub",totalCount:4,totalRevenue:10000});
 const getAuth=()=>({getUser:async uid=>({uid,disabled:authDisabled,emailVerified:true,email:uid+"@example.com"}),verifyIdToken:async bearer=>({uid:bearer[0],email_verified:true,email:bearer[0]+"@example.com"})});
 const service=makeQuickCounts({db,getAuth,FieldValue:{serverTimestamp:()=>({seconds:12345})},HttpsError,enabled:()=>enabled,now});
 const req=(uid,data)=>({auth:{uid,token:{email:uid+"@example.com",email_verified:true}},rawRequest:{headers:{authorization:"Bearer "+uid.repeat(30)}},data});
 const counts=Object.fromEntries(KEYS.map(k=>[k,0]));
 return {db,service,req,counts};
}
test("partner owner can submit, correct, and hub owner reads ONLY isolated count records",async()=>{
 const {db,service,req,counts}=setup();
 const existing=copy(db.data.get("records/existing")),product=copy(db.data.get("products/private-revenue"));
 const first=await service.submit(req("p",{date:today,counts:{...counts,NURO:2,SBMNP:1},expectedVersion:0}));
 assert.deepEqual({saved:first.saved,version:first.version,totalCount:first.totalCount},{saved:true,version:1,totalCount:3});
 const own=await service.view(req("p",{date:today}));assert.equal(own.role,"partner");assert.equal(own.report.counts.NURO,2);
 const hub=await service.view(req("h",{date:today}));assert.equal(hub.role,"hub");assert.equal(hub.partners.length,1);assert.equal(hub.partners[0].name,"協力店1");assert.equal(hub.totalCount,3);
 assert.equal(JSON.stringify(hub).includes("revenue"),false);assert.equal(JSON.stringify(hub).includes("unitPrice"),false);
 await assert.rejects(service.submit(req("p",{date:today,counts,expectedVersion:0})),e=>e.code==="aborted");
 const second=await service.submit(req("p",{date:today,counts:{...counts,YMMNP:5},expectedVersion:1}));assert.equal(second.version,2);assert.equal(second.totalCount,5);
 assert.equal([...db.data.keys()].filter(p=>p.startsWith("partnerQuickCountAudits/")).length,2);
 assert.deepEqual(db.data.get("records/existing"),existing);assert.deepEqual(db.data.get("products/private-revenue"),product);
 const other=await service.view(req("o",{date:today}));assert.deepEqual(other.partners,[]);
});
test("zero report, invalid or future date, financial fields and unknown categories are rejected",async()=>{
 const {service,req,counts}=setup();
 const report=await service.submit(req("p",{date:today,counts,expectedVersion:0}));assert.equal(report.totalCount,0);
 await assert.rejects(service.submit(req("p",{date:"2026-11-03",counts,expectedVersion:1})),e=>e.code==="invalid-argument");
 await assert.rejects(service.submit(req("p",{date:today,counts:{...counts,売上:4},expectedVersion:1})),e=>e.code==="invalid-argument");
 await assert.rejects(service.submit(req("p",{date:today,counts:{...counts,NURO:10000},expectedVersion:1})),e=>e.code==="invalid-argument");
 await assert.rejects(service.submit(req("p",{date:today,counts:{...counts,NURO:-2},expectedVersion:1})),e=>e.code==="invalid-argument");
 await assert.rejects(service.submit(req("p",{date:today,counts,expectedVersion:1,unitPrice:400})),e=>e.code==="invalid-argument");
});
test("off, revoked auth, mixed company grants, and hub actor writing are always rejected",async()=>{
 const x=setup({enabled:false});
 await assert.rejects(x.service.submit(x.req("p",{date:today,counts:x.counts,expectedVersion:0})),e=>e.code==="unavailable");
 const y=setup({authDisabled:true});
 await assert.rejects(y.service.view(y.req("h",{date:today})),e=>e.code==="unauthenticated");
 const z=setup();
 await assert.rejects(z.service.submit(z.req("h",{date:today,counts:z.counts,expectedVersion:0})),e=>e.code==="permission-denied");
 z.db.seed("users/p",{...z.db.data.get("users/p"),accessKind:"internal"});
 await assert.rejects(z.service.submit(z.req("p",{date:today,counts:z.counts,expectedVersion:0})),e=>e.code==="permission-denied");
 assert.equal(z.db.data.size,12);
});
test("no direct access or write to old money collections and no destructive operations",()=>{
 const fs=require("node:fs"),code=fs.readFileSync(require.resolve("../functions-partner-quick/quick-counts.cjs"),"utf8");
 assert.doesNotMatch(code,/\.delete\s*\(/);
 assert.doesNotMatch(code,/\.collection\s*\(\s*["'](?:products|records|recordCorrections|revenueGoals)["']\s*\)/);
 assert.doesNotMatch(code,/\.set\s*\(/);
});

test("invited but not activated partner cannot read or save, and hub sees no data",async()=>{
 const {db,service,req,counts}=setup();
 db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",hubCompanyId:"hub",
   active:false,countSharingApproved:false,catalogAccessApproved:false});
 const originalCount=db.data.size;
 await assert.rejects(service.submit(req("p",{date:today,counts:{...counts,NURO:7},expectedVersion:0})),
   e=>e.code==="permission-denied");
 await assert.rejects(service.view(req("p",{date:today})),e=>e.code==="permission-denied");
 const hub=await service.view(req("h",{date:today}));
 assert.equal(hub.totalCount,0);
 assert.equal(hub.partners.length,0);
 assert.equal(db.data.size,originalCount);
 assert.equal([...db.data.keys()].some(x=>x.includes("partnerQuickCountDays")),false);
});
test("revoked and partially activated partner reports cannot leak saved counts to hub",async()=>{
 const {db,service,req,counts}=setup();
 await service.submit(req("p",{date:today,counts:{...counts,NURO:3},expectedVersion:0}));
 const report=[...db.data.entries()].find(([key])=>key.includes("partnerQuickCountDays"))[1];
 const original=copy(report);
 for(const flags of [
  {active:false,countSharingApproved:true},
  {active:true,countSharingApproved:false},
  {active:false,countSharingApproved:false}
 ]){
  db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",hubCompanyId:"hub",...flags});
  await assert.rejects(service.submit(req("p",{date:today,counts,expectedVersion:1})),
    e=>e.code==="permission-denied");
  await assert.rejects(service.view(req("p",{date:today})),e=>e.code==="permission-denied");
  const hub=await service.view(req("h",{date:today}));
  assert.deepEqual(hub.partners,[]);
  assert.equal(hub.totalCount,0);
 }
 assert.deepEqual([...db.data.entries()].find(([key])=>key.includes("partnerQuickCountDays"))[1],original,
   "revocation must never delete or alter historical count records");
});

test("hub explicitly approves a pending invited company for quick counts only, then can revoke without changing finance",async()=>{
 const {db,service,req,counts}=setup();
 db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",hubCompanyId:"hub",
  active:false,countSharingApproved:false,catalogAccessApproved:false});
 const originalRecord=copy(db.data.get("records/existing"));
 const originalProduct=copy(db.data.get("products/private-revenue"));
 const originalUser=copy(db.data.get("users/p"));
 const before=await service.view(req("h",{date:today}));
 assert.equal(before.pendingPartners.length,1);
 assert.equal(before.pendingPartners[0].approved,false);
 await assert.rejects(service.view(req("p",{date:today})),e=>e.code==="permission-denied");
 const approved=await service.approve(req("h",{partnerCompanyId:"partner1",approved:true}));
 assert.deepEqual(approved,{partnerCompanyId:"partner1",approved:true,countOnly:true,financeAccess:false});
 const relation=db.data.get("partnerRelations/partner1");
 assert.deepEqual({active:relation.active,countSharingApproved:relation.countSharingApproved,
  catalogAccessApproved:relation.catalogAccessApproved},{active:false,countSharingApproved:false,catalogAccessApproved:false});
 assert.equal(db.data.get("partnerQuickCountApprovals/partner1").approved,true);
 const saved=await service.submit(req("p",{date:today,counts:{...counts,NURO:3},expectedVersion:0}));
 assert.equal(saved.version,1);
 assert.equal((await service.view(req("p",{date:today}))).report.counts.NURO,3);
 const hub=await service.view(req("h",{date:today}));
 assert.equal(hub.partners[0].totalCount,3);
 assert.equal(hub.pendingPartners[0].approved,true);
 const changed=await service.submit(req("p",{date:today,counts:{...counts,NURO:2},expectedVersion:1}));
 assert.equal(changed.version,2);
 assert.equal((await service.view(req("h",{date:today}))).totalCount,2);
 const revoked=await service.approve(req("h",{partnerCompanyId:"partner1",approved:false}));
 assert.equal(revoked.approved,false);
 await assert.rejects(service.submit(req("p",{date:today,counts,expectedVersion:2})),e=>e.code==="permission-denied");
 assert.equal((await service.view(req("h",{date:today}))).partners.length,0);
 assert.equal(db.data.get("partnerQuickCountApprovalAudits")===undefined,true);
 assert.equal([...db.data.keys()].filter(x=>x.startsWith("partnerQuickCountApprovalAudits/")).length,2);
 assert.deepEqual(db.data.get("records/existing"),originalRecord);
 assert.deepEqual(db.data.get("products/private-revenue"),originalProduct);
 assert.deepEqual(db.data.get("users/p"),originalUser);
});
test("quick count approval denies unauthorized company, malformed grants and revenue-enabled owners without writes",async()=>{
 const x=setup();x.db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",
  hubCompanyId:"hub",active:false,countSharingApproved:false,catalogAccessApproved:false});
 const inputs=[
  [x.req("o",{partnerCompanyId:"partner1",approved:true}),"permission-denied"],
  [x.req("p",{partnerCompanyId:"partner1",approved:true}),"permission-denied"],
  [x.req("h",{partnerCompanyId:"otherhub",approved:true}),"permission-denied"],
  [x.req("h",{partnerCompanyId:"partner1",approved:"true"}),"invalid-argument"],
  [x.req("h",{partnerCompanyId:"partner1",approved:true,finance:true}),"invalid-argument"]
 ];
 for(const [r,code] of inputs){
  const before=copy([...x.db.data]);
  await assert.rejects(x.service.approve(r),e=>e.code===code);
  assert.deepEqual([...x.db.data],before);
 }
 for(const altered of [
  db=>{db.data.get("users/p").canViewRevenue=true;},
  db=>{db.data.get("companies/partner1/members/p").canViewUnitPrice=true;},
  db=>{db.data.get("companies/partner1").hubCompanyId="otherhub";},
  db=>{db.data.get("partnerRelations/partner1").countSharingRevokedAt={seconds:10};},
  db=>{db.data.get("users/p").accessKind="internal";}
 ]){
  const y=setup();
  y.db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",hubCompanyId:"hub",
    active:false,countSharingApproved:false,catalogAccessApproved:false});
  altered(y.db);const initial=copy([...y.db.data]);
  await assert.rejects(y.service.approve(y.req("h",{partnerCompanyId:"partner1",approved:true})));
  assert.deepEqual([...y.db.data],initial);
 }
});

test("hub owner corrects separate quick count ledger with versioned audit; sales and staff originals untouched",async()=>{
 const {db,service,req,counts}=setup();
 await service.submit(req("p",{date:today,counts:{...counts,NURO:3,"SB光・AIR":2},expectedVersion:0}));
 const source="companies/hub/partnerQuickCountDays/"+today+"/reports/partner1";
 const original=copy(db.data.get(source));
 const sales=copy(db.data.get("records/existing"));
 const catalog=copy(db.data.get("products/private-revenue"));
 const partnerUser=copy(db.data.get("users/p"));
 const view=await service.viewOwnerQuickCorrection(req("h",{date:today,partnerCompanyId:"partner1"}));
 assert.equal(view.scope,"hub_owner_quick_count_correction");
 assert.equal(view.report.totalCount,5);
 assert.equal(view.report.version,1);
 assert.equal(view.financialFieldsIncluded,false);
 assert.doesNotMatch(JSON.stringify(view),/totalRevenue|unitPrice|email|password/i);
 const corrected={...counts,NURO:4,"SB光・AIR":2};
 const result=await service.submitOwnerQuickCorrection(req("h",{
  date:today,partnerCompanyId:"partner1",counts:corrected,
  expectedVersion:1,reason:"元契約を照合して件数訂正"
 }));
 assert.deepEqual({
  saved:result.saved,version:result.version,totalCount:result.totalCount,
  correctionLogged:result.correctionLogged
 },{saved:true,version:2,totalCount:6,correctionLogged:true});
 const row=db.data.get(source);
 assert.equal(row.counts.NURO,4);assert.equal(row.totalCount,6);
 assert.equal(row.partnerCompanyId,original.partnerCompanyId);
 assert.equal(row.hubCompanyId,original.hubCompanyId);
 assert.equal(row.version,2);
 const id=require("node:crypto").createHash("sha256")
  .update(["hub",today,"partner1"].join("|")).digest("hex")+"_v2";
 const audit=db.data.get("partnerQuickCountAudits/"+id);
 assert.equal(audit.correctionActorUid,"h");
 assert.equal(audit.correctionReason,"元契約を照合して件数訂正");
 assert.equal(audit.correctionType,"hub_owner_quick_count_correction");
 assert.deepEqual(audit.previousCounts,original.counts);
 assert.deepEqual(audit.counts,corrected);
 assert.deepEqual(db.data.get("records/existing"),sales);
 assert.deepEqual(db.data.get("products/private-revenue"),catalog);
 assert.deepEqual(db.data.get("users/p"),partnerUser);
 const reRead=await service.viewOwnerQuickCorrection(req("h",{date:today,partnerCompanyId:"partner1"}));
 assert.equal(reRead.report.totalCount,6);
 assert.equal(reRead.report.version,2);
});
test("hub Owner quick correction rejects unknown day and stale versions without any writes",async()=>{
 const {db,service,req,counts}=setup();
 const changes={...counts,NURO:2};
 const payload={date:today,partnerCompanyId:"partner1",counts:changes,
  expectedVersion:1,reason:"元契約書と照合済み"};
 const before=copy([...db.data]);
 await assert.rejects(service.submitOwnerQuickCorrection(req("h",payload)),x=>x.code==="failed-precondition");
 assert.deepEqual([...db.data],before);
 await service.submit(req("p",{date:today,counts:{...counts,NURO:1},expectedVersion:0}));
 const saved=copy([...db.data]);
 for(const mutation of [
  {expectedVersion:0},{expectedVersion:2},{reason:""},
  {reason:"a"},{counts:{...changes,NURO:-1}},
  {counts:{...changes,NURO:0.5}},{counts:{...changes,totalRevenue:12345}},
  {date:"2045-01-01"},{extra:true},{partnerCompanyId:"wrong"}
 ]){
  await assert.rejects(service.submitOwnerQuickCorrection(req("h",{...payload,...mutation})));
  assert.deepEqual([...db.data],saved);
 }
});
test("partner account, another hub, revoked or dual-context Owner cannot proxy-correct quick counts",async()=>{
 const {db,service,req,counts}=setup();
 await service.submit(req("p",{date:today,counts:{...counts,NURO:1},expectedVersion:0}));
 const changes={...counts,NURO:2};
 const payload={date:today,partnerCompanyId:"partner1",counts:changes,
  expectedVersion:1,reason:"業務日報と照合済み"};
 const old=copy([...db.data]);
 for(const who of ["p","o"]){
  await assert.rejects(service.viewOwnerQuickCorrection(req(who,{
   date:today,partnerCompanyId:"partner1"})));
  await assert.rejects(service.submitOwnerQuickCorrection(req(who,payload)));
 }
 db.seed("partnerWorkspaceContexts/h",{active:true,kind:"partner_secondary"});
 await assert.rejects(service.viewOwnerQuickCorrection(req("h",{
  date:today,partnerCompanyId:"partner1"})));
 await assert.rejects(service.submitOwnerQuickCorrection(req("h",payload)));
 db.data.delete("partnerWorkspaceContexts/h");
 assert.deepEqual([...db.data],old);
 db.seed("partnerRelations/partner1",{partnerCompanyId:"partner1",hubCompanyId:"hub",
  active:false,countSharingApproved:false,countSharingRevokedAt:{seconds:1}});
 await assert.rejects(service.submitOwnerQuickCorrection(req("h",payload)));
 assert.equal(db.data.get("companies/hub/partnerQuickCountDays/"+today+"/reports/partner1").totalCount,1);
});
test("no-op Owner quick correction never overwrites original or appends history",async()=>{
 const {db,service,req,counts}=setup();
 const first={...counts,NURO:2};
 await service.submit(req("p",{date:today,counts:first,expectedVersion:0}));
 const before=copy([...db.data]);
 const result=await service.submitOwnerQuickCorrection(req("h",{
  date:today,partnerCompanyId:"partner1",counts:first,
  expectedVersion:1,reason:"帳票を照合して変更不要"
 }));
 assert.equal(result.unchanged,true);assert.equal(result.saved,false);
 assert.deepEqual([...db.data],before);
});
test("hub quick management UI never switches account or edits staff ledger and closes on logout",()=>{
 const fs=require("node:fs"),html=fs.readFileSync(require("node:path").join(__dirname,"../index.html"),"utf8");
 const exports=fs.readFileSync(require("node:path").join(__dirname,"../functions-partner-quick/index.js"),"utf8");
 for(const id of ["ownerPartnerQuickProxyPanel","ownerPartnerQuickStatus",
   "ownerPartnerQuickFields","ownerPartnerQuickReason","ownerPartnerQuickSave","ownerPartnerQuickRefresh"]){
  assert.equal(html.split('id="'+id+'"').length-1,1,id);
 }
 assert(html.includes("async function openOwnerPartnerQuickProxy("));
 assert(html.includes("function ownerQuickReset(){"));
 assert(html.includes("ownerQuickReset();\n ownerDirReset();"));
 assert(html.includes('submitOwnerPartnerQuickCorrection = httpsCallable'));
 assert(html.includes('readOwnerPartnerQuickCorrection = httpsCallable'));
 assert(html.includes("件数専用の報告を管理"));
 assert(exports.includes("exports.getOwnerPartnerQuickCorrection=onCall"));
 assert(exports.includes("exports.submitOwnerPartnerQuickCorrection=onCall"));
 const a=html.indexOf("async function openOwnerPartnerQuickProxy(");
 const b=html.indexOf("document.getElementById(\"ownerPartnerQuickClose\")",a);
 assert(a>0&&b>a);
 const section=html.slice(a,b);
 assert.doesNotMatch(section,/\b(?:signOut|signIn|deleteDoc|updateDoc|setDoc)\s*\(/);
});
