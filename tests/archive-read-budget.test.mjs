import test from "node:test";
import assert from "node:assert/strict";
import {checkArchivePreflightCounts,assertArchiveQueryCountsMatch,MAX_ARCHIVE_DOCUMENTS}
 from "../archive-read-budget.mjs";

test("yearly archive requires all four collection counts and caps total read volume",()=>{
 const approved=checkArchivePreflightCounts([7500,50,2400,50]);
 assert.equal(approved.documentCount,MAX_ARCHIVE_DOCUMENTS);
 assert.equal(approved.verifiedWithinBudget,true);
 assert(Object.isFrozen(approved.sourceCounts));
 assert.throws(()=>checkArchivePreflightCounts([10001,0,0,0]),/取得量/);
 assert.throws(()=>checkArchivePreflightCounts([25001,10,10,10]),/取得量/);
 assert.throws(()=>checkArchivePreflightCounts([5000,100,1]),/取得量/);
 assert.throws(()=>checkArchivePreflightCounts([0,0,NaN,0]),/取得量/);
 assert.throws(()=>checkArchivePreflightCounts([-1,0,0,0]),/取得量/);
 assert.throws(()=>checkArchivePreflightCounts([0,0,1.5,0]),/取得量/);
 assert.throws(()=>checkArchivePreflightCounts([Number.MAX_SAFE_INTEGER,1,0,0]),/取得量/);
 assert.throws(()=>checkArchivePreflightCounts([1,0,0,0],10001),/取得量/);
});
test("no incomplete, stale or cached partial collection can become PDF/CSV",()=>{
 const pre=checkArchivePreflightCounts([2001,7,4,2]);
 const docs=[2001,7,4,2].map(size=>({size,metadata:{fromCache:false}}));
 assert.equal(assertArchiveQueryCountsMatch(pre,docs),true);
 for(const wrong of [
  [{size:2000},...docs.slice(1)],
  [{size:2002},...docs.slice(1)],
  [...docs.slice(0,2),{size:3},docs[3]],
  [{size:2001,metadata:{fromCache:true}},...docs.slice(1)],
  [...docs.slice(0,3)],
  [{size:NaN},...docs.slice(1)]
 ])assert.throws(()=>assertArchiveQueryCountsMatch(pre,wrong),/取得量/);
});
test("empty period is a valid zero-count view, never proof of full backup",()=>{
 const zero=checkArchivePreflightCounts([0,3,0,2]);
 assert.equal(assertArchiveQueryCountsMatch(zero,
  [0,3,0,2].map(size=>({size,metadata:{fromCache:false}}))),true);
});
