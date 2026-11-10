import test from "node:test";
import assert from "node:assert/strict";
import {createPartnerSubmissionPublicationGuard} from "../ranking/partner-submission-publication-guard.mjs";
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
 db.seed("products/nuro",{companyId:"hub",name:"NURO",active:true,unitPrice:50000});
 db.seed("products/combined",{companyId:"hub",name:"SB光・AIR（旧合算・未分類）",
  active:true,unitPrice:9000});
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
 assert.ok(db.reads.includes("products?companyId"));
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
 db.rows.get("products/nuro").active=false;
 await denied(call(zero(),counts({NURO:1})));
 db.rows.get("products/nuro").active=true;
 db.rows.get("products/combined").name="SB光";
 await denied(call(zero(),counts({"SB光・AIR":1})));
 for(const path of ["companies/hub/rankingSkuMappings/shared",
  "companies/hub/rankingProductVisibility/shared","partnerRelations/partner"]){
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
