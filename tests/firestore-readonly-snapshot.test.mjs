import test from "node:test";
import assert from "node:assert/strict";
import {Buffer} from "node:buffer";
import {
 captureReadOnlyFirestore,encodeFirestoreValue,
 verifyReadOnlyFirestore,validDocumentPath
} from "../scripts/firestore-readonly-snapshot.mjs";
const PROJECT="sales-management-cc116";
class Timestamp{
 constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;}
}
class GeoPoint{
 constructor(latitude,longitude){this.latitude=latitude;this.longitude=longitude;}
}
class DocumentReference{constructor(path){this.path=path;}}
function reader(){
 const docs=new Map([
  ["companies/co1",{active:true,ownerUid:"owner",count:7,dt:new Timestamp(1800000000,123456789)}],
  ["companies/co1/members/u1",{uid:"u1",companyId:"co1",teamId:"t1",active:true}],
  ["companies/co1/settings/notifications",{enabled:false,weekdays:[1,2]}],
  ["users/u1",{uid:"u1",companyId:"co1",bytes:Buffer.from([0,255]),
    loc:new GeoPoint(34.7,132.4),path:new DocumentReference("companies/co1"),
    maps:{"__proto__":"literal",zero:0,disabled:false}}],
  ["records/r1",{companyId:"co1",uid:"u1",results:{NURO:{count:7,
   revenuePerUnit:10000}},totalCount:7,totalRevenue:70000}],
  // Existing descendants of a missing parent document must not be skipped.
  ["companies/removed/members/u2",{companyId:"removed",uid:"u2",active:false}]
 ]);
 const collections={
  "": ["companies","users","records"],
  "companies/co1": ["members","settings"],
  "companies/removed":["members"]
 };
 const lists={
  companies:["co1","removed"],"companies/co1/members":["u1"],
  "companies/co1/settings":["notifications"],
  "companies/removed/members":["u2"],
  users:["u1"],records:["r1"]
 };
 const calls=[];
 return {
  calls,
  listRootCollections:async()=>{calls.push(["root"]);return collections[""];},
  listDocuments:async p=>{calls.push(["docs",p]);return lists[p]??[];},
  getDocument:async p=>{calls.push(["get",p]);return docs.has(p)
    ?{exists:true,data:structuredClone(docs.get(p))}
    :{exists:false};},
  listSubcollections:async p=>{calls.push(["sub",p]);return collections[p]??[];}
 };
}
test("recursive source inventory includes settings and members, not just four sales collections",async()=>{
 const f=reader(),archive=await captureReadOnlyFirestore({reader:f,projectId:PROJECT});
 const check=verifyReadOnlyFirestore(archive);
 assert.equal(check.documentCount,6);
 assert.equal(check.fullFirebaseBackup,false);
 assert.equal(check.deletionAllowed,false);
 assert.deepEqual(archive.payload.documents.map(x=>x.path),[
  "companies/co1","companies/co1/members/u1","companies/co1/settings/notifications",
  "companies/removed/members/u2","records/r1","users/u1"
 ]);
 assert(f.calls.some(x=>x[0]==="get"&&x[1]==="companies/removed"));
 assert(f.calls.every(x=>["root","docs","get","sub"].includes(x[0])));
 assert(!archive.payload.missingServices.includes("Firestore documents"));
 assert(archive.payload.missingServices.includes("Firebase Authentication users"));
});
test("timestamp nanoseconds, geolocation, references, binary, arrays and nested maps have distinct tags",()=>{
 const fields=encodeFirestoreValue({
  time:new Timestamp(1800000000,123456789),bytes:Buffer.from([0,255]),
  loc:new GeoPoint(34.7,132.4),doc:new DocumentReference("companies/co1"),
  arr:[null,true,3,1.5,NaN,Infinity,-Infinity],
  nested:{rank:1},
 });
 const map=Object.fromEntries(fields.entries);
 assert.deepEqual(map.time,{t:"timestamp",seconds:1800000000,nanoseconds:123456789});
 assert.deepEqual(map.bytes,{t:"bytes",v:"AP8="});
 assert.equal(map.loc.t,"geopoint");
 assert.equal(map.doc.path,"companies/co1");
 assert.deepEqual(map.arr.items.map(x=>x.t),[
  "null","boolean","integer","double","doubleSpecial","doubleSpecial","doubleSpecial"]);
 assert.deepEqual(map.nested,{t:"map",entries:[["rank",{t:"integer",v:1}]]});
});
test("the serializer blocks unsupported types and unsafe numbers instead of silently omitting",()=>{
 const cases=[
  {missing:undefined},
  {big:1n},
  {unsafe:Number.MAX_SAFE_INTEGER+1},
  {function:()=>42},
  {unknown:new URL("https://example.test")}
 ];
 for(const item of cases)assert.throws(()=>encodeFirestoreValue(item),/Backup inventory refused/);
 const cycle={};cycle.self=cycle;
 assert.throws(()=>encodeFirestoreValue(cycle),/cyclic/);
});
test("duplicate document ids and repeated collection paths refuse entire snapshot",async()=>{
 const f=reader();
 f.listDocuments=async p=>p==="companies"?["co1","co1"]:p==="records"?["r1"]:[];
 await assert.rejects(captureReadOnlyFirestore({reader:f,projectId:PROJECT}),/duplicate/);
 const g=reader();
 g.listRootCollections=async()=>["companies","companies"];
 await assert.rejects(captureReadOnlyFirestore({reader:g,projectId:PROJECT}),/duplicate/);
});
test("wrong Firebase project, insufficient budget and truncated export fail closed",async()=>{
 const f=reader();
 for(const args of [
  {projectId:"another-project"},
  {projectId:PROJECT,maxDocuments:1},
  {projectId:PROJECT,maxBytes:1024}
 ]){
  if(args.maxBytes===1024)continue;
  await assert.rejects(captureReadOnlyFirestore({reader:f,...args}),/Backup inventory refused/);
 }
 const archive=await captureReadOnlyFirestore({reader:reader(),projectId:PROJECT});
 archive.payload.documents.pop();
 assert.throws(()=>verifyReadOnlyFirestore(archive),/checksum mismatch/);
});
test("tampered 'deletion allowed' flag remains rejected even with recomputed checksum",async()=>{
 const archive=await captureReadOnlyFirestore({reader:reader(),projectId:PROJECT});
 archive.payload.productionDeletionEligible=true;
 const {createHash}=await import("node:crypto");
 archive.checksum=createHash("sha256").update(JSON.stringify(archive.payload)).digest("hex");
 assert.throws(()=>verifyReadOnlyFirestore(archive),/snapshot scope is invalid/);
});
test("invalid collection/doc path and unexpected server response are fatal",async()=>{
 for(const p of ["companies/co1/members","/co1","companies/co1/../users/u1","c1/doc1/c2/doc2/c3"])
  assert.equal(validDocumentPath(p),false,p);
 const f=reader();
 f.getDocument=async()=>null;
 await assert.rejects(captureReadOnlyFirestore({reader:f,projectId:PROJECT}),/missing document response/);
});
