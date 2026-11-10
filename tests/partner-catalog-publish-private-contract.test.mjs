import test from "node:test";
import assert from "node:assert/strict";
import {validateHubPublication,projectPublishedProducts,validatePrivateProduct,
 projectCountAudience,projectPersonalRankings} from "../partner/catalog-publish-private-contract.mjs";
const owner={serverVerified:true,companyId:"hub",companyRole:"owner"};
const partner={serverVerified:true,companyId:"p",companyKind:"partner",role:"owner"};
const catalog=[
 {id:"nuro",companyId:"hub",name:"NURO光",active:true,price:9999,
  pricingOptions:[{cashback:5000,revenuePerUnit:10000}]},
 {id:"electric",companyId:"hub",name:"エバーグリーン",active:true,revenue:20000},
 {id:"water",companyId:"hub",name:"ウォーター",active:false,unitPrice:9999}
];
test("Only real owner can choose global/per-partner existing catalog IDs",()=>{
 const all=validateHubPublication({actor:owner,hubCompanyId:"hub",productIds:["nuro"]});
 assert.equal(all.scope,"all_partners");
 const one=validateHubPublication({actor:owner,hubCompanyId:"hub",
  partnerCompanyId:"p",productIds:["electric"]});
 assert.equal(one.scope,"one_partner");
 assert.throws(()=>validateHubPublication({actor:{...owner,companyRole:"leader"},
  hubCompanyId:"hub",productIds:["nuro"]}),/ACTOR_NOT_OWNER/);
 assert.throws(()=>validateHubPublication({actor:owner,hubCompanyId:"hub",
  productIds:["nuro","nuro"]}),/PUBLICATION_IDS/);
});
test("Published hub catalog drops all finance and disabled products",()=>{
 const before=JSON.stringify(catalog);
 const rows=projectPublishedProducts({hubCompanyId:"hub",partnerCompanyId:"p",
  productMaster:catalog,globalIds:["nuro","electric","water"],partnerIds:["nuro","electric"]});
 assert.deepEqual(rows,[
  {catalogId:"shared:hub:nuro",canonicalProductId:"nuro",name:"NURO光",origin:"hub"},
  {catalogId:"shared:hub:electric",canonicalProductId:"electric",name:"エバーグリーン",origin:"hub"}
 ]);
 assert.equal(JSON.stringify(catalog),before);
 assert(!/price|revenue|cashback|9999|20000/i.test(JSON.stringify(rows)));
 const none=projectPublishedProducts({hubCompanyId:"hub",partnerCompanyId:"p",
   productMaster:catalog,globalIds:[],partnerIds:[]});
 assert.deepEqual(none,[]);
 // Global OFF wins even if the partner override still contains that SKU.
 const globalOff=projectPublishedProducts({hubCompanyId:"hub",partnerCompanyId:"p",
   productMaster:catalog,globalIds:["nuro"],partnerIds:["electric"]});
 assert.deepEqual(globalOff,[]);
 // Missing override inherits global ON, but explicit empty override is OFF.
 const inherited=projectPublishedProducts({hubCompanyId:"hub",partnerCompanyId:"p",
   productMaster:catalog,globalIds:["nuro"]});
 assert.deepEqual(inherited,[rows[0]]);
 const partnerOff=projectPublishedProducts({hubCompanyId:"hub",partnerCompanyId:"p",
   productMaster:catalog,globalIds:["nuro"],partnerIds:[]});
 assert.deepEqual(partnerOff,[]);
 assert.equal(JSON.stringify(catalog),before);
});
test("Partner custom product is always private; rejected for nonowners and money fields",()=>{
 const row=validatePrivateProduct({actor:partner,partnerCompanyId:"p",
  productId:"service",productName:"協力店のみの商品"});
 assert.deepEqual(row,{companyId:"p",productId:"service",name:"協力店のみの商品",
  origin:"partner_custom",visibility:"private",active:true});
 assert.throws(()=>validatePrivateProduct({actor:{...partner,role:"leader"},
  partnerCompanyId:"p",productId:"service",productName:"テスト"}),/PARTNER_OWNER_ONLY/);
 assert.throws(()=>validatePrivateProduct({actor:partner,partnerCompanyId:"p",
  productId:"service",productName:"1件10000円"}),/PRODUCT_NAME/);
});
test("Hub sees only shared categories, no partner private or inferred grand total",()=>{
 const lines=[
  {entryId:"a",companyId:"p",productId:"nuro",count:3},
  {entryId:"b",companyId:"p",productId:"service",count:7}
 ];
 const scoped={partnerCompanyId:"p",hubCompanyId:"hub",
  publishedIds:["nuro"],partnerLocalIds:["service"],lines};
 const hub=projectCountAudience({audience:"hub",...scoped});
 const own=projectCountAudience({audience:"partner",...scoped});
 assert.deepEqual(hub,{counts:[{productId:"nuro",count:3}],totalCount:3});
 assert.deepEqual(own,{counts:[{productId:"nuro",count:3},{productId:"service",count:7}],totalCount:10});
 assert.equal(JSON.stringify(hub).includes("service"),false);
 assert.equal(JSON.stringify(hub).includes("7"),false);
 assert.throws(()=>projectCountAudience({audience:"hub",...scoped,
   lines:[...lines,{...lines[0]}]}),/DUPLICATE_ENTRY/);
 assert.throws(()=>projectCountAudience({audience:"hub",...scoped,
   publishedIds:["service"]}),/OVERLAPPING_IDENTITIES/);
});
test("Combined personal ranking reveals only order, name and affiliation",()=>{
 const r=projectPersonalRankings([
  {personId:"a",companyId:"hub",name:"直営A",affiliation:"1班",sharedCount:3,
   totalRevenue:100000},
  {personId:"b",companyId:"p",name:"協力店B",affiliation:"協力店A",sharedCount:4,
   privateCount:20},
  {personId:"c",companyId:"p",name:"協力店C",affiliation:"協力店A",sharedCount:4}
 ]);
 assert.deepEqual(r,[
  {rank:1,name:"協力店B",affiliation:"協力店A"},
  {rank:1,name:"協力店C",affiliation:"協力店A"},
  {rank:3,name:"直営A",affiliation:"1班"}
 ]);
 assert(!/revenue|Count|total|price/i.test(JSON.stringify(r)));
 assert.throws(()=>projectPersonalRankings([
  {personId:"a",companyId:"p",name:"A",affiliation:"P",sharedCount:3},
  {personId:"a",companyId:"p",name:"A",affiliation:"P",sharedCount:3}
 ]),/DUPLICATE_PERSON/);
});

