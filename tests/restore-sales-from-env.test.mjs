import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assertLocalRestoreEnvironment} from "../scripts/restore-sales-from-env.mjs";
const normal={SALES_BACKUP_FILE:"/private/backup-2026.salesbak",
  GCLOUD_PROJECT:"demo-sales-restore",FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"};
test("backup restore launcher accepts only exact local demo project, absolute encrypted backup",()=>{
 assert.equal(assertLocalRestoreEnvironment(normal),normal.SALES_BACKUP_FILE);
});
test("rejects production ids, hostnames, remote IP and nonencrypted files",()=>{
 for(const changes of [
   {GCLOUD_PROJECT:"sales-management-cc116"},
   {GCLOUD_PROJECT:"demo-sales-staging"},
   {FIRESTORE_EMULATOR_HOST:"localhost:8080"},
   {FIRESTORE_EMULATOR_HOST:"10.0.0.1:8080"},
   {FIRESTORE_EMULATOR_HOST:"127.0.0.1:65536"},
   {FIRESTORE_EMULATOR_HOST:""},
   {SALES_BACKUP_FILE:"../relative.salesbak"},
   {SALES_BACKUP_FILE:"/private/backup.json"}
 ])assert.throws(()=>assertLocalRestoreEnvironment({...normal,...changes}));
});
test("bridge never invokes shell or cloud service credentials",()=>{
 const code=readFileSync(new URL("../scripts/restore-sales-from-env.mjs",import.meta.url),"utf8");
 assert(code.includes("shell:false"));
 assert(code.includes('GOOGLE_APPLICATION_CREDENTIALS:""'));
 assert(code.includes("LOCAL_EMULATOR_ONLY"));
 assert(!/wrangler deploy|firebase deploy|batch\.delete|deleteDoc\(/.test(code));
});
