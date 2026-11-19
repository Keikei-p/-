import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PARTNER_RANK_SKUS} from "../functions-ranking-approvals/ranking/partner-workspace-count-source.mjs";
import {linkAllRegisteredCountsWithoutSetup}
 from "../functions-ranking-approvals/ranking/zero-setup-count-linker.mjs";
import {createZeroSetupCountPublicationReader}
 from "../functions-ranking-approvals/ranking/owner-product-visibility-in-atomic-tx.mjs";
const TIME="2026-11-18T09:00:00.000Z";
const own=(id,name,active=true)=>({
 companyId:"hub1",sourceId:id,name,active
});
const make=()=>({
 hubCompanyId:"hub1",
 hubSource:{companyId:"hub1",kind:"own",consentVerified:true,isComplete:true,
  readTime:TIME,products:[
   own("nuro","NURO光"),own("hikari","ソフトバンク光"),
   own("combined","SB光・AIR"),own("water","ウォーター")
  ]},
 partnerSources:[{companyId:"partner1",kind:"partner",
  consentVerified:true,isComplete:true,readTime:TIME,
  products:PARTNER_RANK_SKUS.map(item=>({
   companyId:"partner1",sourceId:item.id,name:item.name,active:true
  }))}]
});
const deny=fn=>assert.throws(fn,/ZERO_SETUP_COUNT_SOURCE_UNVERIFIED/);
const partnerRow=(rows,productId)=>rows.find(x=>x.companyId==="partner1"&&x.productId===productId);
test("no toggles: all original 9 partner SKUs are present, no dropped count source",()=>{
 const input=make(),before=structuredClone(input);
 const linked=linkAllRegisteredCountsWithoutSetup(input);
 assert.equal(linked.filter(x=>x.companyId==="partner1").length,9);
 assert.equal(linked.filter(x=>x.companyId==="hub1").length,4);
 assert.equal(partnerRow(linked,"partnerSku01").groupId,"nuro");
 assert.equal(partnerRow(linked,"partnerSku05").groupId,"combined");
 assert.equal(partnerRow(linked,"partnerSku06").groupId,"water");
 assert.equal(partnerRow(linked,"partnerSku09").groupId,"partnerUnmatched:partnerSku09");
 // Unknown commercial SKU is not discarded, mapped by guess, or folded into own.
 assert.deepEqual(input,before);
 assert(Object.isFrozen(linked));
 assert.equal(JSON.stringify(linked).includes("unitPrice"),false);
});
test("old combined 光/AIR is NEVER assigned to separate hikari or Air",()=>{
 const x=make();
 x.hubSource.products=x.hubSource.products.filter(p=>p.sourceId!=="combined");
 const linked=linkAllRegisteredCountsWithoutSetup(x);
 assert.equal(partnerRow(linked,"partnerSku05").groupId,"partnerUnmatched:partnerSku05");
 assert.equal(linked.find(x=>x.productId==="hikari").groupId,"hikari");
});
test("ambiguous own SKU name fails closed for automatic joining, counts remain separate",()=>{
 const x=make();
 x.hubSource.products.push(own("nuro-duplicate","NURO光"));
 const linked=linkAllRegisteredCountsWithoutSetup(x);
 assert.equal(partnerRow(linked,"partnerSku01").groupId,"partnerUnmatched:partnerSku01");
 assert.equal(linked.filter(x=>x.companyId==="hub1").length,5);
});
test("same ID cannot be duplicated, price-encoded product name never published",()=>{
 const x=make();
 x.hubSource.products.push(own("nuro","NURO光"));deny(()=>linkAllRegisteredCountsWithoutSetup(x));
 const y=make();
 y.hubSource.products[0].name="NURO 単価50000円";
 deny(()=>linkAllRegisteredCountsWithoutSetup(y));
 const z=make();z.partnerSources[0].products[0].name="売上";
 deny(()=>linkAllRegisteredCountsWithoutSetup(z));
});
function mockTx({partner=true,active=true,verified=true,sameReadTime=true}={}){
 const readTime={seconds:1794992400,nanoseconds:0,toDate:()=>new Date(TIME)};
 const docs={
  "companies/hub1":{ownerUid:"owner1",companyKind:"internal",active:true},
  "companies/partner1":{hubCompanyId:"hub1",companyKind:"partner",active:true},
  "partnerRelations/partner1":{hubCompanyId:"hub1",partnerCompanyId:"partner1",
   active,countSharingApproved:true}
 };
 const requested=[],verifyCalls=[];
 const db={collection:name=>({doc:id=>({path:name+"/"+id})})};
 const tx={get:async ref=>{
  requested.push(ref.path);
  const data=docs[ref.path];
  return {exists:data!==undefined,data:()=>data,
   readTime:sameReadTime||ref.path==="companies/hub1"?
    readTime:{...readTime,nanoseconds:1}};
 }};
 const context={serverVerified:true,viewerUid:partner?"partnerOwner":"owner1",
  viewerCompanyId:partner?"partner1":"hub1",hubCompanyId:"hub1",
  role:partner?"partner_owner":"hub_owner",
  approvedCompanyIds:["hub1","partner1"],activeCountSharingVerified:true};
 const reader=createZeroSetupCountPublicationReader({
  db,verifyCountViewer:async params=>{
   verifyCalls.push(params);
   if(!verified)throw Error("IDENTITY_FAIL");
  }
 });
 return {reader,tx,context,requested,verifyCalls};
}
test("zero-setup partner authorization needs live relation and exact snapshot",async()=>{
 const a=mockTx();
 const out=await a.reader({tx:a.tx,context:a.context});
 assert.equal(out.serverVerified,true);
 assert.equal(out.ownerSettingsRead,false);
 assert.equal(out.zeroSetupVerified,true);
 assert.equal(out.productMappingsReviewed,false);
 assert.deepEqual(a.requested,["companies/hub1","companies/partner1",
  "partnerRelations/partner1"]);
 assert.equal(a.verifyCalls.length,1);
 for(const reason of [{active:false},{verified:false},{sameReadTime:false}]){
  const x=mockTx(reason);
  await assert.rejects(()=>x.reader({tx:x.tx,context:x.context}));
 }
});
test("owner and partner must pass different verified, server-origin scopes",async()=>{
 const h=mockTx({partner:false});
 const verified=await h.reader({tx:h.tx,context:h.context});
 assert.equal(verified.ownerUidVerified,true);
 assert.deepEqual(h.requested,["companies/hub1"]);
 const forged=mockTx();
 forged.context.viewerCompanyId="foreign";
 await assert.rejects(()=>forged.reader({tx:forged.tx,context:forged.context}));
 const missing=mockTx();
 missing.context.activeCountSharingVerified=false;
 await assert.rejects(()=>missing.reader({tx:missing.tx,context:missing.context}));
});
test("production route requires both explicit flags, with current default OFF",()=>{
 const src=readFileSync(new URL("../functions-ranking-approvals/index.js",import.meta.url),"utf8");
 assert(src.includes('enabled:()=>process.env.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"'));
 assert(src.includes('zeroSetupLink:process.env.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled"'));
 assert(!src.includes("zeroSetupLink:true"));
 assert(src.includes("getVerifiedJointCountRanking=onRequest("));
});
