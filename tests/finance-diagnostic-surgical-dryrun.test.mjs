import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const w=readFileSync(new URL("../.github/workflows/nico-finance-diagnostic-surgical-dryrun.yml",import.meta.url),"utf8");
const surgical=readFileSync(new URL("../tools/hosting/surgical-finance-boundary-mobile-login.mjs",import.meta.url),"utf8");
test("read-only preflight is restricted to reviewed main, with current protected source pins",()=>{
 assert.match(w,/github\.event_name == 'push'/);
 assert.match(w,/github\.repository == 'Keikei-p\/-'/);
 assert.match(w,/github\.ref == 'refs\/heads\/main'/);
 assert.match(w,/test "\$\(git hash-object firestore\.rules\)"/);
 assert.match(w,/test "\$\(git hash-object index\.html\)"/);
 assert.match(w,/test "\$\(git hash-object finance-boundary-check\.html\)"/);
 assert.match(w,/test "\$\(git hash-object tools\/hosting\/surgical-finance-boundary-mobile-login\.mjs\)"/);
 assert.match(w,/--dry-run/);
 assert.doesNotMatch(w,/--release|firebase deploy|gcloud deploy|upload-artifact@/);
 assert.match(w,/PRODUCTION_HOSTING_RELEASES=0/);
 assert.match(w,/FIRESTORE_DOCUMENT_REQUESTS=0/);
 assert.match(w,/PRODUCTION_RULES_WRITES=0/);
});
test("existing exact surgical deployer only writes after --release and reviewed current version",()=>{
 assert.match(surgical,/if\(!release\) return \{released:false/);
 assert.match(surgical,/EXACT_PREVIOUS_VERSION/);
 assert.match(surgical,/EXACT_PREVIOUS_GIT_BLOB/);
 assert.match(surgical,/if\(sourceName!==EXACT_PREVIOUS_VERSION\)/);
 assert.match(surgical,/ONLY_ONE_EXISTING_DIAGNOSTIC_REPLACEMENT_ALLOWED/);
 assert.match(surgical,/oldFiles\.length!==expectedCount/);
 assert.match(surgical,/NON_DIAGNOSTIC_FILE_MODIFIED/);
 assert.match(surgical,/LIVE_CHANGED_BEFORE_RELEASE/);
});
test("workflow never prints identity or uploads live HTML",()=>{
 assert.doesNotMatch(w,/cat .*private\.json|echo "\$FIREBASE_SERVICE_ACCOUNT_JSON"|upload-artifact|firebase hosting:channel/);
 assert.match(w,/rm -f "\$RUNNER_TEMP\/nico-diagnostic-dryrun\.private\.json"/);
 assert.doesNotMatch(w,/writeBatch\(|setDoc\(|updateDoc\(|deleteDoc\(|--only firestore/);
});
