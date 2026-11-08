import test from "node:test";
import assert from "node:assert/strict";
import {createStagedAtomicOwnerCountLoader}
 from "../ranking/owner-visible-count-atomic-loader.mjs";

const TIME="2026-11-09T00:00:00Z";
const context={serverVerified:true,hubCompanyId:"hub",viewerUid:"owner",
 approvedCompanyIds:["hub","partner"]};
function fixture(){
 const calls=[],db={runTransaction:async(fn,options)=>{
  calls.push(["transaction",options]);
  return fn({get:async key=>{calls.push(["get",key]);return TIME;}});
 }};
 const input={hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  period:{kind:"month",day:"2026-11-01",asOf:"2026-11-09"},
  mappingsReviewed:true,productGroups:[],snapshotReadTime:TIME,
  sources:[{companyId:"hub",readTime:TIME},
   {companyId:"partner",readTime:TIME}]};
 const publication={serverVerified:true,ownerSettingsRead:true,
  ownerUidVerified:true,productMappingsReviewed:true,revision:2,
  hubCompanyId:"hub",snapshotReadTime:TIME,
  enabledHubProductIds:[],partnerOverrides:[]};
 const loader=(overrides={})=>createStagedAtomicOwnerCountLoader({
  db,loadCountsInTransaction:async({tx})=>{
   await tx.get("counts");return {...input,...overrides.input};
  },loadPublicationInTransaction:async({tx})=>{
   await tx.get("publication");return {...publication,...overrides.publication};
  }
 });
 return {calls,loader,input,publication};
}
test("counts and owner settings use the same read-only transaction",async()=>{
 const f=fixture();
 const result=await f.loader()({month:"2026-11",context});
 assert.equal(result.input.snapshotReadTime,TIME);
 assert.equal(result.publication.revision,2);
 assert.deepEqual(f.calls,[
  ["transaction",{readOnly:true}],["get","counts"],["get","publication"]
 ]);
});
test("reject mixed snapshot timestamps and incomplete company sets",async()=>{
 for(const changes of [
  {input:{snapshotReadTime:"2026-11-09T00:00:01Z"}},
  {publication:{snapshotReadTime:"2026-11-09T00:00:01Z"}},
  {input:{sources:[{companyId:"hub",readTime:TIME},
   {companyId:"partner",readTime:"2026-11-09T00:00:01Z"}]}},
  {input:{approvedCompanyIds:["hub"]}},
  {input:{sources:[{companyId:"hub",readTime:TIME},
   {companyId:"hub",readTime:TIME}]}},
  {input:{mappingsReviewed:false}},
  {publication:{ownerUidVerified:false}},
  {publication:{revision:0}}
 ]){
  const f=fixture();
  await assert.rejects(f.loader(changes)({month:"2026-11",context}),
   /OWNER_RANK_ATOMIC_SNAPSHOT_UNVERIFIED/);
  assert.equal(f.calls[0][1].readOnly,true);
 }
});
test("never start Firestore reads for forged context or invalid month",async()=>{
 const f=fixture();
 await assert.rejects(f.loader()({month:"2026-13",context}),
  /OWNER_RANK_ATOMIC_SNAPSHOT_UNVERIFIED/);
 await assert.rejects(f.loader()({month:"2026-11",
  context:{...context,serverVerified:false}}),
  /OWNER_RANK_ATOMIC_SNAPSHOT_UNVERIFIED/);
 assert.equal(f.calls.length,0);
});
