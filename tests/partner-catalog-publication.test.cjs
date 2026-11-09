"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const catalog=require("../functions-partner-workspace/catalog-publication.cjs");

test("empty publication is private by default and cannot leak the price-bearing master",()=>{
 const m=[{id:"nuro",name:"NURO",sortOrder:2,companyId:"hub",revenue:999999,
  pricingOptions:[{cashback:20000,revenuePerUnit:333333}]}];
 const s=catalog.loadPublication(null);
 assert.deepEqual(s,{revision:0,productIds:[]});
 assert.deepEqual(catalog.projectMasterProducts(m,s.productIds,true),[]);
 const listed=catalog.projectMasterProducts(m,["nuro"],true);
 assert.deepEqual(listed,[{id:"nuro",name:"NURO",sortOrder:2,published:true}]);
 const text=JSON.stringify(listed);
 assert.doesNotMatch(text,/999999|333333|revenue|pricingOptions|cashback|companyId/);
});

test("only explicitly published active ID is sent; original ordering retained",()=>{
 const products=[{id:"A",name:"SBMNP",sortOrder:2},
  {id:"B",name:"YMMNP",sortOrder:1},{id:"C",name:"U-NEXT",active:false,sortOrder:0}];
 assert.deepEqual(catalog.projectMasterProducts(products,["A","C"],true).map(p=>p.id),["A"]);
 assert.deepEqual(catalog.projectMasterProducts(products,["A","C"],false).map(p=>p.id),["B","A"]);
});

test("one-item toggle uses revision and never accepts stale writes",()=>{
 const first=catalog.changePublication(null,"NURO",true,0);
 assert.deepEqual(first,{revision:1,productIds:["NURO"]});
 assert.deepEqual(catalog.changePublication(first,"SBMNP",true,1),{
  revision:2,productIds:["NURO","SBMNP"]
 });
 assert.throws(()=>catalog.changePublication(first,"YMMNP",true,0),/INVALID/);
 assert.deepEqual(catalog.changePublication(first,"NURO",false,1),
  {revision:2,productIds:[]});
});

test("reject duplicate, malformed and price-bearing public material",()=>{
 assert.throws(()=>catalog.loadPublication({revision:1,productIds:["NURO","NURO"]}),/INVALID/);
 assert.throws(()=>catalog.projectMasterProducts([{id:"A",name:"NURO 売上 35万円"}],["A"],true),/INVALID/);
 assert.throws(()=>catalog.projectMasterProducts([{id:"A",name:"単価¥90000"}],["A"],true),/INVALID/);
 assert.throws(()=>catalog.changePublication(null,"__proto__",true,0),/INVALID/);
 assert.throws(()=>catalog.changePublication(null,"A","true",0),/INVALID/);
});

test("production integration is isolated and no legacy sales write is introduced",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const functions=fs.readFileSync(require.resolve("../functions-partner-workspace/index.js"),"utf8");
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 assert.match(service,/async function setCatalogPublication\(/);
 assert.match(service,/if\(s\.kind!=="hub"\|\|s\.role!=="owner"/);
 assert.match(service,/db\.collection\("products"\)\.doc\(d\.productId\)/);
 assert.match(service,/tx\.set\(stateRef,\{/);
 assert.doesNotMatch(service.slice(service.indexOf("async function setCatalogPublication("),
  service.indexOf(" const checkTeam=async")),/tx\.(?:set|update|delete)\((?:productRef|productDoc)/);
 assert.match(functions,/exports\.getPartnerCatalog=onCall/);
 assert.match(functions,/exports\.setPartnerCatalogPublication=onCall/);
 assert.match(html,/id="partnerCatalogPublicationStatus"/);
 assert.match(html,/async function changeCatalogPublication\(/);
 assert.match(html,/getPartnerCatalog/);
 assert.match(html,/協力店に公開/);
});


test("hub Owner can see retired/unsafe product toggle state, but partner gets no hidden or price data",()=>{
 const products=[
  {id:"retired",name:"販売終了商材",active:false,sortOrder:3,revenue:50000},
  {id:"unsafe",name:"単価9万円",active:true,sortOrder:2,pricingOptions:[{revenuePerUnit:90000}]},
  {id:"active",name:"NURO光",active:true,sortOrder:1,revenuePerUnit:77000}
 ];
 const state=["retired","unsafe","active"];
 const owner=catalog.projectOwnerPublicationRows(products,state);
 assert.deepEqual(owner.map(x=>x.id),["active","unsafe","retired"]);
 assert(owner.every(x=>x.published===true));
 assert.equal(owner.find(x=>x.id==="unsafe").name,"公開不可の商材");
 assert.doesNotMatch(JSON.stringify(owner),/revenue|unitPrice|pricingOptions|90000|77000|50000/);
 assert.deepEqual(catalog.projectMasterProducts([products[0],products[2]],state,true)
  .map(x=>x.id),["active"]);
 assert.throws(()=>catalog.projectMasterProducts(products,state,true),/INVALID/);
 assert.deepEqual(catalog.projectOwnerPublicationRows(products,[]).map(x=>x.published),
  [false,false,false]);
});


test("retired publication OFF is permitted but unsafe ON is blocked in transaction",()=>{
 const service=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 const start=service.indexOf("async function setCatalogPublication(");
 const end=service.indexOf(" // Share the original group editor",start);
 assert(start>=0&&end>start);
 const code=service.slice(start,end);
 assert.match(code,/fresh\.kind!=="hub"\|\|fresh\.role!=="owner"/);
 assert.match(code,/\(d\.published&&product\.active===false\)/);
 assert.match(code,/if\(d\.published\)\s*\{\s*try\{nameOnly\(product\.name\)/);
 assert.match(code,/tx\.get\(productRef\)/);
 assert.match(code,/tx\.get\(stateRef\)/);
 assert.doesNotMatch(code,/tx\.(?:set|update|delete)\((?:productRef|productDoc)/);
});
