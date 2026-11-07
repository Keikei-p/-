"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {makeOwnerPartnerDirectory}=
 require("../staging/partner-owner-directory-125/directory.cjs");
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
class FakeDB{
 constructor(number=150){
  this.relations=new Map();this.companies=new Map();
  this.queries=0;this.companyReads=0;this.writes=0;
  for(let n=0;n<number;n++){
   const id="p"+String(n).padStart(4,"0");
   this.relations.set(id,{partnerCompanyId:id,hubCompanyId:"hub",active:true,
    countSharingApproved:true,unitPrice:999999,ownerEmail:"private@example.com"});
   this.companies.set(id,{companyKind:"partner",hubCompanyId:"hub",
    name:"協力店"+n,active:true,unitPrice:777777,
    totalRevenue:900000,ownerEmail:"secret@example.com"});
  }
  this.relations.set("outside",{partnerCompanyId:"outside",
   hubCompanyId:"elsewhere",active:true,countSharingApproved:true});
 }
 collection(name){
  if(name==="partnerRelations"){
   let hub=null,sort=null,cursor=null,limit=0;
   const q={
    where:(field,op,value)=>{
     assert.equal(field,"hubCompanyId");assert.equal(op,"==");
     hub=value;return q;
    },
    orderBy:(name)=>{assert.equal(name,"__name__");sort=name;return q;},
    startAfter:value=>{cursor=value;return q;},
    limit:n=>{assert.equal(n,26);limit=n;return q;},
    get:async()=>{
     assert.equal(hub,"hub");assert.equal(sort,"__name__");
     assert.equal(limit,26);this.queries++;
     const docs=[...this.relations].filter(([id,v])=>
      v.hubCompanyId===hub&&(!cursor||id>cursor))
      .sort((a,b)=>a[0].localeCompare(b[0])).slice(0,limit)
      .map(([id,data])=>({id,data:()=>structuredClone(data)}));
     return {size:docs.length,docs};
    }
   };return q;
  }
  if(name==="companies")return {doc:id=>({
   get:async()=>{
    this.companyReads++;
    const row=this.companies.get(id);
    return {exists:!!row,data:()=>structuredClone(row)};
   }
  })};
  throw Error("FORBIDDEN_COLLECTION:"+name);
 }
}
const getService=db=>makeOwnerPartnerDirectory({db,HttpsError,
 verifyHubOwner:async(request)=>request?.auth?.uid==="owner"?
  {serverVerified:true,kind:"hub",role:"owner",uid:"owner",hubId:"hub"}:
  {serverVerified:true,kind:"partner",role:"owner",uid:"other",hubId:"hub"}
});
const req=(uid="owner",cursor)=>({auth:{uid},data:cursor?{cursor}:{}});
test("150 company directory is read in 25-company pages with no duplicates and no financial data",async()=>{
 const db=new FakeDB(150),service=getService(db),ids=new Set();
 let cursor=null;const sizes=[];
 do{
  const d=await service.list(req("owner",cursor));
  sizes.push(d.companies.length);
  assert.equal(d.scope,"hub_owner_partner_directory_staging_counts_only");
  assert.equal(d.completeNetworkSnapshot,false);
  assert.equal(d.financialFieldsIncluded,false);
  assert.equal(d.productionDocumentWrites,0);
  assert.equal(d.pageSize,25);
  for(const company of d.companies){
   assert.equal(ids.has(company.partnerCompanyId),false);
   ids.add(company.partnerCompanyId);
   assert.equal(company.countSharingApproved,true);
  }
  assert.doesNotMatch(JSON.stringify(d),
   /totalRevenue|unitPrice|ownerEmail|secret@example|private@example|777777|999999/);
  cursor=d.nextCursor;
 }while(cursor);
 assert.equal(ids.size,150);
 assert.deepEqual(sizes,[25,25,25,25,25,25]);
 assert.equal(db.queries,6);
 assert.equal(db.companyReads,150);
 assert.equal(db.writes,0);
});
test("123 companies paginate 25/25/25/25/23 and preserve approvals",async()=>{
 const db=new FakeDB(123),ops=getService(db);
 db.relations.get("p0040").countSharingApproved=false;
 db.companies.get("p0050").active=false;
 let cursor=null,all=[];
 do{
  const d=await ops.list(req("owner",cursor));
  all.push(...d.companies);
  cursor=d.nextCursor;
 }while(cursor);
 assert.equal(all.length,123);
 assert.equal(db.queries,5);
 assert.equal(all.find(x=>x.partnerCompanyId==="p0040").countSharingApproved,false);
 assert.equal(all.find(x=>x.partnerCompanyId==="p0050").active,false);
 assert.equal(all.find(x=>x.partnerCompanyId==="p0050").countSharingApproved,false);
 assert.equal(all[122].partnerCompanyId,"p0122");
});
test("only server verified internal Owner can call, with no DB access on failure",async()=>{
 const db=new FakeDB(),ops=getService(db);
 for(const input of [
  req("partner"),{auth:{uid:"unknown"},data:{}},
  {auth:{uid:"owner"},data:{hubCompanyId:"evil"}},
  {auth:{uid:"owner"},data:{cursor:"../../records"}},
  {auth:{uid:"owner"},data:{cursor:"wrong",limit:1000}},
  {auth:{uid:"owner"},data:{cursor:123}},
  {auth:{uid:"owner"},data:[]}
 ]){
  await assert.rejects(ops.list(input));
 }
 assert.equal(db.queries,0);assert.equal(db.companyReads,0);
});
test("cross-hub relations stay hidden even if cursor targets their IDs",async()=>{
 const db=new FakeDB(1),ops=getService(db);
 const data=await ops.list(req());
 assert.equal(data.companies.length,1);
 assert.equal(data.companies[0].partnerCompanyId,"p0000");
 assert(!JSON.stringify(data).includes("outside"));
 assert.equal(db.companyReads,1);
});
test("malformed relation, company tenancy or monetary company name fails closed",async()=>{
 for(const mutate of [
  db=>{db.relations.get("p0000").partnerCompanyId="wrong";},
  db=>{db.companies.get("p0000").hubCompanyId="other";},
  db=>{db.companies.get("p0000").companyKind="internal";},
  db=>{db.companies.get("p0000").name="会社 売上100万円";},
  db=>{db.companies.delete("p0000");}
 ]){
  const db=new FakeDB(1);mutate(db);
  const before=JSON.stringify({relations:[...db.relations],companies:[...db.companies]});
  await assert.rejects(getService(db).list(req()));
  assert.equal(JSON.stringify({relations:[...db.relations],companies:[...db.companies]}),before);
  assert.equal(db.writes,0);
 }
});
test("directory remains strictly STAGING-only without production callable export",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const source=fs.readFileSync(path.join(__dirname,
  "../staging/partner-owner-directory-125/directory.cjs"),"utf8");
 const deployed=fs.readFileSync(path.join(__dirname,
  "../functions-partner-workspace/index.js"),"utf8");
 assert.match(source,/STAGING ONLY \/ NO DEPLOY/);
 assert.doesNotMatch(deployed,/partner-owner-directory-125|makeOwnerPartnerDirectory/);
 assert.doesNotMatch(source,/\b(?:set|update|create|delete|runTransaction)\s*\(/);
});
