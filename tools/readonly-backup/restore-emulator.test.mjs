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
      // Simulate Firestore's create-only precondition, not a blind upsert.
      assert(url.endsWith("?currentDocument.exists=false"));
      const destination=url.slice(0,-"?currentDocument.exists=false".length);
      if(memory.has(destination))return {ok:false,status:412};
      const fields=JSON.parse(options.body).fields;
      memory.set(destination,fields);
      return {ok:true,status:200,json:async()=>({fields})};
    }
    if(options.method==="GET"){
      const fields=memory.get(url);
      return fields?{ok:true,status:200,json:async()=>({fields})}:{ok:false,status:404};
    }
    throw Error("Unexpected emulator method");
  };
  return {send,calls,memory};
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
  assert.equal(m.calls.length,6);
  assert(m.calls.every(x=>x.url.startsWith("http://127.0.0.1:8080/v1/projects/demo-sales-restore/")));
  assert.deepEqual(m.calls.map(x=>x.method),["GET","GET","PATCH","PATCH","GET","GET"]);
  assert(m.calls.filter(x=>x.method==="PATCH")
    .every(x=>x.url.endsWith("?currentDocument.exists=false")));
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
    if(options.method==="GET"&&result.ok)
      return {ok:true,status:200,json:async()=>({fields:{tampered:{booleanValue:true}}})};
    return result;
  };
  await assert.rejects(restoreToLocalEmulator(snapshot(),{...params,send:broken}),err=>
    /emulator readback fields differ/.test(err.message)&&
    !err.message.includes("revenuePerUnit")&&!err.message.includes("20000"));
  assert.equal(m.calls.every(c=>!c.url.includes("sales-management-cc116")),true);
});

test("25,001 synthetic documents roundtrip without the old 10,000 limit",async()=>{
  const documents=Array.from({length:25001},(_,i)=>({
    path:"records/synthetic-"+String(i).padStart(6,"0"),
    value:{fields:{totalCount:{integerValue:String(i%10)}},
      createTime:"2026-10-01T00:00:00Z",
      updateTime:"2026-10-28T00:00:00Z"}
  }));
  const large={projectId:PROJECT,format:"firestore-rest-typed-v1",documents};
  const m=mock();
  const result=await restoreToLocalEmulator(large,{...params,send:m.send});
  assert.equal(result.documentCount,25001);
  assert.equal(result.fieldsAndIdsVerified,true);
  assert.equal(m.calls.length,75003);
  assert(m.calls.slice(0,25001).every(c=>c.method==="GET"));
  assert(m.calls.slice(25001,50002).every(c=>c.method==="PATCH"));
  assert(m.calls.slice(50002).every(c=>c.method==="GET"));
  assert(m.calls.every(c=>c.url.includes("/demo-sales-restore/")));
  assert.equal(result.productionTouched,false);
});
test("a 50,001 document archive is blocked before any writes",async()=>{
  const value={fields:{totalCount:{integerValue:"0"}}};
  const base={projectId:PROJECT,format:"firestore-rest-typed-v1"};
  const tooMany={...base,documents:Array.from({length:50001},(_,i)=>({
    path:"records/overflow-"+i,value
  }))};
  const m=mock();
  await assert.rejects(restoreToLocalEmulator(tooMany,{...params,send:m.send}),/BLOCK/);
  assert.equal(m.calls.length,0);
});

test("nonempty local target must abort all writes before restoring any document",async()=>{
 const m=mock();
 const endpoint=emulatorBase(params.emulatorHost,TEST_PROJECT)+"records/synthetic-one";
 m.memory.set(endpoint,{totalCount:{integerValue:"999"}});
 const old=JSON.stringify([...m.memory]);
 await assert.rejects(restoreToLocalEmulator(snapshot(),{...params,send:m.send}),/BLOCK: emulator destination/);
 assert(m.calls.length>0);
 assert(m.calls.every(c=>c.method==="GET"),"no PATCH on a nonempty target");
 assert.equal(JSON.stringify([...m.memory]),old,"existing test data must not be overwritten");
});
test("preflight fails closed on permission errors, server faults and redirects before local writes",async()=>{
 for(const status of [200,301,401,403,429,500]){
  const m=mock();
  const refused=async(url,options)=>options.method==="GET"?
   {status,ok:false}:m.send(url,options);
  await assert.rejects(restoreToLocalEmulator(snapshot(),{...params,send:refused}),/BLOCK: emulator destination/);
  assert(m.calls.every(c=>c.method!=="PATCH"));
 }
});

test("concurrent local document creation after empty preflight cannot be overwritten",async()=>{
 const m=mock(),first=emulatorBase(params.emulatorHost,TEST_PROJECT)+"records/synthetic-one";
 const incumbent={totalCount:{integerValue:"777"}};
 let raceTriggered=false;
 const concurrent=async(url,options)=>{
  if(options.method==="PATCH"&&url.startsWith(first+"?")&&!raceTriggered){
   // A different process creates the document after all preflight GETs.
   m.memory.set(first,incumbent);
   raceTriggered=true;
  }
  return m.send(url,options);
 };
 await assert.rejects(
  restoreToLocalEmulator(snapshot(),{...params,send:concurrent}),
  /BLOCK: emulator restore write\/verification failed/
 );
 assert.equal(raceTriggered,true);
 assert.deepEqual(m.memory.get(first),incumbent,
  "create-only conditional PATCH must not replace a concurrently created document");
 assert(m.calls.filter(x=>x.method==="PATCH")
  .every(x=>x.url.endsWith("?currentDocument.exists=false")));
});
