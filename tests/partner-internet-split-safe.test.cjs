"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),os=require("node:os");
const {makePartnerInternetSplitOperations}=require("../functions-partner-workspace/internet-split-operations.cjs");
const {validateSource,readSplit,projectSplit}=require("../functions-partner-workspace/internet-split-operations.cjs");
const KEY="SB光・AIR";
const clone=x=>x===undefined?undefined:structuredClone(x);
class Ref{
 constructor(db,p){this.db=db;this.path=p;this.id=p.split("/").at(-1);}
 collection(n){return new Col(this.db,this.path+"/"+n);}
 async get(){const d=this.db.items.get(this.path);
  return {id:this.id,exists:d!==undefined,data:()=>clone(d)};}
}
class Col{
 constructor(db,p){this.db=db;this.path=p;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 where(k,op,v){
  const filters=[[k,op,v]],check=(x,op,y)=>op==="=="?x===y:
   op===">="?x>=y:op==="<="?x<=y:false;
  const chain={where:(key,operator,value)=>{filters.push([key,operator,value]);return chain;},
   limit:max=>({get:async()=>{
    const docs=[];
    for(const [p,d] of this.db.items)if(p.startsWith(this.path+"/")&&
       !p.slice(this.path.length+1).includes("/")&&
       filters.every(([k,op,v])=>check(d[k],op,v)))
     docs.push({id:p.split("/").at(-1),data:()=>clone(d)});
    return {size:docs.length,docs:docs.slice(0,max)};
   }})};
  return chain;
 }
}
class DB{
 constructor(){this.items=new Map();this.writes=[];}
 collection(n){return new Col(this,n);}
 seed(p,v){this.items.set(p,clone(v));}
 async runTransaction(fn){
  const writes=[];
  const tx={get:ref=>ref.get(),
   create:(ref,data)=>writes.push(["create",ref.path,clone(data)]),
   update:(ref,data)=>writes.push(["update",ref.path,clone(data)])};
  const output=await fn(tx);
  for(const [kind,p] of writes){
   if(kind==="create"&&this.items.has(p))throw Error("duplicate");
   if(kind==="update"&&!this.items.has(p))throw Error("missing");
  }
  for(const [kind,p,data] of writes){
   this.items.set(p,kind==="create"?data:{...this.items.get(p),...data});
   this.writes.push({kind,path:p});
  }
  return output;
 }
}
const day="2026-11-06";
const row=(company,staffId,n=5,version=3)=>({
 date:day,staffId,companyId:company,hubCompanyId:"hub",version,
 counts:{"NURO":1,[KEY]:n},totalCount:1+n,
 unitPrice:88000,totalRevenue:999999,secret:"keep everything"
});
function fixture(){
 const db=new DB();
 db.seed("partnerRelations/p1",{partnerCompanyId:"p1",hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 db.seed("companies/p1",{companyKind:"partner",hubCompanyId:"hub",active:true});
 db.seed("partnerRelations/p2",{partnerCompanyId:"p2",hubCompanyId:"hub",
  active:true,countSharingApproved:true});
 db.seed("companies/p2",{companyKind:"partner",hubCompanyId:"hub",active:true});
 for(const cid of ["p1","p2"]){
  db.seed("companies/"+cid+"/partnerWorkEntries/"+day+"__person",row(cid,"person",5,3));
  db.seed("companies/"+cid+"/partnerWorkStaff/person",{
   companyId:cid,uid:"person",kind:"account",name:"田中",active:true});
 }
 const actor=async r=>({uid:r.auth.uid});
 const scope=async(uid)=>uid==="owner"?
  {kind:"hub",cid:"hub",role:"owner"}:
  uid==="leader"?{kind:"partner",cid:"p1",hubId:"hub",role:"leader"}:
  uid==="person"?{kind:"partner",uid,cid:"p1",hubId:"hub",role:"member"}:
  {kind:"partner",cid:"p2",hubId:"hub",role:"member"};
 const fail=code=>{const e=Error(code||"permission-denied");e.code=code||"permission-denied";throw e;};
 const ops=makePartnerInternetSplitOperations({db,actor,scope,
  collection:(cid,name)=>db.collection("companies").doc(cid).collection(name),
  fail,FieldValue:{serverTimestamp:()=>({fake:true})},
  validDate:d=>{if(d!==day)fail("invalid-argument");return d;},
  canStaff:(s,p)=>s.role!=="member"||(p.uid===s.uid&&p.kind==="account")});
 const req=(uid,data)=>({auth:{uid},data});
 return {db,ops,req};
}
test("old combined count is shown as unclassified; no unauthorized automatic split",async()=>{
 const {db,ops,req}=fixture();const before=clone([...db.items]);
 const d=await ops.viewInternetSplitDay(req("leader",{date:day}));
 assert.equal(d.scope,"partner_internet_split_counts_only");
 assert.equal(d.financialFieldsIncluded,false);
 assert.equal(d.records.length,1);
 assert.equal(d.records[0].total,5);
 assert.equal(d.records[0].verified,false);
 assert.equal(d.records[0].unclassified,5);
 assert.equal(d.records[0].hikari,null);
 assert.equal(d.records[0].air,null);
 assert.doesNotMatch(JSON.stringify(d),/unitPrice|totalRevenue|999999|88000|secret/);
 assert.deepEqual([...db.items],before);
});
test("explicit 3 Hikari + 2 Air writes only split+audit; old source, sales, totals untouched",async()=>{
 const {db,ops,req}=fixture(),before=clone([...db.items]);
 const result=await ops.submitInternetSplit(req("leader",{
  date:day,staffId:"person",hikari:3,air:2,sourceVersion:3,expectedRevision:0}));
 assert.equal(result.saved,true);assert.equal(result.revision,1);
 assert.deepEqual(db.writes.map(x=>x.path).sort(),[
  "companies/p1/partnerInternetSplitAudits/"+day+"__person__v1",
  "companies/p1/partnerInternetSplits/"+day+"__person"].sort());
 for(const [p,v] of before)assert.deepEqual(db.items.get(p),v,p);
 const d=await ops.viewInternetSplitDay(req("leader",{date:day}));
 assert.equal(d.records[0].verified,true);
 assert.equal(d.records[0].hikari,3);
 assert.equal(d.records[0].air,2);
 assert.equal(d.records[0].unclassified,0);
 assert.doesNotMatch(JSON.stringify(d),/unitPrice|totalRevenue|999999|88000/);
});
test("wrong sums, source versions, input types and stale revisions fail before any write",async()=>{
 const {db,ops,req}=fixture();const original=clone([...db.items]);
 const base={date:day,staffId:"person",hikari:3,air:2,sourceVersion:3,expectedRevision:0};
 const mutations=[
  {hikari:4},{air:3},{hikari:0,air:0},{sourceVersion:2},
  {expectedRevision:1},{hikari:"3"},{air:2.5},{hikari:-1},
  {unexpectedField:"anything"}
 ];
 for(const m of mutations)await assert.rejects(ops.submitInternetSplit(req("leader",{...base,...m})));
 await assert.rejects(ops.submitInternetSplit(req("outsider",{...base})));
 await assert.rejects(ops.submitInternetSplit(req("owner",{...base})));
 assert.deepEqual([...db.items],original);
 assert.deepEqual(db.writes,[]);
});
test("same staff ID at different partner companies never collides; Owner read is authorized",async()=>{
 const {db,ops,req}=fixture();
 await ops.submitInternetSplit(req("leader",{date:day,staffId:"person",
  hikari:1,air:4,sourceVersion:3,expectedRevision:0}));
 const a=await ops.viewInternetSplitDay(req("owner",{date:day,partnerCompanyId:"p1"}));
 const b=await ops.viewInternetSplitDay(req("owner",{date:day,partnerCompanyId:"p2"}));
 assert.equal(a.records[0].verified,true);assert.equal(a.records[0].hikari,1);
 assert.equal(b.records[0].verified,false);assert.equal(b.records[0].unclassified,5);
 await assert.rejects(ops.viewInternetSplitDay(req("leader",{
  date:day,partnerCompanyId:"p2"})));
 await assert.rejects(ops.viewInternetSplitDay(req("owner",{
  date:day,partnerCompanyId:"unknown"})));
 assert.deepEqual(db.writes.map(x=>x.path).filter(p=>p.includes("/p2/")),[]);
});
test("member may classify own archived record but never another staff",async()=>{
 const {db,ops,req}=fixture();
 const pass=await ops.submitInternetSplit(req("person",{date:day,staffId:"person",
  hikari:2,air:3,sourceVersion:3,expectedRevision:0}));
 assert.equal(pass.saved,true);
 db.seed("companies/p1/partnerWorkEntries/"+day+"__other",row("p1","other",5,1));
 await assert.rejects(ops.submitInternetSplit(req("person",{date:day,staffId:"other",
  hikari:2,air:3,sourceVersion:1,expectedRevision:0})));
 const own=await ops.viewInternetSplitDay(req("person",{date:day}));
 assert.equal(own.records.length,1);assert.equal(own.records[0].staffId,"person");
});
test("reclassifying an old 5-count split appends revision history and never changes 5",async()=>{
 const {db,ops,req}=fixture();
 const data={date:day,staffId:"person",hikari:3,air:2,sourceVersion:3,expectedRevision:0};
 await ops.submitInternetSplit(req("leader",data));
 const updated=await ops.submitInternetSplit(req("leader",{
  ...data,hikari:4,air:1,expectedRevision:1}));
 assert.equal(updated.revision,2);
 assert.equal(db.items.get("companies/p1/partnerWorkEntries/"+day+"__person").counts[KEY],5);
 assert.deepEqual(db.writes.map(x=>x.path).filter(p=>p.includes("SplitAudits/")).sort(),[
  "companies/p1/partnerInternetSplitAudits/"+day+"__person__v1",
  "companies/p1/partnerInternetSplitAudits/"+day+"__person__v2"]);
 await assert.rejects(ops.submitInternetSplit(req("leader",{...data})));
 assert.equal((await ops.submitInternetSplit(req("leader",{
  date:day,staffId:"person",hikari:4,air:1,sourceVersion:3,expectedRevision:2}))).unchanged,true);
});
test("editing the source afterwards marks saved split unverified, never silently claiming rank",async()=>{
 const {db,ops,req}=fixture();
 await ops.submitInternetSplit(req("leader",{
  date:day,staffId:"person",hikari:3,air:2,sourceVersion:3,expectedRevision:0}));
 db.seed("companies/p1/partnerWorkEntries/"+day+"__person",row("p1","person",6,4));
 const visible=await ops.viewInternetSplitDay(req("leader",{date:day}));
 assert.equal(visible.records[0].verified,false);
 assert.equal(visible.records[0].unclassified,6);
 assert.equal(visible.records[0].hikari,3);
 await assert.rejects(ops.submitInternetSplit(req("leader",{
  date:day,staffId:"person",hikari:3,air:2,sourceVersion:3,expectedRevision:1})));
 const changed=await ops.submitInternetSplit(req("leader",{
  date:day,staffId:"person",hikari:4,air:2,sourceVersion:4,expectedRevision:1}));
 assert.equal(changed.revision,2);
 assert.equal((await ops.viewInternetSplitDay(req("leader",{date:day}))).records[0].verified,true);
});
test("Owner month separates Hikari, Air, and unclassified without changing the saved five",async()=>{
 const {db,ops,req}=fixture(),initial=clone([...db.items]);
 const before=await ops.viewInternetSplitMonth(req("owner",{
  month:"2026-11",partnerCompanyId:"p1"}));
 assert.equal(before.combinedTotal,5);
 assert.equal(before.verifiedHikari,0);
 assert.equal(before.verifiedAir,0);
 assert.equal(before.unclassified,5);
 assert.equal(before.people.length,1);
 assert.deepEqual([...db.items],initial);
 await ops.submitInternetSplit(req("leader",{date:day,staffId:"person",
  hikari:3,air:2,sourceVersion:3,expectedRevision:0}));
 const after=await ops.viewInternetSplitMonth(req("owner",{
  month:"2026-11",partnerCompanyId:"p1"}));
 assert.equal(after.combinedTotal,5);
 assert.equal(after.verifiedHikari,3);
 assert.equal(after.verifiedAir,2);
 assert.equal(after.unclassified,0);
 assert.equal(after.classifiedRows,1);
 assert.doesNotMatch(JSON.stringify(after),/revenue|unitPrice|cashback|999999|88000/i);
});
test("another historical date remains unclassified until its own exact source is verified",async()=>{
 const {db,ops,req}=fixture();
 db.seed("companies/p1/partnerWorkEntries/2026-11-05__person",{
  ...row("p1","person",4,1),date:"2026-11-05"});
 await ops.submitInternetSplit(req("leader",{date:day,staffId:"person",
  hikari:2,air:3,sourceVersion:3,expectedRevision:0}));
 const d=await ops.viewInternetSplitMonth(req("owner",{
  month:"2026-11",partnerCompanyId:"p1"}));
 assert.equal(d.combinedTotal,9);
 assert.equal(d.verifiedHikari,2);
 assert.equal(d.verifiedAir,3);
 assert.equal(d.unclassified,4);
 assert.equal(d.people[0].combined,9);
 assert.equal(d.people[0].unclassified,4);
 assert.equal(d.sourceRows,2);
 assert.equal(d.classifiedRows,1);
});
test("monthly partner company authorization and date range fail without touching records",async()=>{
 const {db,ops,req}=fixture(),before=clone([...db.items]);
 await assert.rejects(ops.viewInternetSplitMonth(req("owner",{
  month:"2026-11",partnerCompanyId:"not-hub"})));
 await assert.rejects(ops.viewInternetSplitMonth(req("leader",{
  month:"2026-11",partnerCompanyId:"p2"})));
 await assert.rejects(ops.viewInternetSplitMonth(req("owner",{
  month:"2030-01",partnerCompanyId:"p1"})));
 assert.deepEqual([...db.items],before);
 assert.equal(db.writes.length,0);
});
test("consumer count UI keeps original legacy save; new editor enforces the exact sum and account reset",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const service=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/service.cjs"),"utf8");
 const callable=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/index.js"),"utf8");
 for(const id of ["pInlineInternetCard","pInlineInternetHikari","pInlineInternetAir",
  "pInlineInternetSave","pInlineInternetStatus","pInlineInternetRefresh"]){
  assert.equal(html.split('id="'+id+'"').length-1,1,id);
 }
 assert.match(html,/pInline\("pInlineSave"\)\.onclick=\(\)=>partnerInlineRun/);
 assert.match(html,/pInline\("pInlineInternetSave"\)\.onclick=async/);
 assert.match(html,/h\+a===total/);
 assert.match(html,/partnerInternetData=null;partnerInternetBusy=false/);
 assert.match(html,/pInline\("pInlineInternetSave"\)\.disabled=true/);
 assert.match(html,/void partnerInternetFetch\(\)/);
 assert.match(service,/makePartnerInternetSplitOperations/);
 assert.match(callable,/exports\.getPartnerInternetSplitDay=onCall/);
 assert.match(callable,/getPartnerInternetSplitMonth=onCall/);
 assert.match(html,/loadOwnerPartnerInternetMonth\(companyId,month,uid,seq,data\.counts\["SB光・AIR"\]\)/);
 assert.match(callable,/exports\.submitPartnerInternetSplit=onCall/);
 assert.doesNotMatch(html.slice(html.indexOf("function partnerInternetRender(){"),
  html.indexOf('pInline("pInlineAddTeam").onclick=')),/\b(?:setDoc|updateDoc|deleteDoc|getDocs|getDoc|onSnapshot)\s*\(/);
});
test("classification documents have no direct Firestore client Rules path",()=>{
 const rules=fs.readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
 assert.doesNotMatch(rules,/match\s+\/partnerInternetSplits(?:\/|\s)/);
 assert.doesNotMatch(rules,/match\s+\/partnerInternetSplitAudits(?:\/|\s)/);
 assert.doesNotMatch(rules,/match\s+\/companies\/\{companyId\}\/\{document=\*\*\}/);
});
test("client-side JS remains syntactically valid and no live Firebase is contacted",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const script=html.match(/<script\s+type="module"[^>]*>([\s\S]*?)<\/script>/);
 assert(script&&script[1].length>10000);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nico-internet-split-syntax-"));
 try{
  const p=path.join(dir,"index.mjs");fs.writeFileSync(p,script[1]);
  const result=cp.spawnSync(process.execPath,["--check",p],{encoding:"utf8",timeout:15000});
  assert.equal(result.status,0,result.stderr?.slice(0,1200));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
