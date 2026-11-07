import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {REVIEWED_BLOBS} from "../tools/production/prepare-partner-sb-v2-verified-package.mjs";
import {gitBlob} from "../tools/production/prepare-partner-sb-v2-verified-package.mjs";

const source=readFileSync(new URL("../.github/workflows/nico-partner-sb-v2-manual.yml",import.meta.url),"utf8");
const old=readFileSync(new URL("../.github/workflows/nico-partner-four-count-functions-manual.yml",import.meta.url),"utf8");
test("cost approval, explicit split acknowledgement, frozen main SHA, and Rules prohibition all required",()=>{
 assert.match(source,/workflow_dispatch:/);
 assert.match(source,/reviewed_main_sha:.*\n\s+description: Exact fully reviewed main SHA/s);
 assert.match(source,/deployment_approval:\s*\n\s+description: CONFIRM_FOUR_COUNT_FUNCTIONS_ONLY/);
 assert.match(source,/usage_approval:\s*\n\s+description: FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED/);
 assert.match(source,/rules_approval:\s*\n\s+description: NO_FIRESTORE_RULES_CHANGES/);
 assert.match(source,/split_version_approval:\s*\n\s+description: LEGACY_SB_COUNTS_REMAIN_UNCLASSIFIED_WITHOUT_AUTOMIGRATION/);
 for(const code of [
  "github.event_name == 'workflow_dispatch'",
  "github.repository == 'Keikei-p/-'",
  "github.ref == 'refs/heads/main'",
  "inputs.reviewed_main_sha == github.sha",
  "inputs.deployment_approval == 'CONFIRM_FOUR_COUNT_FUNCTIONS_ONLY'",
  "inputs.usage_approval == 'FUNCTION_BUILDS_AND_POSSIBLE_CHARGES_EXPLICITLY_APPROVED'",
  "inputs.rules_approval == 'NO_FIRESTORE_RULES_CHANGES'",
  "inputs.split_version_approval == 'LEGACY_SB_COUNTS_REMAIN_UNCLASSIFIED_WITHOUT_AUTOMIGRATION'",
  "needs.offline.result == 'success'"
 ])assert.ok(source.includes(code),code);
 assert.match(source,/gated-publish:\n\s+needs: offline\n\s+if:/);
});
test("one scoped deploy only, from reviewed disposable package, no overwrite, no --force",()=>{
 assert.equal((source.match(/firebase deploy --non-interactive/g)||[]).length,1);
 assert.match(source,/cd "\$review"\n\s+firebase deploy --non-interactive --project "\$FIREBASE_PROJECT_ID"/);
 assert.match(source,/--config firebase\.partner-workspace\.json --only "\$TARGETS"/);
 assert.match(source,/ensureExactOnly\(process\.env\.TARGETS\)/);
 assert.match(source,/node tools\/production\/prepare-partner-sb-v2-verified-package\.mjs --prepare/);
 assert.match(source,/test "\$\(find "\$review" -type f \| wc -l\)" -eq 6/);
 assert.ok(!source.includes("firebase deploy --only firestore"));
 assert.ok(!source.includes("firebase deploy --only hosting"));
 assert.doesNotMatch(source,/--force\b|firebase functions:delete|firebase deploy --only functions\s*$/m);
 const onDispatch=source.indexOf("  gated-publish:");
 const deployment=source.indexOf("firebase deploy --non-interactive");
 assert.ok(onDispatch>=0&&deployment>onDispatch);
});
test("no automatic release; PR and push run tests only",()=>{
 const start=source.indexOf("  offline:");
 const end=source.indexOf("  gated-publish:");
 assert.ok(start>0&&end>start);
 const offline=source.slice(start,end);
 assert.doesNotMatch(offline,/firebase deploy --|deploy --only|FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS/);
 assert.match(offline,/node --test tests\/prepare-partner-sb-v2-verified-package\.test\.mjs/);
 assert.match(offline,/node --test tests\/partner-sb-category-v2\.test\.cjs/);
 assert.match(offline,/node --test tests\/partner-workspace\.test\.cjs/);
 assert.match(source,/cancel-in-progress: false/);
});
test("production immutable Originals, invite, quick counts, old LINE version cannot silently change",()=>{
 for(const blob of [
  REVIEWED_BLOBS["functions/index.js"],
  REVIEWED_BLOBS["firestore.rules"],
  REVIEWED_BLOBS["functions-partner-workspace/index.js"],
  REVIEWED_BLOBS["functions-partner-workspace/service.cjs"],
  REVIEWED_BLOBS["firebase.partner-workspace.json"],
  REVIEWED_BLOBS["staging/partner-sb-v2/service.cjs"],
  REVIEWED_BLOBS["staging/partner-sb-v2/sb-category-v2.cjs"]
 ])assert.ok(source.includes(blob),blob);
 for(const name of [
 "createPartnerCompanyInvitation","previewPartnerCompanyInvitation","acceptPartnerCompanyInvitation",
 "getPartnerQuickCounts","submitPartnerQuickCounts","sendMissingReportReminders"
 ])assert.ok(source.includes(name),name);
 assert.match(source,/protect-original-functions-versions\.mjs before/);
 assert.match(source,/protect-original-functions-versions\.mjs after/);
 assert.match(source,/compareBeforeAfter\(old,now\)/);
 assert.match(source,/countFunctionsConfiguredEnabled":true/);
 assert.match(source,/real_user_counts_still_require_proof/i);
});
test("do not alter the reviewed old four-count-only manual workflow while preparing split v2",()=>{
 assert.equal(gitBlob(old),"42b9c3a11365d6c010d6cdb2580c9054a177ca49");
 assert.ok(source!==old);
 assert.match(source,/rm -rf -- "\$RUNNER_TEMP\/nico-reviewed-sb-v2-functions-package"/);
});
