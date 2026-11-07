import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const w=readFileSync(new URL("../.github/workflows/nico-partner-sb-v2-ui-surgical.yml",import.meta.url),"utf8");
const publisher=readFileSync(new URL("../tools/hosting/surgical-partner-sb-v2-ui.mjs",import.meta.url),"utf8");
const oldPage=readFileSync(new URL("../partner-workspace.html",import.meta.url));
const newPage=readFileSync(new URL("../staging/partner-sb-v2/partner-workspace.html",import.meta.url));
const blob=x=>createHash("sha1").update("blob "+x.length+String.fromCharCode(0)).update(x).digest("hex");
test("the one-page release pins old and new versioned assets without touching Rules or accounting",()=>{
 assert.equal(blob(oldPage),"0930abb188165afea19ef427308ea22fddf636e7");
 assert.equal(blob(newPage),"82a1ed0c67b14ea3fd915419da7864b7c99ffe7b");
 assert.ok(publisher.includes('EXACT_PREVIOUS_VERSION="sites/nico-factory/versions/551d5e3128fd01bd"'));
 assert.ok(publisher.includes('EXACT_PREVIOUS_GIT_BLOB="0930abb188165afea19ef427308ea22fddf636e7"'));
 assert.ok(publisher.includes('export const ASSET="/partner-workspace.html"'));
 assert.match(publisher,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(publisher,/NON_PARTNER_FILE_MODIFIED/);
 assert.match(publisher,/FINAL_ASSET_HASH_MISMATCH/);
 assert.match(publisher,/FINAL_VERSION_CONFIG_UNVERIFIED/);
 assert.match(publisher,/CONFIRM_SB_V2_ONLY_AFTER_REAL_PARTNER_PROOF/);
 assert.doesNotMatch(publisher,/firebase deploy|firestore\.googleapis\.com|firebaserules\.googleapis\.com/);
});
test("all manual approvals required AND must match exact HEAD on main; no auto publish on PR/push",()=>{
 assert.ok(w.includes("workflow_dispatch:"));
 const requirements=[
  "github.event_name == 'workflow_dispatch'",
  "github.repository == 'Keikei-p/-'",
  "github.ref == 'refs/heads/main'",
  "inputs.reviewed_main_sha == github.sha",
  "FOUR_COUNT_FUNCTIONS_ACTIVE_AND_REAL_COUNT_SUBMISSION_PROVEN",
  "OWNER_FINANCE_ALLOWED_AND_PARTNER_FINANCE_GET_LIST_DENIED_PROVEN",
  "REPLACE_PARTNER_WORKSPACE_PAGE_ONLY",
  "HOSTING_PUBLISH_POSSIBLE_USAGE_CHARGES_EXPLICITLY_APPROVED",
  "needs.offline.result == 'success'"
 ];
 for(const r of requirements)assert.ok(w.includes(r),r);
 const a=w.indexOf("  offline:"),b=w.indexOf("  gated-publish:");
 assert.ok(a>=0&&b>a);
 const offline=w.slice(a,b);
 assert.doesNotMatch(offline,/firebase deploy|--release|FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS/);
 assert.match(w,/cancel-in-progress: false/);
});
test("live Cloud Functions health check is required before Hosting publish, but never substitutes user proof",()=>{
 const metadata=w.indexOf("inspect-live-partner-callables-readonly.mjs");
 const proof=w.indexOf("countFunctionsConfiguredEnabled");
 const prior=w.indexOf("protect-original-functions-versions.mjs before");
 const dry=w.indexOf("surgical-partner-sb-v2-ui.mjs --dry-run");
 const publish=w.indexOf("surgical-partner-sb-v2-ui.mjs --release");
 const after=w.indexOf("protect-original-functions-versions.mjs after",publish);
 assert.ok(metadata>=0&&proof>metadata&&prior>metadata&&dry>prior&&publish>dry&&after>publish);
 assert.equal((w.match(/surgical-partner-sb-v2-ui\.mjs --release/g)||[]).length,1);
 assert.match(w,/real_count_submission_proven/i);
 assert.match(w,/finance_get_list_denied_proven/i);
 assert.match(w,/countFunctionsActive":true/);
});
test("only one live page is changed, all other 11 preserve their exact manifests and respond",()=>{
 for(const item of [
  "EXACT_PREVIOUS_VERSION","LIVE_REQUIRED_ASSETS_UNVERIFIED","LIVE_CHANGED_BEFORE_CREATE",
  "LIVE_CHANGED_BEFORE_RELEASE","FINAL_ASSET_HASH_MISMATCH","FINAL_VERSION_CONFIG_UNVERIFIED",
  "/index.html","/partner-workspace.html","/partner-invite.html",
  "/partner-counts.html","/finance-boundary-check.html"
 ])assert.ok(publisher.includes(item)||w.includes(item),item);
 assert.match(w,/cmp -s "\$RUNNER_TEMP\/nico-sb-v2-ui-live.html"/);
 assert.match(w,/POST_DEPLOY_ONE_PAGE_PARTNER_SB_V2_MATCHES_11_OTHER_FILES_AND_BACKEND_UNCHANGED/);
 assert.doesNotMatch(w,/--only hosting|--only functions|--force\s*--deploy/);
 assert.equal((w.match(/surgical-partner-sb-v2-ui\.mjs --dry-run/g)||[]).length,1);
});
test("source of original service, owner sales pages and originally-reviewed release code are immutable",()=>{
 for(const sha of [
  "d9f4df6a2ac0f8b5720534a2461ec66b94379190",
  "88ef5636bfe9254e71f2109d452b6d3049f99861",
  "0930abb188165afea19ef427308ea22fddf636e7",
  "b94a6aba231dc2569009580a178297a5b6194bda",
  "82a1ed0c67b14ea3fd915419da7864b7c99ffe7b"
 ])assert.ok(w.includes(sha),sha);
 assert.doesNotMatch(w,/firebase deploy --|firebase functions:delete|firebase firestore:delete/);
 assert.match(w,/POST_DEPLOY_ONE_PAGE_PARTNER_SB_V2_MATCHES_11_OTHER_FILES_AND_BACKEND_UNCHANGED/);
});
