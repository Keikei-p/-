import test from "node:test";
import assert from "node:assert/strict";
import {summarizeBackups,inspect} from "../tools/production/inspect-firestore-backups-readonly.mjs";
const database="projects/sales-management-cc116/databases/(default)";
const backup={name:"projects/sales-management-cc116/locations/asia-northeast1/backups/synthetic-backup",
 database,databaseUid:"synthetic-source-uid",state:"READY",
 snapshotTime:new Date(Date.now()-3600000).toISOString(),
 expireTime:new Date(Date.now()+7*86400000).toISOString()};

test("official Backup schema is sufficient for inventory, never capacity or restoration proof",()=>{
 const result=summarizeBackups({backups:[backup,
  {...backup,state:"CREATING"}, {...backup,database:database+"-other"}]});
 assert.equal(result.managedBackupsFound,2);
 assert.equal(result.readyBackups,1);
 assert.equal(result.recentReadyWithin48hAndExpiryBuffer,1);
 assert.equal(result.backupApiProvidesSizeAndDocumentCount,false);
 assert.equal(result.restoreCapacityAndCostVerified,false);
 assert.equal(result.actualRestoreVerified,false);
 assert.equal(result.allFirestoreDocumentsAudited,false);
});
test("invented stats never authorize a budget or appear in reports",()=>{
 const s=summarizeBackups({backups:[{...backup,stats:{sizeBytes:"512",documentCount:"2"}}]});
 assert.equal(s.restoreCapacityAndCostVerified,false);
 assert.deepEqual(s,summarizeBackups({backups:[backup]}));
 for(const value of ["512",backup.name,backup.databaseUid,"readyMissingStats","recentReadyWithinAuditBudget"])
  assert(!JSON.stringify(s).includes(value));
});
test("incomplete, malformed or unreachable inventories stop",()=>{
 for(const [body,reason] of [
  [{backups:[],unreachable:["asia-northeast1"]},"LOCATIONS_UNREACHABLE"],
  [{backups:{}},"RESPONSE_MALFORMED"],
  [{backups:[],nextPageToken:"more"},"INVENTORY_INCOMPLETE"],
  [{backups:[],unreachable:{}},"UNREACHABLE_RESPONSE"]
 ])assert.throws(()=>summarizeBackups(body),new RegExp(reason));
});
test("one GET uses the official schema; no redundant detail retry for nonexistent stats",async()=>{
 let calls=0;
 const result=await inspect({getToken:async()=>"fake-secret",request:async(url,opts)=>{
  calls++;
  assert.equal(url,"https://firestore.googleapis.com/v1/projects/sales-management-cc116/locations/-/backups");
  assert.equal(opts.method,"GET");assert.equal(opts.redirect,"error");
  return {ok:true,json:async()=>({backups:[backup]})};
 }});
 assert.equal(calls,1);assert.equal(result.readyBackups,1);
 assert.equal(result.restoreCapacityAndCostVerified,false);
 assert(!JSON.stringify(result).includes("fake-secret"));
});
test("empty result and denied API remain distinct, without token disclosure",async()=>{
 const r=await inspect({getToken:async()=>"fake-secret",request:async()=>({ok:true,json:async()=>({backups:[]})})});
 assert.equal(r.readyBackups,0);
 await assert.rejects(inspect({getToken:async()=>"fake-secret",request:async()=>({ok:false,status:403})}),/STOP_BACKUP_LIST_HTTP_403/);
});
