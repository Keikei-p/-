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
test("a refresh requested during an in-flight read waits for a genuinely newer view",async()=>{
  const releases=[],shown=[];
  const service=startProtectedView({
    subscribeToSignal:()=>()=>{},
    fetchProtectedView:()=>new Promise(resolve=>releases.push(resolve)),
    projectView:v=>v,
    onView:v=>shown.push(v.version),
    onError:()=>{}
  });
  assert.equal(releases.length,1,"initial read is in flight");
  let completed=false;
  const postWrite=service.refresh().then(()=>{completed=true});
  releases.shift()({version:1});
  for(let n=0;n<20&&releases.length<1;n++)await Promise.resolve();
  assert.deepEqual(shown,[1]);
  assert.equal(completed,false,"pre-save response cannot confirm a post-save refresh");
  assert.equal(releases.length,1);
  releases.shift()({version:2});
  await postWrite;
  assert.deepEqual(shown,[1,2]);
  assert.equal(completed,true);
  service.stop();
});
test("explicit protected refresh propagates server denial without optimistic success",async()=>{
  let calls=0,errors=0;
  const service=startProtectedView({
    subscribeToSignal:()=>()=>{},
    fetchProtectedView:async()=>{
      calls++;
      if(calls>1)throw Error("finance_forbidden");
      return {version:1};
    },
    projectView:x=>x,onView:()=>{},onError:()=>{errors++}
  });
  // Let the initial read finish, then request a distinct authorized refresh.
  for(let n=0;n<20&&calls<1;n++)await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(service.refresh(),/finance_forbidden/);
  assert.equal(errors,1);
  service.stop();
});
