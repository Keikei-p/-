"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {pathToFileURL}=require("node:url");
const path=require("node:path");
const modulePath=pathToFileURL(path.resolve(__dirname,"../functions-ranking-approvals/ranking/owner-visible-count-atomic-loader.mjs")).href;
test("atomic ranking rejects invalid company scope before Firestore access",async()=>{
 const {createStagedAtomicOwnerCountLoader}=await import(modulePath);
 let reads=0;
 const loader=createStagedAtomicOwnerCountLoader({
  db:{runTransaction(){reads++;throw Error("SHOULD_NOT_READ");}},
  loadCountsInTransaction(){throw Error("SHOULD_NOT_LOAD");},
  loadPublicationInTransaction(){throw Error("SHOULD_NOT_LOAD");}
 });
 const base={serverVerified:true,hubCompanyId:"hub",viewerUid:"owner",approvedCompanyIds:["hub","partner"]};
 for(const ids of [[],["partner"],["hub","hub"],["hub","partner","partner"],["hub","bad/name"],["hub","__proto__"],"hub",null]){
  await assert.rejects(loader({month:"2026-11",context:{...base,approvedCompanyIds:ids}}),/OWNER_RANK_ATOMIC_SNAPSHOT_UNVERIFIED/);
 }
 assert.equal(reads,0);
});
