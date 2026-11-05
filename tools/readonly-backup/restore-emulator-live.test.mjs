import test from "node:test";
import assert from "node:assert/strict";
import {restoreToLocalEmulator,emulatorBase,TEST_PROJECT}
  from "./restore-emulator.mjs";
import {PROJECT} from "./backup.mjs";

// Run only through Firebase Emulator under demo-sales-restore.
// No service-account input or production Firebase endpoints.
const host=process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(process.env.GCLOUD_PROJECT,TEST_PROJECT,"never test against production");
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,TEST_PROJECT,"never test against production");
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||"","");
const base=emulatorBase(host,TEST_PROJECT);
const original=()=>({
  projectId:PROJECT,format:"firestore-rest-typed-v1",
  documents:[
    {path:"records/synthetic-conditional-restore",value:{
      fields:{totalCount:{integerValue:"3"},totalRevenue:{integerValue:"120000"},
        results:{mapValue:{fields:{demo:{mapValue:{fields:{
          count:{integerValue:"3"},revenuePerUnit:{integerValue:"40000"}
        }}}}}}
      }
    }},
    {path:"companies/synthetic-rehearsal/members/tester",value:{
      fields:{active:{booleanValue:true},teamId:{stringValue:"team-test"}}
    }}
  ]
});
const auth={"Authorization":"Bearer owner"};
async function read(path){
  const r=await fetch(base+path,{method:"GET",redirect:"error",headers:auth});
  assert.equal(r.status,200);
  return (await r.json()).fields;
}

test("real Firestore emulator restores typed sales fields once, checks exact readback and forbids subsequent overwrite",async()=>{
 const s=original();
 const first=await restoreToLocalEmulator(s,{emulatorHost:host,projectId:TEST_PROJECT});
 assert.equal(first.productionTouched,false);
 assert.equal(first.documentCount,2);
 assert.equal(first.fieldsAndIdsVerified,true);
 assert.deepEqual(await read("records/synthetic-conditional-restore"),
   s.documents[0].value.fields);
 assert.deepEqual(await read("companies/synthetic-rehearsal/members/tester"),
   s.documents[1].value.fields);
 const before=await read("records/synthetic-conditional-restore");
 await assert.rejects(
   restoreToLocalEmulator(s,{emulatorHost:host,projectId:TEST_PROJECT}),
   /BLOCK: emulator destination is not proven empty/
 );
 assert.deepEqual(await read("records/synthetic-conditional-restore"),before);
});

test("real Firestore REST create-only precondition rejects TOCTOU race without overwriting competitor",async()=>{
 const path="records/synthetic-restore-raced",url=base+path;
 const initial={totalCount:{integerValue:"1"}};
 const incumbent={totalCount:{integerValue:"77"}};
 const s={projectId:PROJECT,format:"firestore-rest-typed-v1",
   documents:[{path,value:{fields:initial}}]};
 let created=false;
 const send=async(endpoint,options)=>{
   if(!created&&options.method==="PATCH"){
     assert.equal(endpoint,url+"?currentDocument.exists=false");
     // Simulate another local process creating the same ID after the
     // GET-404 preflight but before our conditional PATCH.
     const competitor=await fetch(url,{method:"PATCH",redirect:"error",headers:{
       ...auth,"Content-Type":"application/json"
     },body:JSON.stringify({fields:incumbent})});
     assert.equal(competitor.ok,true);
     created=true;
   }
   return fetch(endpoint,options);
 };
 await assert.rejects(restoreToLocalEmulator(s,{
   emulatorHost:host,projectId:TEST_PROJECT,send
 }),/BLOCK: emulator restore write\/verification failed/);
 assert.equal(created,true);
 assert.deepEqual(await read(path),incumbent,
   "create-only PATCH must leave the competitor's preexisting document intact");
});
