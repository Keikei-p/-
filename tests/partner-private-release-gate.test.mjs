import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
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

test("legacy private release is frozen to previously reviewed code and refuses new code",()=>{
 const pinned={
  "functions-partner-workspace/service.cjs":"9820d05e4d28242fdd447bb0ab2b5239be5327e8",
  "partner-workspace.html":"fc16cacf00c8dc9361ee9f9f63de52cf60aba778",
  "functions-partner-workspace/index.js":"a2bffd167b8804a0372c7a00465c04a63d96e919",
  "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f"
 };
 for(const [path,hash] of Object.entries(pinned)){
  assert.ok(release.includes('test "$(git hash-object '+path+')" = "'+hash+'"'),
    "Legacy release guard must remain pinned to historical source "+path);
 }
 assert.match(release,/node scripts\/check-finance-read-boundary-before-deploy\.mjs/);
 assert.match(release,/node scripts\/nico-production-cutover-preflight\.mjs/);
});
test("new company-code coordinated release pins all updated files and keeps every cost, finance and history gate",()=>{
 const filePath=".github/workflows/nico-partner-company-code-release.yml";
 const newRelease=file(filePath),cwd=fileURLToPath(new URL("../",import.meta.url));
 for(const path of [
  "functions-partner-workspace/service.cjs",
  "functions-partner-workspace/index.js",
  "functions-partner-workspace/company-code-auth.cjs",
  "partner-workspace.html","functions/index.js","firebase.partner-workspace.json"
 ]){
  const digest=execFileSync("git",["hash-object",path],{cwd,encoding:"utf8"}).trim();
  assert.ok(newRelease.includes('test "$(git hash-object '+path+')" = '+String.fromCharCode(39)+digest+String.fromCharCode(39)),
    "New release must pin exact reviewed "+path);
 }
 for(const name of ["OWNER_REVENUE_PRICES_LOGIN_VERIFIED","FIRESTORE_BACKUP_RESTORE_VERIFIED",
  "EXISTING_FUNCTIONS_COST_APPROVED","CONFIRM_COMPANY_CODE_PARTNER_COUNT_ONLY",
  "node scripts/check-finance-read-boundary-before-deploy.mjs",
  "node scripts/nico-production-cutover-preflight.mjs",
  "eligibleDeletionPolicy","surgical-existing-partner-workspace.mjs --dry-run"]){
  assert(newRelease.includes(name),"Missing strict release guard "+name);
 }
 assert.match(newRelease,/github\.event_name == 'workflow_dispatch'/);
 assert.doesNotMatch(newRelease,/continue-on-error: true|--only firestore/);
 for(const name of ["getPartnerWorkspace","managePartnerWorkspace","acceptPartnerWorkspaceInvite",
  "submitPartnerWorkspaceCounts","issuePartnerCompanyCode","activatePartnerCompanyCode",
  "loginPartnerCompanyCode","logoutPartnerCompanyCode"])
  assert(newRelease.includes("functions:partner-workspace:"+name),"New release misses "+name);
});
