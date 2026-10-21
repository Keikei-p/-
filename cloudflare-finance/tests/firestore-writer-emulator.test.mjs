import {test} from "node:test";
import assert from "node:assert/strict";
import {makeFirestoreRestStore} from "../src/firestore-writer.js";
import {SaveConflict} from "../src/count-service.js";

// This test is forbidden outside the local Firestore emulator.
const host=process.env.FIRESTORE_EMULATOR_HOST||"";
if(!/^(localhost|127\.0\.0\.1):[0-9]{2,5}$/.test(host))throw Error("local_firestore_emulator_required");
const livePrefix="https://firestore.googleapis.com/v1/projects/sales-management-cc116/databases/(default)";
const fakeRoot="http://"+host+"/v1/projects/demo-finance-staging/databases/(default)";
const controlledFetch=async (url,options)=>{
  if(typeof url!=="string" || !url.startsWith(livePrefix))throw Error("nonlocal_test_call_blocked");
  // The transaction transport's production address is redirected to a DEMO
  // emulator database, with absolutely no live project credentials involved.
  const local=fakeRoot+url.slice(livePrefix.length);
  return fetch(local,{...options,headers:{"Content-Type":"application/json"}});
};
const store=makeFirestoreRestStore({FIREBASE_PROJECT_ID:"sales-management-cc116"},
  {token:async()=>"emulator-fixture",fetcher:controlledFetch});
const get=async relative=>{
  const response=await fetch(fakeRoot+"/documents/"+relative);
  assert.equal(response.status,200);
  return response.json();
};
test("real emulator commit creates exactly one daily record without changing other data",async()=>{
  const recId="demo_staff_2026-10-22";
  const data={companyId:"demo",uid:"staff",date:"2026-10-22",teamId:"A",
    teamNameSnapshot:"A班",memberNameSnapshot:"社員",
    workLocation:"試験会場",results:{sim__cb_0:{productId:"sim",count:2,
      cashback:0,revenuePerUnit:10000}},totalCount:2,totalRevenue:20000,
    createdAt:"fixture",updatedAt:"fixture",reportedAt:"fixture",
    createdByUid:"owner",updatedByUid:"owner",reportStatus:"submitted"};
  await store.runTransaction(async tx=>{
    assert.equal(await tx.get("records/"+recId),null);
    tx.saveRecord(recId,data,null);
  });
  const live=await get("records/"+recId);
  assert.equal(live.fields.totalCount.integerValue,"2");
  assert.equal(live.fields.totalRevenue.integerValue,"20000");
  assert.equal(live.fields.results.mapValue.fields.sim__cb_0.mapValue.fields.revenuePerUnit.integerValue,"10000");
  assert("timestampValue" in live.fields.createdAt);
  assert("timestampValue" in live.fields.updatedAt);
  assert("timestampValue" in live.fields.reportedAt);
});
test("real emulator correction preserves createdAt and stores before/after audit atomically",async()=>{
  const recId="demo_staff_2026-10-22";
  const previous=await get("records/"+recId);
  const oldCreated=previous.fields.createdAt.timestampValue;
  const oldVersion=previous.updateTime;
  await store.runTransaction(async tx=>{
    const old=await tx.get("records/"+recId);
    assert.equal(old.__firestoreUpdateTime,oldVersion);
    const revised={...old,totalCount:3,totalRevenue:30000,
      results:{sim__cb_0:{productId:"sim",count:3,
        cashback:0,revenuePerUnit:10000}},
      updatedAt:"not-client-controlled",reportedAt:"not-client-controlled"};
    tx.saveRecord(recId,revised,oldVersion);
    tx.addCorrection("c0ffee00-2222-4444-8888-abcdef012345",{
      companyId:"demo",recordId:recId,recordUid:"staff",recordDate:"2026-10-22",
      changedByUid:"owner",changedByName:"オーナー",
      before:{totalRevenue:20000,totalCount:2},
      after:{totalRevenue:30000,totalCount:3}
    });
  });
  const updated=await get("records/"+recId);
  const audit=await get("recordCorrections/c0ffee00-2222-4444-8888-abcdef012345");
  assert.equal(updated.fields.totalRevenue.integerValue,"30000");
  assert.equal(updated.fields.createdAt.timestampValue,oldCreated);
  assert.equal(audit.fields.before.mapValue.fields.totalRevenue.integerValue,"20000");
  assert.equal(audit.fields.after.mapValue.fields.totalRevenue.integerValue,"30000");
});
test("stale edits cannot rewrite history and cannot append invalid correction",async()=>{
  const recordId="demo_staff_2026-10-22";
  const prev=await get("records/"+recordId);
  await assert.rejects(store.runTransaction(async tx=>{
    const record=await tx.get("records/"+recordId);
    tx.saveRecord(recordId,{...record,totalCount:777,totalRevenue:777000},
      "2000-01-01T00:00:00.000000Z");
    tx.addCorrection("c0ffee00-2222-4444-8888-abcdef012346",{
      companyId:"demo",recordId,recordUid:"staff",recordDate:"2026-10-22",
      before:{totalRevenue:30000},after:{totalRevenue:777000}
    });
  }),SaveConflict);
  const after=await get("records/"+recordId);
  assert.equal(after.fields.totalRevenue.integerValue,"30000");
  assert.equal(after.updateTime,prev.updateTime);
  const missing=await fetch(fakeRoot+"/documents/recordCorrections/c0ffee00-2222-4444-8888-abcdef012346");
  assert.equal(missing.status,404);
});
