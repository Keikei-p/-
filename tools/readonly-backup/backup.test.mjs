import {test} from "node:test";
import assert from "node:assert/strict";
import {collect,canonical,fingerprint,seal,unseal,PROJECT,validateSafeCall} from "./backup.mjs";

const root="projects/"+PROJECT+"/databases/(default)/documents";
const valid=(path,fields={count:{integerValue:"2"}})=>({
  name:root+"/"+path,fields,createTime:"2026-10-01T00:00:00Z",
  updateTime:"2026-10-02T00:00:00Z"
});
test("strict API allowlist permits only read-only Firestore calls",()=>{
  const list="https://firestore.googleapis.com/v1/"+root+"/records?pageSize=100&showMissing=true";
  const ids="https://firestore.googleapis.com/v1/"+root+":listCollectionIds";
  assert.equal(validateSafeCall("GET",list),true);
  assert.equal(validateSafeCall("POST",ids,{pageSize:100}),true);
  assert.equal(validateSafeCall("POST",list,{foo:"data"}),false);
  assert.equal(validateSafeCall("POST",ids,{delete:true}),false);
  assert.equal(validateSafeCall("PATCH",list),false);
  assert.equal(validateSafeCall("DELETE",list),false);
  assert.equal(validateSafeCall("GET","https://evil.example/v1/"+root+"/records"),false);
  assert.equal(validateSafeCall("GET",list+"&mask.fieldPaths=count"),false);
});
test("collect traverses paginated roots and missing-parent subcollections",async()=>{
  const calls=[];
  async function fake(method,url,body){
    calls.push({method,url,body});
    const u=new URL(url),p=decodeURIComponent(u.pathname.slice("/v1/".length));
    if(method==="POST"){
      if(p===root+":listCollectionIds")return {collectionIds:["records"],nextPageToken:""};
      if(p===root+"/records/missing:listCollectionIds")return {collectionIds:["nested"]};
      if(p.endsWith(":listCollectionIds"))return {};
      throw Error("unexpected POST");
    }
    if(p===root+"/records"){
      if(!u.searchParams.get("pageToken"))return {documents:[valid("records/id1"),{name:root+"/records/missing"}],nextPageToken:"next"};
      return {documents:[valid("records/id2")]};
    }
    if(p===root+"/records/missing/nested")return {documents:[valid("records/missing/nested/child")]};
    throw Error("Unexpected GET "+p);
  }
  const snap=await collect(fake,{maxDocuments:10});
  assert.equal(snap.documents.length,3);
  assert.deepEqual(snap.documents.map(x=>x.path),["records/id1","records/id2","records/missing/nested/child"]);
  assert.equal(snap.documents[0].value.fields.count.integerValue,"2");
  assert.ok(calls.every(x=>validateSafeCall(x.method,x.url,x.body)));
});
test("read quota guard blocks partial archives",async()=>{
  const fake=async(method,url)=>{
    if(method==="POST")return url.endsWith(root+":listCollectionIds")?{collectionIds:["records"]}:{};
    return {documents:[valid("records/a"),valid("records/b")]};
  };
  await assert.rejects(collect(fake,{maxDocuments:1}),/budget exceeded/);
});
test("malformed paths or duplicate pages block",async()=>{
  const fake=async(method,url)=>{
    if(method==="POST")return url.endsWith(root+":listCollectionIds")?{collectionIds:["records"]}:{};
    return {documents:[{...valid("records/a"),name:"projects/elsewhere/databases/(default)/documents/records/a"}]};
  };
  await assert.rejects(collect(fake,{maxDocuments:10}),/Invalid document path/);
});
test("typed Firestore integers and array order survive encryption",()=>{
  const before={projectId:PROJECT,format:"firestore-rest-typed-v1",
    documents:[{path:"records/a",value:{fields:{
      big:{integerValue:"9007199254740993"},
      rows:{arrayValue:{values:[{integerValue:"1"},{integerValue:"2"}]}}
    },createTime:"2026-10-01T00:00:00Z",updateTime:"2026-10-01T00:00:00Z"}}]};
  const pass="very-long-test-only-secret-phrase-abc";
  const ciphertext=seal(before,pass);
  assert.ok(!ciphertext.toString().includes("9007199254740993"));
  const reopened=unseal(ciphertext,pass);
  assert.deepEqual(reopened,before);
  assert.equal(fingerprint(before),fingerprint(reopened));
  assert.notEqual(fingerprint(before),fingerprint({...before,documents:[{...before.documents[0],value:{...before.documents[0].value,updateTime:"2026-10-03T00:00:00Z"}}]}));
});
test("tampering or wrong passphrase always fails",()=>{
  const snap={projectId:PROJECT,format:"firestore-rest-typed-v1",documents:[]};
  const ciphertext=seal(snap,"very-long-test-only-secret-phrase-abc");
  assert.throws(()=>unseal(ciphertext,"very-long-test-only-secret-phrase-xyz"));
  const tampered=Buffer.from(ciphertext);
  tampered[tampered.length-1]^=1;
  assert.throws(()=>unseal(tampered,"very-long-test-only-secret-phrase-abc"));
});
test("fingerprint is stable for object field order, not array order",()=>{
  assert.equal(canonical({y:2,x:1}),canonical({x:1,y:2}));
  assert.notEqual(canonical([2,1]),canonical([1,2]));
});
