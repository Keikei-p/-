import test from "node:test";
import assert from "node:assert/strict";
import {previewHistoricalPartnerMapping} from "../ranking/partner-history-mapping-preview.mjs";

const labels=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const keys=(nu=0,sb=0,combined=0)=>Object.fromEntries(
 labels.map((s,i)=>[s,i===0?nu:i===1?sb:i===4?combined:0])
);
const proof=()=>({ownerVerified:true,partnerRelationVerified:true,
 completeMonthEntriesRead:true,snapshotConsistent:true});
const products=()=>[
 {id:"nuro",companyId:"hub",name:"NURO",active:true},
 {id:"sbmnp",companyId:"hub",name:"SBMNP",active:true},
 {id:"combined",companyId:"hub",name:"SB光・AIR（旧合算）",active:true},
 {id:"air",companyId:"hub",name:"AIR",active:true}
];
const visibility=(on=["nuro","combined"])=>({
 hubCompanyId:"hub",ownerUid:"owner",enabledHubProductIds:on,
 partnerOverrides:{}
});
const mapping=(bindings=[
 {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
 {companyId:"partner",productId:"partnerSku02",hubProductId:"sbmnp"},
 {companyId:"partner",productId:"partnerSku05",hubProductId:"combined"}
])=>({hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",
 active:true,version:1,bindings});
const entry=(date,staff,counts)=>({
 id:date+"__"+staff,date,staffId:staff,teamIdSnapshot:"team1",
 companyId:"partner",hubCompanyId:"hub",counts,
 totalCount:Object.values(counts).reduce((a,b)=>a+b,0)
});
const inputs=()=>({hubCompanyId:"hub",partnerCompanyId:"partner",
 ownerUid:"owner",month:"2026-11",proof:proof(),products:products(),
 entries:[entry("2026-11-09","staff1",keys(3,2,5)),
          entry("2026-11-10","staff1",keys(0,0,0))],
 mapping:mapping(),visibility:visibility()});

test("historical mapped ON counts join rankings exactly once; OFF counts retained and zero reports distinguished",()=>{
 const input=inputs(),snapshot=structuredClone(input);
 const result=previewHistoricalPartnerMapping(input);
 assert.equal(result.originalTotalCount,10);
 assert.equal(result.rankingIncludedCount,8);
 assert.equal(result.heldCount,2);
 assert.equal(result.existingEntryCount,2);
 assert.equal(result.reportedZeroEntryCount,1);
 assert.equal(result.missingReportCount,null);
 assert.equal(result.legacyCombinedSourceCount,5);
 assert.deepEqual(result.publishedByHubProductId,[
  {productId:"nuro",count:3},{productId:"combined",count:5}
 ]);
 assert.equal(result.categories.find(c=>c.sourceSkuId==="partnerSku02").state,"mapped_off");
 assert.equal(result.categories.find(c=>c.sourceSkuId==="partnerSku05").legacyCombined,true);
 assert.equal(result.historicalWrites,0);
 assert.equal(result.mappingWrites,0);
 assert.deepEqual(input,snapshot,"no mutating source records or mapping document");
});

test("turning ON a mapped SKU restores existing past counts with no new entry writes",()=>{
 const input=inputs();
 const before=previewHistoricalPartnerMapping(input);
 input.visibility=visibility(["nuro","sbmnp","combined"]);
 const after=previewHistoricalPartnerMapping(input);
 assert.equal(before.originalTotalCount,after.originalTotalCount);
 assert.equal(after.rankingIncludedCount,10);
 assert.equal(after.heldCount,0);
 assert.equal(after.publishedByHubProductId.find(x=>x.productId==="sbmnp").count,2);
});

test("partner-specific OFF wins over global ON and does not delete historical counts",()=>{
 const input=inputs();
 input.visibility=visibility(["nuro","sbmnp","combined"]);
 input.visibility.partnerOverrides.partner=["nuro"];
 const out=previewHistoricalPartnerMapping(input);
 assert.equal(out.originalTotalCount,10);
 assert.equal(out.rankingIncludedCount,3);
 assert.equal(out.heldCount,7);
 assert.equal(out.legacyCombinedSourceCount,5);
});

test("missing mapping holds original counts without discarding entries",()=>{
 const input=inputs();
 input.mapping=null;
 const out=previewHistoricalPartnerMapping(input);
 assert.equal(out.originalTotalCount,10);
 assert.equal(out.rankingIncludedCount,0);
 assert.equal(out.heldCount,10);
 assert.equal(out.categories.filter(c=>c.state==="unmapped").length,9);
});

test("old combined light/AIR cannot be mapped directly into AIR",()=>{
 const input=inputs();
 input.mapping=mapping([{companyId:"partner",productId:"partnerSku05",hubProductId:"air"}]);
 assert.throws(()=>previewHistoricalPartnerMapping(input),/COMBINED_CANNOT_SPLIT/);
});

test("two old categories cannot point to the same hub SKU and double-count",()=>{
 const input=inputs();
 input.mapping=mapping([
  {companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"},
  {companyId:"partner",productId:"partnerSku02",hubProductId:"nuro"}
 ]);
 assert.throws(()=>previewHistoricalPartnerMapping(input),/COLLISION/);
});

test("reject duplicate original entry, wrong company, invalid daily total and invalid date",()=>{
 for(const change of [
  input=>input.entries.push(input.entries[0]),
  input=>input.entries[0].companyId="other",
  input=>input.entries[0].totalCount+=1,
  input=>input.entries[0].date="2026-11-31",
  input=>input.entries[0].counts.NURO=-1,
  input=>{delete input.entries[0].counts["SB光・AIR"];}
 ]){
  const input=inputs();change(input);
  assert.throws(()=>previewHistoricalPartnerMapping(input),/PARTNER_HISTORY_PREVIEW_/);
 }
});

test("reject stale or fake backend verification and finance-coded catalog labels",()=>{
 for(const change of [
  input=>input.proof.snapshotConsistent=false,
  input=>input.proof.ownerVerified=false,
  input=>input.proof.completeMonthEntriesRead=false,
  input=>input.products[0].name="NURO 単価 20000円",
  input=>input.visibility.enabledHubProductIds=["non-existent"],
  input=>input.mapping.reviewedByUid="other"
 ]){
  const input=inputs();change(input);
  assert.throws(()=>previewHistoricalPartnerMapping(input),/PARTNER_HISTORY_PREVIEW_/);
 }
});
