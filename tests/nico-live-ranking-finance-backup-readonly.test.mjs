import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const w=readFileSync(new URL("../.github/workflows/nico-live-ranking-finance-backup-readonly.yml",import.meta.url),"utf8");
test("Finance and backup preflight is strictly read-only and main-only",()=>{
 assert.match(w,/NICO live ranking finance and backup gate \(READ ONLY\)/);
 assert.match(w,/audit-live-firestore-rules-readonly\.mjs/);
 assert.match(w,/audit-secondary-contexts-readonly\.mjs/);
 assert.match(w,/audit-managed-backup-restore-preflight-readonly\.mjs/);
 assert.match(w,/event_name == 'push'/);
 assert.match(w,/github\.ref == 'refs\/heads\/main'/);
 assert.match(w,/GITHUB_SHA/);
 assert.doesNotMatch(w,/firebase deploy|firebase firestore:delete|gcloud firestore databases restore|firebase functions:delete|gcloud functions deploy/);
 assert.match(w,/RANKING_FINANCE_READINESS_STILL_REQUIRES_REAL_ACCOUNT_DENIAL_PROOF/);
});
test("unreviewed PR receives no service identity and temporary key always erased",()=>{
 const offline=w.split("  live:")[0];
 assert.match(offline,/FIREBASE_SERVICE_ACCOUNT_JSON: ''/);
 assert.match(offline,/GOOGLE_APPLICATION_CREDENTIALS: ''/);
 assert(!offline.includes("secrets.FIREBASE_SERVICE_ACCOUNT_JSON"));
 const live=w.slice(w.indexOf("  live:"));
 assert.match(live,/if: always\(\)/);
 assert.match(live,/rm -f/);
 assert.match(live,/persist-credentials: false/);
});
