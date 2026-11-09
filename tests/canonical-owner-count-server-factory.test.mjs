import test from "node:test";
import assert from "node:assert/strict";
import {createCanonicalOwnerCountSnapshot,createCanonicalOwnerCountHandler}
 from "../ranking/canonical-owner-count-server-factory.mjs";
const url="https://nico-factory.web.app/v1/owner-visible-counts?month=2026-11";
test("new complete ranking route stays OFF and performs no backend read by default",async()=>{
 const handle=createCanonicalOwnerCountHandler();
 const response=await handle(new Request(url,{
  method:"GET",headers:{"Origin":"https://nico-factory.web.app"}
 }));
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:"service_disabled"});
 assert.equal(response.headers.get("Cache-Control"),"no-store");
});
test("cannot enable combined ranking with missing server Auth or Firestore",()=>{
 assert.throws(()=>createCanonicalOwnerCountHandler({
  enabled:true
 }),/CANONICAL_OWNER_COUNT_AUTH_MISSING/);
 const auth={verifyIdToken:async()=>{},getUser:async()=>{}};
 assert.throws(()=>createCanonicalOwnerCountHandler({
  enabled:true,auth
 }),/CANONICAL_OWNER_COUNT_DEPENDENCY_MISSING/);
});
test("cannot build atomic loader with incomplete database or timestamp",()=>{
 assert.throws(()=>createCanonicalOwnerCountSnapshot({}),
  /CANONICAL_OWNER_COUNT_DEPENDENCY_MISSING/);
 assert.throws(()=>createCanonicalOwnerCountSnapshot({
  db:{collection:()=>({}),runTransaction:async()=>{}},FieldValue:{}
 }),/CANONICAL_OWNER_COUNT_DEPENDENCY_MISSING/);
});
