import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeVerifiedPartnerRankingInvalidator} from "../ranking/partner-count-cache-invalidation.mjs";

const receipt=()=>({
 date:"2026-10-31",month:"2026-10",partnerCompanyId:"partner",version:3
});
function fixture(){
 let scope={uid:"owner",hubCompanyId:"hub"},cleared=[],refreshed=[];
 const cache=new Map([
  ["owner|hub|2026-10|2026-10-31",{rows:[{id:"partner",totalCount:5}]}],
  ["owner|hub|2026-10|2026-10-30",{rows:[{id:"partner",totalCount:3}]}],
  ["owner|hub|2026-11|2026-11-01",{rows:[{id:"partner",totalCount:1}]}],
  ["other|hub|2026-10|2026-10-31",{rows:[{id:"partner",totalCount:50}]}],
  ["owner|otherhub|2026-10|2026-10-31",{rows:[{id:"partner",totalCount:70}]}]
 ]);
 const invalidate=makeVerifiedPartnerRankingInvalidator({
  dailyCache:cache,getActiveScope:()=>scope,
  resetVisibleMonth:month=>{cleared.push(month)},
  requestRefresh:async month=>{refreshed.push(month)}
 });
 return {cache,invalidate,cleared,refreshed,setScope:x=>scope=x};
}
test("only corrected day for the exact owner/company is discarded; other users, months and days survive",async()=>{
 const f=fixture(),oldSize=f.cache.size;
 assert.deepEqual(await f.invalidate(receipt()),{
  month:"2026-10",date:"2026-10-31",
  invalidated:true,rankingRecheckRequested:true
 });
 assert.equal(f.cache.size,oldSize-1);
 assert.equal(f.cache.has("owner|hub|2026-10|2026-10-31"),false);
 for(const k of [
  "owner|hub|2026-10|2026-10-30",
  "owner|hub|2026-11|2026-11-01",
  "other|hub|2026-10|2026-10-31",
  "owner|otherhub|2026-10|2026-10-31"
 ])assert.equal(f.cache.has(k),true,k);
 assert.deepEqual(f.cleared,["2026-10"]);
 assert.deepEqual(f.refreshed,["2026-10"]);
});
test("a re-read can replace stale counts only after cache invalidation",async()=>{
 const f=fixture();
 assert.equal(f.cache.get("owner|hub|2026-10|2026-10-31").rows[0].totalCount,5);
 await f.invalidate(receipt());
 assert.equal(f.cache.has("owner|hub|2026-10|2026-10-31"),false);
 f.cache.set("owner|hub|2026-10|2026-10-31",
  {rows:[{id:"partner",totalCount:7}]});
 assert.equal(f.cache.get("owner|hub|2026-10|2026-10-31").rows[0].totalCount,7);
});
test("forged company/day/finance fields, wrong company scope and invalid version fail without eviction",async()=>{
 const variants=[
  {...receipt(),date:"2026-11-01"},
  {...receipt(),date:"2026-10-99"},
  {...receipt(),month:"2026-11"},
  {...receipt(),partnerCompanyId:"hub"},
  {...receipt(),partnerCompanyId:"../partner"},
  {...receipt(),version:0},
  {...receipt(),version:1000},
  {...receipt(),unitPrice:50000},
  {...receipt(),counts:{NURO:2}},
  {...receipt(),date:"2030-02-30"}
 ];
 for(const val of variants){
  const f=fixture();
  const before=[...f.cache];
  await assert.rejects(f.invalidate(val),/OWNER_RANKING_CACHE_/);
  assert.deepEqual([...f.cache],before);
  assert.deepEqual(f.cleared,[]);
  assert.deepEqual(f.refreshed,[]);
 }
});
test("disabled/changed auth scope rejects without mixing owner data",async()=>{
 for(const v of [
  null,{}, {uid:"owner",hubCompanyId:"hub",finance:true},
  {uid:"owner",hubCompanyId:"partner"},
  {uid:"",hubCompanyId:"hub"},
  {uid:"owner",hubCompanyId:""}
 ]){
  const f=fixture(),before=[...f.cache];
  f.setScope(v);
  await assert.rejects(f.invalidate(receipt()),/OWNER_RANKING_CACHE_/);
  assert.deepEqual([...f.cache],before);
 }
});
test("mid-refresh account switch is detected; write already happened and must not be retried",async()=>{
 const cache=new Map([["owner|hub|2026-10|2026-10-31",{rows:[{count:1}]}]]);
 let scope={uid:"owner",hubCompanyId:"hub"},trigger=0,monthly=0;
 const fn=makeVerifiedPartnerRankingInvalidator({
  dailyCache:cache,getActiveScope:()=>scope,
  resetVisibleMonth:()=>{monthly++},
  requestRefresh:async()=>{trigger++;scope={uid:"other",hubCompanyId:"hub"}}
 });
 await assert.rejects(fn(receipt()),/OWNER_RANKING_CACHE_SESSION_CHANGED/);
 assert.equal(cache.size,0);
 assert.equal(trigger,1);
 assert.equal(monthly,1);
});
test("when rank refresh fails, cache and visible monthly state were already invalidated",async()=>{
 const cache=new Map([["owner|hub|2026-10|2026-10-31",{rows:[{count:1}]}]]);
 let monthly=0;
 const fn=makeVerifiedPartnerRankingInvalidator({
  dailyCache:cache,getActiveScope:()=>({uid:"owner",hubCompanyId:"hub"}),
  resetVisibleMonth:()=>{monthly++},
  requestRefresh:async()=>{throw Error("NETWORK_UNAVAILABLE")}
 });
 await assert.rejects(fn(receipt()),/NETWORK_UNAVAILABLE/);
 assert.equal(cache.size,0);
 assert.equal(monthly,1);
});
test("no credentials, Firebase, storage or monetary API access in helper",()=>{
 const src=readFileSync(new URL("../ranking/partner-count-cache-invalidation.mjs",import.meta.url),"utf8");
 assert.match(src,/STAGING ONLY \/ NO DEPLOY/);
 assert.doesNotMatch(src,/getFirestore|httpsCallable|firebase deploy|localStorage|sessionStorage|fetch\(|getAuth|console\./);
});
