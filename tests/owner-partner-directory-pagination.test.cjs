"use strict";
// Isolated synthetic 100+ company pagination. No production credentials/reads.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {makeOwnerPartnerCorrections}=
 require("../functions-partner-workspace/owner-partner-count-operations.cjs");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const dup=x=>structuredClone(x);
class DocRef{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 async get(){const data=this.db.rows.get(this.path);
  return {id:this.id,exists:data!==undefined,data:()=>data===undefined?undefined:dup(data)};}
 collection(c){return new Collection(this.db,this.path+"/"+c);}
}
class Query{
 constructor(db,path,parts={}){this.db=db;this.path=path;this.parts=parts;}
 where(field,operator,value){
  assert.equal(field,"hubCompanyId");assert.equal(operator,"==");
  return new Query(this.db,this.path,{...this.parts,hub:value});
 }
 orderBy(field){
  assert.equal(field,"__name__");
  return new Query(this.db,this.path,{...this.parts,ordered:true});
 }
 startAfter(cursor){
  assert.equal(this.parts.ordered,true);
  return new Query(this.db,this.path,{...this.parts,cursor});
 }
 limit(n){
  assert.equal(n,26);
  const {db,path,parts}=this;
  return {get:async()=>{
   const prefix=path+"/";
   const entries=[...db.rows.entries()].filter(([key,v])=>
    key.startsWith(prefix)&&!key.slice(prefix.length).includes("/")&&
    v.hubCompanyId===parts.hub&&
    (!parts.cursor||key.slice(prefix.length)>parts.cursor))
    .sort((a,b)=>a[0].localeCompare(b[0],"en")).slice(0,n);
   const docs=entries.map(([key,data])=>({
    id:key.slice(prefix.length),data:()=>dup(data)}));
   return {size:docs.length,docs};
  }};
 }
}
class Collection extends Query{
 constructor(db,path){super(db,path);}
 doc(id){return new DocRef(this.db,this.path+"/"+id);}
}
function setup(total=123){
 const db={rows:new Map(),writes:[]};
 db.collection=n=>new Collection(db,n);
 db.seed=(p,v)=>db.rows.set(p,dup(v));
 const make=(i,hub,active=true)=>{
  const id="partner_"+String(i).padStart(4,"0");
  db.seed("partnerRelations/"+id,{
   partnerCompanyId:id,hubCompanyId:hub,active,countSharingApproved:active,
   // Sensitive fields may be present in raw database: must never be returned.
   internalContactEmail:"hidden@example.jp",revenue:98000
  });
  db.seed("companies/"+id,{
   companyKind:"partner",hubCompanyId:hub,active,name:"協力店 "+i,
   unitPrice:12345,clientSecret:"hidden"
  });
 };
 for(let i=1;i<=total;i++)make(i,"hub",i%9!==0);
 for(let i=1000;i<1008;i++)make(i,"foreign");
 const fail=c=>{const e=Error(c||"permission-denied");e.code=c||"permission-denied";throw e;};
 const ops=makeOwnerPartnerCorrections({
  db,actor:async r=>({uid:r.auth.uid}),
  scope:async uid=>uid==="owner"?{kind:"hub",cid:"hub",role:"owner"}:
   uid==="foreign_owner"?{kind:"hub",cid:"foreign",role:"owner"}:
   {kind:"partner",cid:"partner_0001",role:"leader"},
  collection:(cid,n)=>db.collection("companies").doc(cid).collection(n),
  FieldValue:{serverTimestamp:()=>1},fail,
  validDate:x=>x,validateCounts:()=>({counts:{},total:0}),
  validatePrivateCounts:()=>({counts:{},total:0}),KEYS,
  legacyPolicyFor:async()=>({mode:"legacy",blockedCategories:[]}),
  assertLegacyEdit:()=>true
 });
 const req=(uid,data)=>({auth:{uid},data});
 return {db,ops,req};
}
test("123 partners paginate into exactly five bounded pages with no missing or repeated IDs",async()=>{
 const {db,ops,req}=setup();
 const before=dup([...db.rows]);
 let cursor="",pages=0,all=[],response;
 do{
  response=await ops.listCompaniesPage(req("owner",{cursor}));
  pages++;
  assert.equal(response.scope,"hub_owner_partner_directory_counts_only");
  assert.equal(response.financialFieldsIncluded,false);
  assert.equal(response.productionDocumentWrites,0);
  assert.equal(response.pageSize,25);
  assert(response.companies.length<=25);
  assert(response.companies.every(c=>c.partnerCompanyId.startsWith("partner_")));
  all.push(...response.companies);
  if(response.hasMore){
   assert.equal(response.nextCursor,response.companies.at(-1).partnerCompanyId);
   assert(response.nextCursor>cursor);
   cursor=response.nextCursor;
  }
 }while(response.hasMore);
 assert.equal(pages,5);
 assert.deepEqual([25,25,25,25,23],Array.from({length:pages},(_,i)=>
  all.slice(i*25,(i+1)*25).length));
 assert.equal(all.length,123);
 assert.equal(new Set(all.map(x=>x.partnerCompanyId)).size,123);
 assert.equal(all.filter(x=>!x.approved).length,Math.floor(123/9));
 assert.equal(response.nextCursor,null);
 assert.doesNotMatch(JSON.stringify(all),/unitPrice|clientSecret|internalContactEmail|98000|12345/);
 assert.deepEqual([...db.rows],before);
 assert.deepEqual(db.writes,[]);
});
test("Directory cannot enumerate another hub's companies and unauthorized member is denied",async()=>{
 const {db,ops,req}=setup();
 const home=await ops.listCompaniesPage(req("owner",{}));
 const foreign=await ops.listCompaniesPage(req("foreign_owner",{}));
 assert(home.companies.every(x=>Number(x.partnerCompanyId.slice(-4))<1000));
 assert(foreign.companies.every(x=>Number(x.partnerCompanyId.slice(-4))>=1000));
 await assert.rejects(ops.listCompaniesPage(req("member",{})));
 db.seed("partnerWorkspaceContexts/owner",{kind:"partner_secondary",active:true});
 await assert.rejects(ops.listCompaniesPage(req("owner",{})));
 assert.equal(db.writes.length,0);
});
test("Input/cursor invalid or inconsistent company metadata fails closed",async()=>{
 const {db,ops,req}=setup();
 for(const payload of [{cursor:"../other"},{cursor:123},{cursor:"a",extra:true},
  {cursor:{id:"partner_0001"}}]){
  await assert.rejects(ops.listCompaniesPage(req("owner",payload)));
 }
 const key="partnerRelations/partner_0003";
 db.seed(key,{...db.rows.get(key),partnerCompanyId:"different"});
 await assert.rejects(ops.listCompaniesPage(req("owner",{cursor:""})));
 assert.equal(db.writes.length,0);
});
test("UI shows Owner company search and pagination without partner account impersonation",()=>{
 const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
 const index=fs.readFileSync(path.join(__dirname,"..","functions-partner-workspace","index.js"),"utf8");
 const service=fs.readFileSync(path.join(__dirname,"..","functions-partner-workspace","service.cjs"),"utf8");
 for(const id of ["ownerPartnerDirectory","ownerPartnerDirectoryFilter","ownerPartnerDirectoryStatus",
  "ownerPartnerDirectoryRows","ownerPartnerDirectoryNext"]){
  assert.equal(html.split('id="'+id+'"').length-1,1,id);
 }
 assert.match(html,/async function ownerDirFetch\(reset=false\)/);
 assert.match(html,/void ownerDirFetch\(true\)/);
 assert.match(html,/void openOwnerPartnerProxy\(company\.partnerCompanyId,company\.name\)/);
 assert.match(html,/function resetPartnerInline\(\)\{\n ownerCatalogReset\(\);\n ownerProxyReset\(\);/);
 assert.match(index,/exports\.getOwnerPartnerCompaniesPage=onCall\(opts,service\.ownerPartnerCompaniesPage\)/);
 assert.match(service,/listCompaniesPage:ownerPartnerCompaniesPage/);
 const section=html.slice(html.indexOf("function ownerDirReset(){"),
   html.indexOf("async function openOwnerSplitEditor("));
 assert.doesNotMatch(section,/\b(?:signOut|signIn|setDoc|updateDoc|deleteDoc)\s*\(/);
});
