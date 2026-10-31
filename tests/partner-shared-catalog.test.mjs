import test from "node:test";
import assert from "node:assert/strict";
import {
 buildPartnerCatalog,planCreatePartnerProduct,planChangePartnerProduct,
 filterPartnerCountLines
} from "../partner/shared-catalog.mjs";

const relation={serverVerified:true,active:true,hubCompanyId:"hub",
 partnerCompanyId:"partner",catalogAccessApproved:true,countSharingApproved:true};
const original=[
 {companyId:"hub",id:"nuro",name:"NURO光",active:true,sortOrder:0,
  revenue:30000,pricingOptions:[{cashback:10000,revenuePerUnit:30000}],cashbackOptions:[0,10000]},
 {companyId:"hub",id:"electric",name:"電気",active:true,sortOrder:1,
  revenue:10000,pricingOptions:[{cashback:0,revenuePerUnit:10000}]}
];
const local=[
 {companyId:"partner",productId:"customA",name:"パートナー専用A",
  active:true,sortOrder:2,visibility:"private"},
 {companyId:"partner",productId:"customB",name:"協力店独自商材B",
  active:true,sortOrder:3,visibility:"private"}
];
const base={hubCompanyId:"hub",partnerCompanyId:"partner",relation,
 hubProducts:original,localCustomProducts:local};
test("partner automatically sees EXACT current hub catalog labels/order, never prices",()=>{
 const before=JSON.stringify(base);
 const result=buildPartnerCatalog(base);
 assert.deepEqual(result.products.map(x=>x.name),[
  "NURO光","電気","パートナー専用A","協力店独自商材B"]);
 assert.deepEqual(result.products.map(x=>x.catalogId),[
  "shared:hub:nuro","shared:hub:electric","custom:partner:customA","custom:partner:customB"]);
 assert(result.products.some(x=>x.visibility==="private"));
 const payload=JSON.stringify(result);
 for(const leak of ["30000","10000","cashback","revenue","pricingOptions","price"])
  assert.equal(payload.toLowerCase().includes(leak.toLowerCase()),false,leak);
 assert.equal(JSON.stringify(base),before);
});
test("hub sees NO partner-custom names, identifiers, counts or private total",()=>{
 const view=buildPartnerCatalog({...base,audience:"hub",hubProducts:[]});
 assert.deepEqual(view.products,[]);
 assert.deepEqual(view.sharedCustomProductIds,[]);
 const dump=JSON.stringify(view);
 for(const secret of ["パートナー専用A","協力店独自商材B","customA","customB"])
  assert(!dump.includes(secret),secret);
});
test("partner product create defaults strictly private and price fields are forbidden",()=>{
 const owner={companyId:"partner",partnerCatalogRole:"owner",serverVerified:true};
 const fresh=planCreatePartnerProduct({
  actor:owner,partnerCompanyId:"partner",productId:"new",productName:"新しい商材"
 });
 assert.equal(fresh.visibility,"private");
 assert.equal(fresh.companyId,"partner");
 assert(!("revenue" in fresh));
 assert.deepEqual(Object.keys(fresh).sort(),
  ["companyId","productId","name","sortOrder","active","visibility"].sort());
 const localManager={...owner,partnerCatalogRole:"catalog_manager"};
 assert.equal(planCreatePartnerProduct({actor:localManager,partnerCompanyId:"partner",
  productId:"new",productName:"新商材"}).visibility,"private");
 for(const notAllowed of [
   {...owner,serverVerified:false},
   {...owner,companyId:"hub"},
   {...owner,partnerCatalogRole:"member"}
 ])assert.throws(()=>planCreatePartnerProduct({actor:notAllowed,
   partnerCompanyId:"partner",productId:"new",productName:"商材"}),/Partner catalog denied/);
});
test("partner custom may remain private; attempts to publish to hub are always rejected",()=>{
 const actor={serverVerified:true,companyId:"partner",partnerCatalogRole:"owner"};
 const old=local[0],oldJson=JSON.stringify(old);
 assert.throws(()=>planChangePartnerProduct({actor,existing:old,
   partnerCompanyId:"partner",nextVisibility:"shared_counts"}),/denied/);
 const same=planChangePartnerProduct({actor,existing:old,
   partnerCompanyId:"partner",nextVisibility:"private"});
 assert.equal(same.visibility,"private");
 assert.equal(same.productId,old.productId);
 assert.equal(JSON.stringify(old),oldJson);
 assert.throws(()=>planChangePartnerProduct({actor:{...actor,partnerCatalogRole:"leader"},
  existing:old,partnerCompanyId:"partner",nextVisibility:"private"}),/denied/);
 assert.throws(()=>buildPartnerCatalog({...base,localCustomProducts:[{...old,visibility:"shared_counts"}]}),/denied/);
});
test("other company cannot see partner catalog without BOTH server verified approvals",()=>{
 for(const invalid of [
  {...relation,catalogAccessApproved:false},
  {...relation,countSharingApproved:false},
  {...relation,serverVerified:false},
  {...relation,partnerCompanyId:"third"},
  {...relation,active:false},
 ]){
  assert.throws(()=>buildPartnerCatalog({...base,relation:invalid}),/denied/);
 }
});
test("custom documents with embedded financial fields, overlong names, money-coded IDs fail",()=>{
 const invalid=[
  {...local[0],revenue:90000},
  {...local[0],pricingOptions:[{revenuePerUnit:50000}]},
  {...local[0],visibility:"public_everyone"},
  {...local[0],visibility:"shared_counts"},
  {...local[0],name:"CB20000 商材"},
  {...local[0],productId:"../../another"},
  {...local[0],sortOrder:-1}
 ];
 for(const product of invalid){
  assert.throws(()=>buildPartnerCatalog({...base,localCustomProducts:[product]}),/denied/);
 }
 const withMoneyId={...base,hubProducts:[{...original[0],id:"NURO_CB20000"}]};
 assert.throws(()=>buildPartnerCatalog(withMoneyId),/monetary details/);
});
test("PRIVATE custom counts cannot leak in combined intercompany ranking via subtraction",()=>{
 const lines=[
  {companyId:"partner",productId:"customA",count:5},
  {companyId:"partner",productId:"customB",count:2}
 ];
 const own=filterPartnerCountLines({
  partnerCompanyId:"partner",customProducts:local,lines,audience:"partner"
 });
 assert.deepEqual(own,[{productId:"customA",count:5},{productId:"customB",count:2}]);
 const hub=filterPartnerCountLines({
  partnerCompanyId:"partner",customProducts:local,lines,audience:"hub"
 });
 assert.deepEqual(hub,[]);
});
