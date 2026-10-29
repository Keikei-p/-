import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,linkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {captureReadOnlyFirestore} from "../scripts/firestore-readonly-snapshot.mjs";
import {verifySnapshotPair} from "../scripts/verify-firestore-snapshot-pair.mjs";
const projectId="sales-management-cc116";
const makeReader=()=>({
 listRootCollections:async()=>["records"],
 listDocuments:async()=>["record1"],
 getDocument:async()=>({exists:true,data:{
  companyId:"co1",uid:"u1",totalCount:5,totalRevenue:50000,
  results:{NURO:{count:5,revenuePerUnit:10000}}
 }}),
 listSubcollections:async()=>[]
});
const temp=()=>mkdtempSync(join(tmpdir(),"nico-readonly-backup-"));
test("two independent copies validate identical data without accessing Firestore",async()=>{
 const dir=temp();
 try{
  const backup=await captureReadOnlyFirestore({reader:makeReader(),projectId});
  const a=join(dir,"a.json"),b=join(dir,"b.json");
  writeFileSync(a,JSON.stringify(backup));
  writeFileSync(b,JSON.stringify(backup));
  const result=await verifySnapshotPair(a,b);
  assert.equal(result.matching,true);
  assert.equal(result.documentCount,1);
  assert.equal(result.completeFirebaseBackup,false);
  assert.equal(result.deletionAllowed,false);
  assert.equal(result.independentPhysicalMediaVerified,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("same underlying file and hard links cannot count as two copies",async()=>{
 const dir=temp();
 try{
  const src=join(dir,"a.json"),hard=join(dir,"hard.json");
  writeFileSync(src,JSON.stringify(await captureReadOnlyFirestore({
   reader:makeReader(),projectId
  })));
  linkSync(src,hard);
  await assert.rejects(verifySnapshotPair(src,src),/same underlying/);
  await assert.rejects(verifySnapshotPair(src,hard),/same underlying/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("two backups with different source data are blocked even when both checksums are valid",async()=>{
 const dir=temp();
 try{
  const a=join(dir,"a.json"),b=join(dir,"b.json");
  const old=await captureReadOnlyFirestore({reader:makeReader(),projectId});
  let newer=await captureReadOnlyFirestore({reader:{
   ...makeReader(),getDocument:async()=>({exists:true,data:{totalCount:8}})
  },projectId});
  writeFileSync(a,JSON.stringify(old));
  writeFileSync(b,JSON.stringify(newer));
  await assert.rejects(verifySnapshotPair(a,b),/not identical/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("tampered copy, malformed JSON and directories are rejected",async()=>{
 const dir=temp();
 try{
  const backup=await captureReadOnlyFirestore({reader:makeReader(),projectId});
  const a=join(dir,"a.json"),b=join(dir,"b.json");
  writeFileSync(a,JSON.stringify(backup));
  const bad=structuredClone(backup);
  bad.payload.documents[0].path="records/anotherRecord";
  writeFileSync(b,JSON.stringify(bad));
  await assert.rejects(verifySnapshotPair(a,b),/checksum mismatch/);
  writeFileSync(b,"this is not JSON");
  await assert.rejects(verifySnapshotPair(a,b),/Unexpected token|not valid JSON/);
  await assert.rejects(verifySnapshotPair(a,dir),/regular file/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
