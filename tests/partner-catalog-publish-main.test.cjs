"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {makePartnerCatalogOperations}=require("../functions-partner-workspace/partner-catalog-operations.cjs");
class Ref{
 constructor(db,id){this.db=db;this.path=id;this.id=id.split("/").at(-1);}
 collection(id){return new Query(this.db,this.path+"/"+id);}
 async get(){const v=this.db.data.get(this.path);
  return {id:this.id,exists:v!==undefined,data:()=>v===undefined?undefined:structuredClone(v)};}
}
class Query{
 constructor(db,path,filters=[],limitN=Infinity){this.db=db;this.path=path;this.filters=filters;this.limitN=limitN;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 where(key,op,value){return new Query(this.db,this.path,[...this.filters,[key,op,value]],this.limitN);}
 limit(n){return new Query(this.db,this.path,this.filters,n);}
 async get(){const all=[...this.db.data].filter(([id,v])=>
   id.startsWith(this.path+"/")&&!id.slice(this.path.length+1).includes("/")&&
   this.filters.every(([k,op,x])=>op==="=="?v[k]===x:false));
  return {size:Math.min(all.length,this.limitN),
   docs:all.slice(0,this.limitN).map(([id,v])=>({id:id.split("/").at(-1),
    data:()=>structuredClone(v)}))};}
}
class DB{
 constructor(){this.data=new Map();this.writes=[];}
 collection(id){return new Query(this,id);}
 put(path,value){this.data.set(path,structuredClone(value));}
 async runTransaction(callback){
  const changes=[];
  const tx={get:ref=>ref.get(),set:(ref,value)=>changes.push([ref.path,structuredClone(value)])};
  const output=await callback(tx);
  for(const [p,v] of changes){this.put(p,v);this.writes.push(p);}
  return output;
 }
}
class CallError extends Error{constructor(code){super(code);this.code=code;}}
function seed(){
 const db=new DB();
 db.put("products/nuro",{companyId:"hub",name:"NURO光",active:true,
  sortOrder:1,unitPrice:99999,price:80000,revenue:777777,
  cashbackOptions:[10000,20000]});
 db.put("products/new",{companyId:"hub",name:"追加商材X",active:true,
  sortOrder:2,unitPrice:33333,revenue:222222});
 db.put("products/retired",{companyId:"hub",name:"旧商材",active:false,
  sortOrder:3,unitPrice:11111});
 db.put("products/other",{companyId:"foreign",name:"他社秘密",active:true,
  price:8888});
 const scope=async(uid)=>uid==="owner"?{kind:"hub",cid:"hub",role:"owner"}:
  uid==="leader"?{kind:"hub",cid:"hub",role:"member"}:
  uid==="partner"?{kind:"partner",cid:"p",hubId:"hub",role:"leader"}:
  uid==="member"?{kind:"partner",cid:"p",hubId:"hub",role:"member"}:
  {kind:"partner",cid:"foreign",hubId:"foreign",role:"owner"};
 const impl=makePartnerCatalogOperations({
  db,actor:async req=>({uid:req.auth.uid}),
  scope,collection:(company,name)=>db.collection("companies").doc(company).collection(name),
  FieldValue:{serverTimestamp:()=>({timestamp:true})},
  fail:code=>{throw new CallError(code||"permission-denied");}
 });
 const request=(uid,data={})=>({auth:{uid},data});
 return {db,impl,request};
}
test("original product secrets never leave the independently published catalog",async()=>{
 const {db,impl,request}=seed();
 const before=JSON.stringify([...db.data]);
 const owner=await impl.getPublishedCatalog(request("owner"));
 const partner=await impl.getPublishedCatalog(request("partner"));
 assert.deepEqual(owner.products.map(p=>p.name),["NURO光","追加商材X","旧商材"]);
 assert.equal(owner.products.every(p=>p.published===false),true);
 assert.deepEqual(partner.products,[]);
 assert.equal(owner.revision,0);
 assert.doesNotMatch(JSON.stringify(owner),/unitPrice|cashback|revenue|99999|777777|33333|222222|price/);
 assert.equal(JSON.stringify([...db.data]),before);
});
test("Owner ON/OFF updates only publication settings, including newly added products",async()=>{
 const {db,impl,request}=seed();const original=structuredClone([...db.data]);
 const first=await impl.setPublishedProduct(request("owner",{
  productId:"new",published:true,expectedRevision:0}));
 assert.equal(first.revision,1);
 let published=await impl.getPublishedCatalog(request("partner"));
 assert.deepEqual(published.products.map(p=>p.name),["追加商材X"]);
 assert.equal(Object.hasOwn(published.products[0],"unitPrice"),false);
 await impl.setPublishedProduct(request("owner",{
  productId:"nuro",published:true,expectedRevision:1}));
 published=await impl.getPublishedCatalog(request("partner"));
 assert.deepEqual(published.products.map(p=>p.name),["NURO光","追加商材X"]);
 await impl.setPublishedProduct(request("owner",{
  productId:"new",published:false,expectedRevision:2}));
 published=await impl.getPublishedCatalog(request("partner"));
 assert.deepEqual(published.products.map(p=>p.name),["NURO光"]);
 const owner=await impl.getPublishedCatalog(request("owner"));
 assert.equal(owner.products.find(p=>p.id==="new").published,false);
 assert.deepEqual(db.writes,[
  "companies/hub/partnerCatalogSettings/publication",
  "companies/hub/partnerCatalogSettings/publication",
  "companies/hub/partnerCatalogSettings/publication"
 ]);
 for(const [path,doc] of original)assert.deepEqual(db.data.get(path),doc,path);
});
test("partner, non-Owner, foreign company, stale revision and inactive ON are refused",async()=>{
 const {db,impl,request}=seed();
 const denied=[
  ["partner",{productId:"new",published:true,expectedRevision:0}],
  ["member",{productId:"new",published:true,expectedRevision:0}],
  ["leader",{productId:"new",published:true,expectedRevision:0}],
  ["owner",{productId:"other",published:true,expectedRevision:0}],
  ["owner",{productId:"retired",published:true,expectedRevision:0}],
  ["owner",{productId:"new",published:true,expectedRevision:2}],
  ["owner",{productId:"__proto__",published:true,expectedRevision:0}],
  ["owner",{productId:"new",published:"true",expectedRevision:0}],
  ["owner",{productId:"new",published:true,expectedRevision:0,workspaceCompanyId:"p"}]
 ];
 for(const [who,data] of denied)
  await assert.rejects(impl.setPublishedProduct(request(who,data)));
 assert.deepEqual(db.writes,[]);
 await assert.rejects(impl.getPublishedCatalog(request("partner",{partnerCompanyId:"foreign"})),
  e=>e.code==="invalid-argument");
});
test("retired product can be switched OFF without rewriting its history",async()=>{
 const {db,impl,request}=seed();
 db.put("companies/hub/partnerCatalogSettings/publication",{
  revision:1,productIds:["retired","new"]
 });
 await impl.setPublishedProduct(request("owner",{
  productId:"retired",published:false,expectedRevision:1}));
 const owner=await impl.getPublishedCatalog(request("owner"));
 assert.equal(owner.products.find(p=>p.id==="retired").published,false);
 assert.deepEqual((await impl.getPublishedCatalog(request("partner"))).products.map(x=>x.name),
  ["追加商材X"]);
 assert.deepEqual(db.writes,["companies/hub/partnerCatalogSettings/publication"]);
});
