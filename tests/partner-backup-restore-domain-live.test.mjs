import test from "node:test";
import assert from "node:assert/strict";
import {restoreToLocalEmulator,emulatorBase,TEST_PROJECT}
 from "../tools/readonly-backup/restore-emulator.mjs";
import {PROJECT,fingerprint,canonical} from "../tools/readonly-backup/backup.mjs";

// Real localhost Firestore emulator, SYNTHETIC documents only.
// Historical sales, prices, cashback tiers, correction history, team snapshots
// and partner count ledgers must round-trip as raw typed fields; even a
// deliberately inconsistent historical row must NOT be guessed/repaired.
assert.equal(process.env.GCLOUD_PROJECT,TEST_PROJECT);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,TEST_PROJECT);
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||"","");
assert.equal(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||"","");
const host=process.env.FIRESTORE_EMULATOR_HOST;
const base=emulatorBase(host,TEST_PROJECT);
const n=value=>({integerValue:String(value)});
const s=value=>({stringValue:value});
const b=value=>({booleanValue:value});
const map=fields=>({mapValue:{fields}});
const list=values=>({arrayValue:{values}});
const doc=(path,fields)=>({path,value:{fields}});
const original=()=>({projectId:PROJECT,format:"firestore-rest-typed-v1",documents:[
 doc("records/synthetic-domain-valid",{
  companyId:s("direct"),date:s("2026-10-30"),uid:s("demo-user"),
  teamId:s("team-original"),totalCount:n(5),totalRevenue:n(210000),
  results:map({
   nuro:map({count:n(2),revenuePerUnit:n(85000),cashbackTier:s("20000")}),
   power:map({count:n(3),revenuePerUnit:n(13333)})
  }),createdByUid:s("demo-owner")
 }),
 doc("records/synthetic-domain-drift",{
  companyId:s("direct"),date:s("2026-10-31"),uid:s("demo-user"),
  teamId:s("team-original"),totalCount:n(1),totalRevenue:n(55000),
  results:map({
   first:map({count:n(1),revenuePerUnit:n(55000)}),
   orphan:map({count:n(1),revenuePerUnit:n(0)})
  })
 }),
 doc("recordCorrections/synthetic-domain-correction",{
  recordId:s("synthetic-domain-drift"),changedByUid:s("demo-owner"),
  before:map({totalCount:n(1),results:map({first:map({count:n(1)})})}),
  after:map({totalCount:n(1),results:map({first:map({count:n(1)})})}),
  auditKind:s("synthetic")
 }),
 doc("products/synthetic-domain-product",{
  companyId:s("direct"),name:s("検証商材"),unitPrice:n(85000),
  pricingOptions:list([map({cb:n(20000),revenuePerUnit:n(85000)})]),
  active:b(true)
 }),
 doc("teams/synthetic-domain-original-team",{
  companyId:s("direct"),name:s("旧班"),active:b(false)
 }),
 doc("companies/synthetic-domain-hub",{companyKind:s("internal"),active:b(true)}),
 doc("companies/synthetic-domain-hub/members/synthetic-member",{
  uid:s("demo-user"),accessKind:s("internal"),active:b(true),
  teamHistory:list([map({teamId:s("team-original"),from:s("2026-10-01")})])
 }),
 doc("companies/synthetic-domain-partner",{companyKind:s("partner"),hubCompanyId:s("direct"),active:b(true)}),
 doc("companies/synthetic-domain-partner/partnerWorkTeams/synthetic-team",{
  companyId:s("synthetic-domain-partner"),name:s("保存時班")
 }),
 doc("companies/synthetic-domain-partner/partnerWorkEntries/2026-10-31__demo-staff",{
  companyId:s("synthetic-domain-partner"),date:s("2026-10-31"),
  staffId:s("demo-staff"),teamIdSnapshot:s("synthetic-team"),
  counts:map({NURO:n(2),YMMNP:n(1)}),totalCount:n(3),
  cbCounts:map({NURO:map({"20000":n(2)})})
 }),
 doc("companies/synthetic-domain-partner/partnerAdditionalCountEntries/2026-10-31__demo-staff",{
  companyId:s("synthetic-domain-partner"),staffId:s("demo-staff"),
  teamIdSnapshot:s("synthetic-team"),counts:map({extraOld:n(4)}),totalCount:n(4)
 }),
 doc("companies/synthetic-domain-partner/partnerAdditionalCountAudits/synthetic-audit",{
  staffId:s("demo-staff"),before:map({extraOld:n(2)}),
  after:map({extraOld:n(4)}),version:n(2)
 })
]});
const auth={"Authorization":"Bearer owner"};
async function read(path){
 const endpoint=base+path.split("/").map(encodeURIComponent).join("/");
 const result=await fetch(endpoint,{method:"GET",redirect:"error",headers:auth});
 assert.equal(result.status,200,"all synthetic source IDs must be present");
 return (await result.json()).fields;
}
test("original IDs, direct revenue/price/CB, original teams and partner count/audit fields round-trip in isolated emulator",async()=>{
 const snap=original(),before=canonical(snap),hash=fingerprint(snap);
 const restored=await restoreToLocalEmulator(snap,{emulatorHost:host,projectId:TEST_PROJECT});
 assert.equal(restored.productionTouched,false);
 assert.equal(restored.documentCount,snap.documents.length);
 assert.equal(restored.fieldsAndIdsVerified,true);
 assert.equal(restored.sourceInventoryFingerprint,hash);
 assert.equal(restored.metadataTimestampsPreserved,false);
 for(const row of snap.documents){
  const fields=await read(row.path);
  assert.equal(canonical(fields),canonical(row.value.fields),"all typed fields must match");
 }
 // The deliberately inconsistent source remains inconsistent after restore;
 // never silently drop a residual line or reinterpret the original total.
 const old=await read("records/synthetic-domain-drift");
 assert.equal(old.totalCount.integerValue,"1");
 assert.equal(Object.keys(old.results.mapValue.fields).length,2);
 assert.equal(old.totalRevenue.integerValue,"55000");
 const correction=await read("recordCorrections/synthetic-domain-correction");
 assert.equal(correction.after.mapValue.fields.totalCount.integerValue,"1");
 assert.equal(correction.before.mapValue.fields.totalCount.integerValue,"1");
 assert.equal(canonical(snap),before,"source must remain immutable");
});
test("second restore must refuse any overwrite, even when archive fields differ",async()=>{
 const previous=await read("records/synthetic-domain-valid");
 const changed=original();
 changed.documents[0].value.fields.totalCount=n(999);
 await assert.rejects(restoreToLocalEmulator(changed,{emulatorHost:host,projectId:TEST_PROJECT}),
  /BLOCK: emulator destination is not proven empty/);
 assert.equal(canonical(await read("records/synthetic-domain-valid")),canonical(previous));
});
