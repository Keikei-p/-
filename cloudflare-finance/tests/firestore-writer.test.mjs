import {test} from "node:test";
import assert from "node:assert/strict";
import {makeFirestoreRestStore} from "../src/firestore-writer.js";
import {SaveConflict} from "../src/count-service.js";
function mockServer({failCommit=false}={}){
  const events=[];
  const root="https://firestore.googleapis.com/v1/projects/sales-management-cc116/databases/(default)";
  function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});}
  const fetcher=async(url,opts)=>{
    const path=url.split("?")[0];
    events.push({path,method:opts.method||"GET",data:opts.body?JSON.parse(opts.body):null});
    if(path===root+"/documents:beginTransaction")
      return response({transaction:"test-transaction-id"});
    if(path.includes("/documents/users/worker")){
      return response({name:root+"/documents/users/worker",
        updateTime:"2026-10-01T00:00:00.000Z",
        fields:{uid:{stringValue:"worker"},companyId:{stringValue:"factory"},active:{booleanValue:true}}});
    }
    if(path===root+"/documents:runQuery"){
      return response([{document:{name:root+"/documents/products/sim",
        updateTime:"2026-10-02T00:00:00.000Z",
        fields:{companyId:{stringValue:"factory"},name:{stringValue:"SIM"},revenue:{integerValue:"9000"}}}}]);
    }
    if(path===root+"/documents:commit"){
      if(failCommit)return response({error:{message:"stale version"}},412);
      return response({writeResults:JSON.parse(opts.body).writes.map(()=>({updateTime:"2026-10-22T01:00:00.000Z"}))});
    }
    if(path===root+"/documents:rollback")return response({});
    throw Error("Unexpected call: "+path);
  };
  const store=makeFirestoreRestStore({FIREBASE_PROJECT_ID:"sales-management-cc116"},
    {token:async()=>"fake",fetcher});
  return {store,events};
}
test("create writes one deterministic record with exists=false and server timestamps",async()=>{
  const {store,events}=mockServer();
  const answer=await store.runTransaction(async tx=>{
    const actor=await tx.get("users/worker");
    assert.equal(actor.uid,"worker");
    const products=await tx.queryProducts("factory");
    assert.equal(products[0].revenue,9000);
    tx.saveRecord("factory_worker_2026-10-22",{
      companyId:"factory",uid:"worker",date:"2026-10-22",teamId:"A",
      results:{sim__cb_0:{count:2,productId:"sim",revenuePerUnit:9000}},
      totalCount:2,totalRevenue:18000,
      createdAt:"SHOULD_BE_SERVER_TIME",updatedAt:"SHOULD_BE_SERVER_TIME",
      reportedAt:"SHOULD_BE_SERVER_TIME"
    },null);
    return "stored";
  });
  assert.equal(answer,"stored");
  const commit=events.find(x=>x.path.endsWith("/documents:commit"));
  assert(commit);
  assert.equal(commit.data.writes.length,1);
  const write=commit.data.writes[0];
  assert.deepEqual(write.currentDocument,{exists:false});
  assert.equal(write.update.fields.totalRevenue.integerValue,"18000");
  assert.equal(write.update.fields.createdAt,undefined);
  assert.equal(write.update.fields.updatedAt,undefined);
  assert.deepEqual(write.updateTransforms.map(x=>x.fieldPath).sort(),
    ["createdAt","reportedAt","updatedAt"]);
  assert.equal(events.filter(x=>x.path.endsWith("/documents:commit")).length,1);
});
test("correction and append-only audit use same transaction with immutable old data",async()=>{
  const {store,events}=mockServer();
  await store.runTransaction(async tx=>{
    const user=await tx.get("users/worker");
    assert.equal(user.__firestoreUpdateTime,"2026-10-01T00:00:00.000Z");
    tx.saveRecord("legacy-original",{
      companyId:"factory",uid:"worker",date:"2026-10-22",
      results:{sim__cb_0:{count:3,productId:"sim",revenuePerUnit:9000}},
      totalCount:3,totalRevenue:27000,
      createdAt:"ORIGINAL_TIMESTAMP_MUST_SURVIVE",
      createdByUid:"original-owner",updatedAt:"NEW",
      reportedAt:"NEW"
    },"2026-10-01T00:00:00.000Z");
    tx.addCorrection("abddccff-1234-5678-9abc-0123456789ab",{
      companyId:"factory",recordId:"legacy-original",recordUid:"worker",recordDate:"2026-10-22",
      before:{totalCount:1,totalRevenue:9000},after:{totalCount:3,totalRevenue:27000},
      changedByUid:"worker",changedByName:"worker"
    });
  });
  const c=events.find(e=>e.path.endsWith("/documents:commit"));
  assert(c);
  assert.equal(c.data.writes.length,2);
  assert.equal(c.data.transaction,"test-transaction-id");
  assert.deepEqual(c.data.writes[0].currentDocument,{updateTime:"2026-10-01T00:00:00.000Z"});
  assert.equal(c.data.writes[0].update.fields.createdAt,undefined);
  assert.equal(c.data.writes[0].updateMask.fieldPaths.includes("createdAt"),false);
  assert.equal(c.data.writes[0].update.fields.createdByUid.stringValue,"original-owner");
  assert.equal(c.data.writes[1].currentDocument.exists,false);
  assert.equal(c.data.writes[1].update.fields.before.mapValue.fields.totalRevenue.integerValue,"9000");
  assert.equal(c.data.writes[1].update.fields.after.mapValue.fields.totalRevenue.integerValue,"27000");
  assert.deepEqual(c.data.writes[1].updateTransforms.map(x=>x.fieldPath),["createdAt"]);
});
test("stale commit fails with a conflict, no repeated commit and no deletion",async()=>{
  const {store,events}=mockServer({failCommit:true});
  await assert.rejects(store.runTransaction(async tx=>{
    tx.saveRecord("record",{companyId:"factory",uid:"worker",date:"2026-10-22",totalRevenue:20000},
      "2026-10-21T00:00:00.000Z");
  }),SaveConflict);
  assert.equal(events.filter(x=>x.path.endsWith("/documents:commit")).length,1);
  assert.equal(events.some(x=>x.method==="DELETE"),false);
});
test("no read or unexpected write after a pending record mutation",async()=>{
  const {store,events}=mockServer();
  await assert.rejects(store.runTransaction(async tx=>{
    tx.saveRecord("record",{totalCount:0,totalRevenue:0},null);
    await tx.get("users/worker");
  }),/read_after_write_staged/);
  assert.equal(events.some(x=>x.path.endsWith("/documents:commit")),false);
});
test("writes cannot target an unknown Firebase project",()=>{
  assert.throws(()=>makeFirestoreRestStore({FIREBASE_PROJECT_ID:"another-project"},{token:async()=>""}),/wrong_project/);
});
