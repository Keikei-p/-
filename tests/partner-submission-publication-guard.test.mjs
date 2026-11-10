import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createPartnerSubmissionPublicationGuard} from "../ranking/partner-submission-publication-guard.mjs";
const require=createRequire(import.meta.url);
const {createPartnerSubmissionPublicationGuard:vendorGuard}=require("../functions-partner-workspace/submission-publication-guard.cjs");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const counts=o=>({...zero(),...o});
const shot=(v,id)=>({exists:v!==undefined,id,data:()=>v});
class Ref{
 constructor(db,path){this.db=db;this.path=path;}
 collection(n){return new Col(this.db,this.path+"/"+n);}
}
class Col{
 constructor(db,path){this.db=db;this.path=path;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 where(field,op,value){assert.equal(op,"==");return new Query(this.db,this.path,field,value);}
}
class Query{
 constructor(db,path,field,value){Object.assign(this,{db,path,field,value});}
 limit(n){assert.equal(n,1001);return this;}
}
class DB{
 constructor(){this.rows=new Map();this.reads=[];this.writes=0;}
 collection(n){return new Col(this,n);}
 seed(path,value){this.rows.set(path,structuredClone(value));}
 transaction(){return {get:async ref=>{
  if(ref instanceof Query){
   this.reads.push(ref.path+"?"+ref.field);
   const docs=[];
   for(const [path,value] of this.rows)if(path.startsWith(ref.path+"/")&&
      !path.slice(ref.path.length+1).includes("/")&&value[ref.field]===ref.value)
     docs.push(shot(value,path.split("/").at(-1)));
   return {docs};
  }
  this.reads.push(ref.path);
  return shot(this.rows.get(ref.path),ref.path.split("/").at(-1));
 },create:()=>{this.writes++;throw Error("UNEXPECTED_WRITE");},
 update:()=>{this.writes++;throw Error("UNEXPECTED_WRITE");}};}
}
function fixture(){
 const db=new DB();
 db.seed("companies/hub",{ownerUid:"owner",active:true,companyKind:"internal"});
 db.seed("companies/partner",{hubCompanyId:"hub",active:true,companyKind:"partner"});
 db.seed("partnerRelations/partner",{hubCompanyId:"hub",partnerCompanyId:"partner",
  active:true,countSharingApproved:true});
 db.seed("companies/hub/rankingProductVisibility/shared",{
  hubCompanyId:"hub",ownerUid:"owner",version:2,
  enabledHubProductIds:["nuro","combined"],partnerOverrides:{}});
 db.seed("companies/hub/rankingSkuMappings/shared",{
  hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",active:true,version:3,
  bindings:[{companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
   {companyId:"partner",productId:"partnerSku05",hubProductId:"combined"}]});
 db.seed("companies/hub/rankingCountPublicCatalog/shared",{
  schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:"hub",ownerUid:"owner",version:2,
  products:[{id:"nuro",companyId:"hub",name:"NURO",active:true},
   {id:"combined",companyId:"hub",name:"SB光・AIR（旧合算・未分類）",active:true}]});
 // Deliberate financial decoys: the partner guard must never query these.
 db.seed("products/nuro",{companyId:"hub",name:"NURO",active:true,unitPrice:50000});
 const scope={verifiedByServer:true,kind:"partner",uid:"staff",cid:"partner",hubId:"hub"};
 const guard=createPartnerSubmissionPublicationGuard({db});
 const call=(before=zero(),after=zero(),who=scope)=>
  guard({tx:db.transaction(),scope:who,previousCounts:before,nextCounts:after});
 return {db,scope,call};
}
const denied=p=>assert.rejects(p,/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
test("ON count passes, OFF count denied, server reads exact policy and never writes",async()=>{
 const {db,call}=fixture();
 const out=await call(zero(),counts({NURO:3,"SB光・AIR":2}));
 assert.deepEqual(out.enabledCategories,["NURO","SB光・AIR"]);
 assert.equal(out.publicationVersion,2);
 assert.ok(db.reads.includes("companies/hub/rankingProductVisibility/shared"));
 assert.ok(db.reads.includes("companies/hub/rankingSkuMappings/shared"));
 assert.ok(db.reads.includes("companies/hub/rankingCountPublicCatalog/shared"));
 assert.ok(!db.reads.some(p=>p.startsWith("products")),"never read financial products");
 await denied(call(zero(),counts({SBMNP:1})));
 assert.equal(db.writes,0);
});
test("OFF historical count cannot be deleted or increased while ON count is corrected",async()=>{
 const {db,call}=fixture(),before=counts({NURO:2,SBMNP:7});
 await call(before,counts({NURO:4,SBMNP:7}));
 await denied(call(before,counts({NURO:4,SBMNP:0})));
 await denied(call(before,counts({NURO:4,SBMNP:8})));
 assert.equal(db.writes,0);
});
test("partner OFF further restricts global ON; global OFF cannot be re-enabled",async()=>{
 const {db,call}=fixture();
 const policy=db.rows.get("companies/hub/rankingProductVisibility/shared");
 policy.partnerOverrides={partner:["combined"]};
 await denied(call(zero(),counts({NURO:1})));
 await call(zero(),counts({"SB光・AIR":1}));
 policy.enabledHubProductIds=["nuro"];
 await denied(call(zero(),counts({"SB光・AIR":1})));
 assert.equal(db.writes,0);
});
test("retired product, legacy split, missing mapping and revoked relation fail closed",async()=>{
 const {db,call}=fixture();
 db.rows.get("companies/hub/rankingCountPublicCatalog/shared").products[0].active=false;
 await denied(call(zero(),counts({NURO:1})));
 db.rows.get("companies/hub/rankingCountPublicCatalog/shared").products[0].active=true;
 db.rows.get("companies/hub/rankingCountPublicCatalog/shared").products[1].name="SB光";
 await denied(call(zero(),counts({"SB光・AIR":1})));
 for(const path of ["companies/hub/rankingSkuMappings/shared",
  "companies/hub/rankingProductVisibility/shared",
  "companies/hub/rankingCountPublicCatalog/shared","partnerRelations/partner"]){
  const {db:other,call:run}=fixture();
  other.rows.delete(path);await denied(run());assert.equal(other.writes,0);
 }
});
test("duplicate mapping, wrong scope, malformed counts, and unreviewed map fail closed",async()=>{
 const {db,call,scope}=fixture();
 db.rows.get("companies/hub/rankingSkuMappings/shared").bindings.push(
  {companyId:"partner",productId:"partnerSku01",hubProductId:"combined"});
 await denied(call());
 db.rows.get("companies/hub/rankingSkuMappings/shared").bindings.pop();
 await denied(call(zero(),zero(),{...scope,verifiedByServer:false}));
 await denied(call(zero(),zero(),{...scope,cid:"foreign"}));
 await denied(call(zero(),counts({NURO:-1})));
 await denied(call(zero(),{NURO:1}));
 db.rows.get("companies/hub/rankingSkuMappings/shared").reviewedByUid="other";
 await denied(call());
 assert.equal(db.writes,0);
});

test("duplicate hub SKU and amount-encoded mapped name fail closed without writes",async()=>{
 const {db,call}=fixture();
 const mapping=db.rows.get("companies/hub/rankingSkuMappings/shared");
 mapping.bindings.push({companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"});
 await denied(call(zero(),counts({NURO:1})));
 mapping.bindings.pop();
 db.rows.get("companies/hub/rankingCountPublicCatalog/shared").products[0].name="NURO 50000円";
 await denied(call(zero(),counts({NURO:1})));
 assert.equal(db.writes,0);
});

test("public count catalog version mismatch and injected finance fields block save",async()=>{
 const {db,call}=fixture(),path="companies/hub/rankingCountPublicCatalog/shared";
 const catalog=db.rows.get(path);
 catalog.version=3;
 await denied(call(zero(),counts({NURO:1})));
 catalog.version=2;
 catalog.products[0].unitPrice=50000;
 await denied(call(zero(),counts({NURO:1})));
 delete catalog.products[0].unitPrice;
 assert.equal(db.writes,0);
 assert.ok(!db.reads.some(p=>p.startsWith("products")));
});


test("canonical and deployed vendor reject CB and revenue-coded SKU names without reading finance",async()=>{
 for(const createGuard of [createPartnerSubmissionPublicationGuard,vendorGuard]){
  for(const name of ["NURO CB50000","NURO ＣＢ５０００","NURO cashback 5000",
   "NURO revenue 5k","NURO 単価5000","NURO 原価","NURO 価格",
   "NURO commission","NURO ５万円","NURO ２千円"]){
   const {db,scope}=fixture();
   db.rows.get("companies/hub/rankingCountPublicCatalog/shared").products[0].name=name;
   const guard=createGuard({db});
   await denied(guard({tx:db.transaction(),scope,previousCounts:zero(),
    nextCounts:counts({NURO:1})}));
   assert.equal(db.writes,0);
   assert.ok(!db.reads.some(path=>path.startsWith("products")));
  }
  const {db,scope}=fixture();
  const guard=createGuard({db});
  const result=await guard({tx:db.transaction(),scope,previousCounts:zero(),
   nextCounts:counts({NURO:1})});
  assert.ok(result.enabledCategories.includes("NURO"));
  assert.equal(db.writes,0);
 }
});