test("Unicode/fullwidth finance labels cannot leak through any count-only public name",()=>{
 const forbidden=["NURO ＣＢ５０００","NURO CB5000","協力店 キャッシュバック",
  "担当者 ５万円","NURO cash back 5000"];
 for(const label of forbidden){
  assert.throws(()=>projectPublishedProducts({
   hubCompanyId:"hub",partnerCompanyId:"p",
   productMaster:[{id:"nuro",companyId:"hub",name:label,active:true}],
   globalIds:["nuro"]
  }),/PRODUCT_NAME/,label);
  assert.throws(()=>validatePrivateProduct({
   actor:partner,partnerCompanyId:"p",productId:"service",productName:label
  }),/PRODUCT_NAME/,label);
  for(const field of ["name","affiliation"]){
   const row={personId:"staff",companyId:"p",name:"担当者",affiliation:"協力店",
    sharedCount:2};
   row[field]=label;
   assert.throws(()=>projectPersonalRankings([row]),/RANK_ROW/,field+": "+label);
  }
 }
 // Validation normalizes for detection, but ordinary Japanese names are not rewritten.
 const published=projectPublishedProducts({hubCompanyId:"hub",partnerCompanyId:"p",
  productMaster:[{id:"nuro",companyId:"hub",name:"ＮＵＲＯ光",active:true}],
  globalIds:["nuro"]});
 assert.equal(published[0].name,"ＮＵＲＯ光");
 assert.deepEqual(projectPersonalRankings([{personId:"staff",companyId:"p",
  name:"山田 太郎",affiliation:"第１班",sharedCount:2}]),
  [{rank:1,name:"山田 太郎",affiliation:"第１班"}]);
});
