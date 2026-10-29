import {test} from "node:test";
import assert from "node:assert/strict";
import {startProtectedView} from "../client/protected-view-runtime.mjs";
test("sync event fetches only protected gateway, not a raw money collection",async()=>{
  let sync,stopped=false,apiCalls=0;const shown=[];
  const c=startProtectedView({
    subscribeToSignal:cb=>{sync=cb;return()=>{stopped=true}},
    fetchProtectedView:async()=>{apiCalls++;return {records:[],products:[],policy:{canViewRevenue:false}}},
    projectView:x=>x,
    onView:async x=>{shown.push(x)},
    onError:()=>{throw Error("unexpected failure")}
  });
  await c.refresh();
  assert.equal(apiCalls>=1,true);
  assert.equal(shown.every(x=>Array.isArray(x.products)),true);
  sync();
  await c.refresh();
  c.stop();
  assert.equal(stopped,true);
  const prev=apiCalls;
  sync();
  await c.refresh();
  assert.equal(apiCalls,prev);
});
test("a denied gateway request never falls back to reading raw Firestore",async()=>{
  let errors=0,presented=0;
  const c=startProtectedView({
    subscribeToSignal:()=>()=>{},
    fetchProtectedView:async()=>{throw Error("secure_read_denied")},
    projectView:x=>x,
    onView:()=>{presented++},
    onError:()=>{errors++}
  });
  await c.refresh();
  c.stop();
  assert.equal(presented,0);
  assert.equal(errors>0,true);
});
