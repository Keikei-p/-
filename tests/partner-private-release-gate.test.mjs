import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=x=>readFileSync(new URL("../"+x,import.meta.url),"utf8");
const old=file(".github/workflows/nico-partner-team-snapshot-readonly-api.yml");
const page=file(".github/workflows/nico-partner-workspace-page-only.yml");
const release=file(".github/workflows/nico-partner-private-coordinated-release.yml");
test("old single-function auto release is disabled, without weakening original source checks",()=>{
 assert.match(old,/if: \$\{\{ false \}\}/);
 assert.match(old,/d17ceb37c9d7acbdd41f36bab2de3c8f21fbd85d/);
 assert.match(old,/42b44a0a1fb25e174d9de942e0d79ca191a0ce32/);
 assert.match(old,/getPartnerWorkspace/);
 assert.match(old,/node --test tests\/internal-owner-finance-visibility\.test\.cjs/);
});
test("HTML cannot release from normal main push before backend release",()=>{
 assert.match(page,/workflow_dispatch:/);
 assert.match(page,/github\.event_name == 'workflow_dispatch'/);
 assert.match(page,/CONFIRM_PARTNER_WORKSPACE_AFTER_BACKEND_AND_FINANCE_VERIFIED/);
 const index=page.indexOf("release:");
 assert(index>0);
 assert.doesNotMatch(page.slice(index,index+450),/github\.event_name == 'push'/);
});
test("coordinated manual release requires owner sales, finance, backup and cost approval before credentials",()=>{
 assert.match(release,/workflow_dispatch:/);
 assert.match(release,/OWNER_REVENUE_PRICES_LOGIN_VERIFIED/);
 assert.match(release,/FIRESTORE_BACKUP_RESTORE_VERIFIED/);
 assert.match(release,/EXISTING_FUNCTIONS_COST_APPROVED/);
 assert.match(release,/github\.ref == 'refs\/heads\/main'/);
 const financeGate=release.indexOf("node scripts/check-finance-read-boundary-before-deploy.mjs");
 const jointGate=release.indexOf("node scripts/nico-production-cutover-preflight.mjs");
 const secret=release.indexOf("FIREBASE_SERVICE_ACCOUNT_JSON: ");
 assert(financeGate>0&&jointGate>financeGate&&secret>jointGate);
 assert(!release.includes("continue-on-error: true"));
 assert(!release.includes("--only firestore"));
 assert(!release.includes("--only hosting"));
});
test("release updates 4 isolated APIs before publishing 1 page, without main sales app",()=>{
 const start=release.indexOf("firebase deploy --project");
 const end=release.indexOf("node tools/hosting/surgical-existing-partner-workspace.mjs --release");
 assert(start>0&&end>start);
 for(const name of ["getPartnerWorkspace","managePartnerWorkspace",
  "acceptPartnerWorkspaceInvite","submitPartnerWorkspaceCounts"]){
  assert(release.slice(start,end).includes("functions:partner-workspace:"+name));
 }
 assert.match(release,/node tools\/hosting\/surgical-existing-partner-workspace\.mjs --dry-run/);
 assert.match(release,/cmp -s "\$RUNNER_TEMP\/partner-live.html" partner-workspace.html/);
 assert.match(release,/functions\/index.js.*dfb4c48/);
});
