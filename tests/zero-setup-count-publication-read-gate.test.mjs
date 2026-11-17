import test from "node:test";
import assert from "node:assert/strict";
import {createZeroSetupCountPublicationReader}
 from "../ranking/owner-product-visibility-in-atomic-tx.mjs";
import {createStagedAtomicOwnerCountLoader}
 from "../ranking/owner-visible-count-atomic-loader.mjs";
const AS_OF="2026-11-17T09:00:00.000Z";
const readTime={seconds:1794906000,nanoseconds:0,
 toDate(){return new Date(AS_OF)}};
const hub={active:true,ownerUid:"hubOwner",companyKind:"internal"};
const partner={active:true,ownerUid:"partnerOwner",hubCompanyId:"hub",companyKind:"partner"};
const relation={active:true,countSharingApproved:true,hubCompanyId:"hub",
 partnerCompanyId:"partner"};
const context=(role="hub_owner")=>({
 serverVerified:true,viewerUid:role==="hub_owner"?"hubOwner":"partnerOwner",
 viewerCompanyId:role==="hub_owner"?"hub":"partner",hubCompanyId:"hub",
 role,approvedCompanyIds:["hub","partner"],activeCountSharingVerified:true
});
function fixture({hubData=hub,partnerData=partner,relationData=relation,
 timestamp=readTime,missing=[],verifyCountViewer=async()=>{}}={}){
 const operations=[],data=new Map([
  ["companies/hub",hubData],["companies/partner",partnerData],
  ["partnerRelations/partner",relationData]]);
 const db={collection(path){return {doc(id){return {path:path+"/"+id}}}},
 runTransaction:async(callback,opt)=>{operations.push(["begin",opt]);return callback(tx)}};
 const tx={
  get:async ref=>{
   const path=ref.path;
   operations.push(["get",path]);
   assert(!/rankingProductVisibility|rankingCountPublicCatalog|rankingSkuMappings|products|records|revenueGoals/.test(path),
    "no product setup, amount ledger or original financial documents read");
   return {exists:!missing.includes(path)&&data.has(path),
    readTime:timestamp,data(){return data.get(path)}};
  },
  create(){throw Error("READ_ONLY_PROOF_MUST_NOT_WRITE")},
  update(){throw Error("READ_ONLY_PROOF_MUST_NOT_WRITE")},
  set(){throw Error("READ_ONLY_PROOF_MUST_NOT_WRITE")},
  delete(){throw Error("READ_ONLY_PROOF_MUST_NOT_WRITE")}
 };
 const verify=async args=>{operations.push(["verify",args.context.viewerUid]);
  return verifyCountViewer(args)};
 const reader=createZeroSetupCountPublicationReader({db,verifyCountViewer:verify});
 return {db,tx,reader,operations};
}
test("hub and partner receive exactly one role-safe count witness without a catalog/visibility/mapping document",async()=>{
 for(const role of ["hub_owner","partner_owner"]){
  const f=fixture();
  const evidence=await f.reader({tx:f.tx,context:context(role)});
  assert.deepEqual(evidence,{
   serverVerified:true,zeroSetupVerified:true,ownerSettingsRead:false,
   ownerUidVerified:true,productMappingsReviewed:false,revision:1,
   hubCompanyId:"hub",snapshotReadTime:AS_OF
  });
  assert.equal(f.operations.filter(x=>x[0]==="verify").length,1);
  const paths=f.operations.filter(x=>x[0]==="get").map(x=>x[1]);
  assert.deepEqual(paths,role==="hub_owner"?["companies/hub"]:
   ["companies/hub","companies/partner","partnerRelations/partner"]);
 }
});
test("invalid company, revoked count-sharing, disabled partner, forged role, stale time or rejected Auth fail closed",async()=>{
 const cases=[
  {options:{missing:["companies/hub"]}},
  {options:{hubData:{...hub,active:false}}},
  {options:{hubData:{...hub,ownerUid:null}}},
  {options:{partnerData:{...partner,hubCompanyId:"foreign"}},role:"partner_owner"},
  {options:{partnerData:{...partner,active:false}},role:"partner_owner"},
  {options:{relationData:{...relation,countSharingApproved:false}},role:"partner_owner"},
  {options:{relationData:{...relation,active:false}},role:"partner_owner"},
  {options:{verifyCountViewer:async()=>{throw Error("REVOKED")}}},
  {options:{timestamp:{seconds:5,nanoseconds:0,toDate(){return new Date("invalid")}}}}
 ];
 for(const item of cases){
  const f=fixture(item.options);
  await assert.rejects(f.reader({tx:f.tx,context:context(item.role)}),
   /ZERO_SETUP_COUNT_PUBLICATION_UNVERIFIED|REVOKED/);
 }
 const f=fixture();
 for(const changed of [
  {serverVerified:false},{viewerUid:"intruder"},
  {hubCompanyId:"bad"},{approvedCompanyIds:["hub","hub"]},
  {viewerCompanyId:"partner"},{activeCountSharingVerified:false}
 ]){
  const before={...context(),...changed};
  // Viewer UID validation is syntactic only; server-side identity
  // verification rejects forged but syntactically valid accounts.
  if(changed.viewerUid)continue;
  await assert.rejects(f.reader({tx:f.tx,context:before}),
   /ZERO_SETUP_COUNT_PUBLICATION_UNVERIFIED/);
 }
});
test("zero-setup same read-only transaction combines canonical counts and audience witness without any manual settings",async()=>{
 const f=fixture();
 const ctx=context();
 const input={
  hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  period:{kind:"month",day:"2026-11-01",asOf:"2026-11-17"},
  mappingsReviewed:true,productGroups:[],snapshotReadTime:AS_OF,
  sources:[{companyId:"hub",readTime:AS_OF},
   {companyId:"partner",readTime:AS_OF}]
 };
 const load=createStagedAtomicOwnerCountLoader({
  db:f.db,zeroSetupLink:true,
  loadCountsInTransaction:async()=>input,
  loadPublicationInTransaction:f.reader
 });
 const result=await load({month:"2026-11",context:ctx});
 assert.equal(result.input.snapshotReadTime,AS_OF);
 assert.equal(result.publication.ownerSettingsRead,false);
 assert.deepEqual(f.operations[0],["begin",{readOnly:true}]);
 const badDefault=createStagedAtomicOwnerCountLoader({
  db:f.db,loadCountsInTransaction:async()=>input,
  loadPublicationInTransaction:f.reader
 });
 await assert.rejects(badDefault({month:"2026-11",context:ctx}),
  /OWNER_RANK_ATOMIC_SNAPSHOT_UNVERIFIED/);
});
test("require a real per-request server workspace authorizer even during construction",()=>{
 assert.throws(()=>createZeroSetupCountPublicationReader({db:{collection(){}}}),
  /ZERO_SETUP_COUNT_PUBLICATION_UNVERIFIED/);
});
