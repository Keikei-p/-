import test from "node:test";
import assert from "node:assert/strict";
import {summarizeBackups,inspect} from "../tools/production/inspect-firestore-backups-readonly.mjs";
const database="projects/sales-management-cc116/databases/(default)";
test("read-only backup metadata reports READY but never asserts actual restore",()=>{
 const s=summarizeBackups({backups:[
  {database,state:"READY",snapshotTime:"2026-11-01T12:00:00Z"},
  {database,state:"CREATING",snapshotTime:"2026-11-01T13:00:00Z"},
  {database:"projects/sales-management-cc116/databases/other",state:"READY",snapshotTime:"2026-11-01T12:00:00Z"}
 ]});
 assert.equal(s.managedBackupsFound,2);
 assert.equal(s.readyBackups,1);
 assert.equal(s.actualRestoreVerified,false);
 assert.equal(s.allFirestoreDocumentsAudited,false);
});
test("read-only inventory reports stats availability without exposing backup size or IDs",()=>{
 const older={database,state:"READY",snapshotTime:"2026-11-14T00:00:00Z",
  expireTime:"2026-11-21T00:00:00Z",stats:{documentCount:"2",sizeBytes:"512"}};
 const missing={database,state:"READY",snapshotTime:"2026-11-16T12:00:00Z",
  expireTime:"2026-11-21T00:00:00Z"};
 const malformed={...missing,stats:{documentCount:"no",sizeBytes:"512"}};
 const r=summarizeBackups({backups:[older,missing,malformed]});
 assert.equal(r.readyBackups,3);
 assert.equal(r.readyMissingStats,1);
 assert.equal(r.readyMalformedStats,1);
 assert.equal(r.readyWithValidStats,1);
 assert.equal(r.actualRestoreVerified,false);
 assert.equal(r.allFirestoreDocumentsAudited,false);
 for(const k of Object.keys(r))assert(!/sizeBytes|documentCount|backupId|uid|token/i.test(k));
 assert(!JSON.stringify(r).includes("512"));
 assert(!JSON.stringify(r).includes("no"));
});
test("incomplete response or unreachable backup location blocks inventory",()=>{
 assert.throws(()=>summarizeBackups({backups:[],unreachable:["asia-northeast1"]}),/STOP_BACKUP_LOCATIONS_UNREACHABLE/);
 assert.throws(()=>summarizeBackups({backups:{"bad":1}}),/STOP_BACKUP_RESPONSE_MALFORMED/);
});
test("audit only performs a GET and reports insufficient permissions without leaking token",async()=>{
 let calls=0;
 const result=await inspect({getToken:async()=>"fake-secret",
  request:async(url,opts)=>{calls++;assert.match(url,/\/locations\/-\/backups$/);
   assert.equal(opts.method,"GET");assert.equal(opts.redirect,"error");
   return {ok:true,json:async()=>({backups:[]})};
  }});
 assert.equal(calls,1);
 assert.equal(result.readyBackups,0);
 await assert.rejects(inspect({getToken:async()=>"fake-secret",
  request:async()=>({ok:false,status:403})}),/STOP_BACKUP_LIST_HTTP_403/);
});
