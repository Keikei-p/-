import {test} from "node:test";
import assert from "node:assert/strict";
import {PROJECT} from "./backup.mjs";
import {restoreToLocalEmulator,TEST_PROJECT} from "./restore-emulator.mjs";

// Requires firebase emulators:exec --only firestore --project demo-sales-restore
// No credentials or remote API can be used by restoreToLocalEmulator.
test("real localhost Firestore emulator stores exactly the fixture's fields and IDs",async()=>{
 const snapshot={
  projectId:PROJECT,format:"firestore-rest-typed-v1",
  documents:[
   {path:"records/synthetic-count",value:{
     fields:{totalCount:{integerValue:"5"},results:{mapValue:{fields:{
       mock:{mapValue:{fields:{count:{integerValue:"5"},revenuePerUnit:{integerValue:"20000"}}}}
     }}}},
     createTime:"2026-10-01T00:00:00Z",updateTime:"2026-10-28T00:00:00Z"}},
   {path:"companies/synthetic/members/tester",value:{
     fields:{active:{booleanValue:true},teamHistory:{arrayValue:{values:[{stringValue:"t1"}]}}},
     createTime:"2026-10-01T00:00:00Z",updateTime:"2026-10-28T00:00:00Z"}}
  ]
 };
 const result=await restoreToLocalEmulator(snapshot,{
  emulatorHost:process.env.FIRESTORE_EMULATOR_HOST,
  projectId:TEST_PROJECT,
  maxDocuments:2
 });
 assert.equal(result.documentCount,2);
 assert.equal(result.fieldsAndIdsVerified,true);
 assert.equal(result.productionTouched,false);
 assert.equal(result.metadataTimestampsPreserved,false);
});
