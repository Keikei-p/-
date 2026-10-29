import {test} from "node:test";
import assert from "node:assert/strict";
import {PROJECT} from "./backup.mjs";
import {TEST_PROJECT,emulatorBase,restoreToLocalEmulator} from "./restore-emulator.mjs";

const snapshot=()=>({
  projectId:PROJECT,format:"firestore-rest-typed-v1",
  documents:[
    {path:"records/synthetic-one",value:{
      fields:{totalCount:{integerValue:"5"},results:{mapValue:{fields:{
        synthetic:{mapValue:{fields:{count:{integerValue:"5"},revenuePerUnit:{integerValue:"20000"}}}}
      }}}},
      createTime:"2026-10-01T00:00:00Z",updateTime:"2026-10-28T00:00:00Z"}},
    {path:"companies/test/members/tester",value:{
      fields:{active:{booleanValue:true},teamHistory:{arrayValue:{values:[{stringValue:"team-a"}]}}},
      createTime:"2026-10-01T00:00:00Z",updateTime:"2026-10-28T00:00:00Z"}}
  ]
});
const params={emulatorHost:"127.0.0.1:8080",projectId:TEST_PROJECT};
function mock(){
  const calls=[];
  const memory=new Map();
  const send=async(url,options)=>{
    calls.push({url,method:options.method});
    if(options.method==="PATCH"){
      const fields=JSON.parse(options.body).fields;
      memory.set(url,fields);
      return {ok:true,json:async()=>({fields})};
    }
    if(options.method==="GET"){
      const fields=memory.get(url);
      return fields?{ok:true,json:async()=>({fields})}:{ok:false};
    }
    throw Error("Unexpected emulator method");
  };
  return {send,calls};
}
test("no cloud endpoint or production project can be selected",()=>{
  for(const host of [
    "",undefined,"firestore.googleapis.com:443","localhost:8080","192.168.1.4:8080",
    "127.0.0.1:8080@evil.example","127.0.0.1:8080/path",
    "https://127.0.0.1:8080","127.0.0.1:65536","127.0.0.1:0"
  ])assert.throws(()=>emulatorBase(host,TEST_PROJECT),/BLOCK/);
  assert.throws(()=>emulatorBase("127.0.0.1:8080",PROJECT),/BLOCK/);
  assert.match(emulatorBase("127.0.0.1:8080",TEST_PROJECT),/^http:\/\/127\.0\.0\.1:8080\/v1\/projects\/demo-sales-restore\//);
});
test("synthetic fields and original paths round-trip only through demo emulator URL",async()=>{
  const m=mock(),before=JSON.stringify(snapshot());
  const result=await restoreToLocalEmulator(snapshot(),{...params,send:m.send});
  assert.equal(result.documentCount,2);
  assert.equal(result.destinationProject,TEST_PROJECT);
  assert.equal(result.fieldsAndIdsVerified,true);
  assert.equal(result.metadataTimestampsPreserved,false);
  assert.equal(result.productionTouched,false);
  assert.equal(result.sourceInventoryFingerprint.length,64);
  assert.equal(m.calls.length,4);
  assert(m.calls.every(x=>x.url.startsWith("http://127.0.0.1:8080/v1/projects/demo-sales-restore/")));
  assert.deepEqual(m.calls.map(x=>x.method),["PATCH","PATCH","GET","GET"]);
  assert.equal(JSON.stringify(snapshot()),before);
});
test("validation fails before any emulator write on malformed or duplicate archive paths",async()=>{
  const bads=[
    {documents:[{...snapshot().documents[0],path:"records/one/deep"}]},
    {documents:[...snapshot().documents,snapshot().documents[0]]},
    {documents:[{...snapshot().documents[0],path:"records/../one"}]},
    {documents:[{...snapshot().documents[0],value:{fields:null}}]},
  ];
  for(const item of bads){
    const m=mock();
    await assert.rejects(restoreToLocalEmulator({...snapshot(),...item},{...params,send:m.send}),/BLOCK|duplicate/i);
    assert.equal(m.calls.length,0,"must check ALL documents before any writes");
  }
});
test("strict maxDocuments guard blocks partial restore before writing",async()=>{
  const m=mock();
  await assert.rejects(restoreToLocalEmulator(snapshot(),{...params,maxDocuments:1,send:m.send}),/BLOCK/);
  assert.equal(m.calls.length,0);
});
test("REST write or readback mismatches are always reported without exposing private data",async()=>{
  const m=mock(),broken=async(url,options)=>{
    const result=await m.send(url,options);
    if(options.method==="GET")return {ok:true,json:async()=>({fields:{tampered:{booleanValue:true}}})};
    return result;
  };
  await assert.rejects(restoreToLocalEmulator(snapshot(),{...params,send:broken}),err=>
    /emulator readback fields differ/.test(err.message)&&
    !err.message.includes("revenuePerUnit")&&!err.message.includes("20000"));
  assert.equal(m.calls.every(c=>!c.url.includes("sales-management-cc116")),true);
});
