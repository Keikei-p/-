import test from "node:test";
import assert from "node:assert/strict";
import {validateEmulatorTarget} from "../functions/rehearse-sales-restore.mjs";

const demo={FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080",GCLOUD_PROJECT:"demo-sales-archive-rehearsal"};
test("only explicit loopback emulator + demo project + confirmation pass",()=>{
 assert.deepEqual(validateEmulatorTarget(demo,["--confirm-emulator"]),{host:"127.0.0.1:8080",project:"demo-sales-archive-rehearsal"});
});
test("reject production project even if emulator host is present",()=>{
 assert.throws(()=>validateEmulatorTarget({...demo,GCLOUD_PROJECT:"sales-management-cc116"},["--confirm-emulator"]),/never production/);
});
test("reject host outside local machine",()=>{
 assert.throws(()=>validateEmulatorTarget({...demo,FIRESTORE_EMULATOR_HOST:"firestore.googleapis.com:443"},["--confirm-emulator"]),/Local-only/);
});
test("reject missing confirmation",()=>{
 assert.throws(()=>validateEmulatorTarget(demo,[]),/flag is required/);
});
test("reject omitted emulator host",()=>{
 assert.throws(()=>validateEmulatorTarget({GCLOUD_PROJECT:"demo-sales-archive-rehearsal"},["--confirm-emulator"]),/Local-only/);
});
