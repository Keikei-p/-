import test from "node:test";
import assert from "node:assert/strict";
import {linkAllRegisteredCountsWithoutSetup}
 from "../ranking/zero-setup-count-linker.mjs";
import {PARTNER_RANK_SKUS}
 from "../ranking/partner-workspace-count-source.mjs";
const TIME="2026-11-17T09:00:00.000Z";
const hubProducts=[
 {companyId:"hub",sourceId:"nuro",name:"NURO光",active:true,sortOrder:0},
 {companyId:"hub",sourceId:"air",name:"SoftBank Air",active:true,sortOrder:1},
 {companyId:"hub",sourceId:"combined",name:"SB光・AIR（旧合算・未分類）",active:true,sortOrder:2},
 {companyId:"hub",sourceId:"mnp",name:"SoftBank MNP",active:true,sortOrder:3}
];
function fixture(){
 const hubSource={companyId:"hub",kind:"own",consentVerified:true,
  isComplete:true,readTime:TIME,products:structuredClone(hubProducts)};
 const partnerSources=["partner1","partner2","partner3"].map(companyId=>({
  companyId,kind:"partner",consentVerified:true,isComplete:true,readTime:TIME,
  products:PARTNER_RANK_SKUS.map(p=>({companyId,sourceId:p.id,name:p.name,active:true}))
 }));
 return {hubCompanyId:"hub",hubSource,partnerSources};
}
test("all 3 partner companies x 9 saved SKU categories remain ranked, even with zero mapping documents",()=>{
 const f=fixture(),actual=linkAllRegisteredCountsWithoutSetup(f);
 assert.equal(actual.length,4+3*9);
 assert.equal(actual.filter(x=>x.companyId!=="hub").length,27);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku01")
  .map(x=>x.groupId),["nuro","nuro","nuro"]);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku02")
  .map(x=>x.groupId),["mnp","mnp","mnp"]);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku05")
  .map(x=>x.groupId),["combined","combined","combined"]);
 assert.deepEqual(actual.filter(x=>x.productId==="partnerSku09")
  .map(x=>x.groupId),[
   "partnerUnmatched:partnerSku09",
   "partnerUnmatched:partnerSku09",
   "partnerUnmatched:partnerSku09"
  ]);
 assert.deepEqual(f.hubSource.products,hubProducts,
  "original owner products and stored counts never mutated");
 assert(!/(unitPrice|revenue|cashback|売上|単価)/i.test(JSON.stringify(actual)));
});
test("ambiguous same-named hub products do not guess a master product",()=>{
 const f=fixture();
 f.hubSource.products.push({companyId:"hub",sourceId:"nuro2",
  name:"NURO",active:true,sortOrder:9});
 const result=linkAllRegisteredCountsWithoutSetup(f);
 assert(result.filter(x=>x.productId==="partnerSku01"&&x.companyId!=="hub")
  .every(x=>x.groupId==="partnerUnmatched:partnerSku01"),
  "two legitimate hub products are never merged by a guess");
});
test("legacy combined 光/AIR never silently splits into separate Hikari or Air",()=>{
 const f=fixture();
 f.hubSource.products=f.hubSource.products.filter(p=>p.sourceId!=="combined");
 const result=linkAllRegisteredCountsWithoutSetup(f);
 assert(result.filter(x=>x.productId==="partnerSku05")
  .every(x=>x.groupId==="partnerUnmatched:partnerSku05"));
 assert(!result.some(x=>x.productId==="partnerSku05"&&x.groupId==="air"));
});
test("active products with nonmatching names remain separate, not suppressed by an old OFF setting",()=>{
 const f=fixture();
 f.hubSource.products.push({companyId:"hub",sourceId:"new-2026",
  name:"新規商材",active:true,sortOrder:4});
 const result=linkAllRegisteredCountsWithoutSetup(f);
 assert(result.some(x=>x.companyId==="hub"&&x.productId==="new-2026"));
 assert(result.filter(x=>x.companyId==="partner1").length===9);
});
test("invalid source identities, amount-coded labels, private unknown partner SKUs are refused",()=>{
 const mutators=[
  x=>{x.partnerSources[0].readTime="2026-11-17T09:01:00.000Z"},
  x=>{x.partnerSources[0].companyId="hub"},
  x=>{x.partnerSources[1].companyId=x.partnerSources[0].companyId},
  x=>{x.partnerSources[0].consentVerified=false},
  x=>{x.hubSource.products[0].name="NURO単価12000"},
  x=>{x.partnerSources[0].products[0].name="収益Nuro"},
  x=>{x.partnerSources[0].products[0].sourceId="privateSku"},
  x=>{x.partnerSources[0].products[0].name="U-NEXT"},
  x=>{x.hubSource.products[1].sourceId=x.hubSource.products[0].sourceId}
 ];
 for(const mutate of mutators){
  const f=fixture();mutate(f);
  assert.throws(()=>linkAllRegisteredCountsWithoutSetup(f),
   /ZERO_SETUP_COUNT_SOURCE_UNVERIFIED|FINANCIAL/);
 }
});
