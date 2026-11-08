import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {execFileSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const get=p=>readFileSync(resolve(root,p),"utf8");
const blob=p=>execFileSync("git",["hash-object",p],{cwd:root,encoding:"utf8"}).trim();
const rule="tools/production/release-partner-boundary.mjs";
const inventory="tools/readonly-backup/backup.mjs";
const restore="tools/readonly-backup/restore-emulator.mjs";
const metadata="tools/production/inspect-firestore-backups-readonly.mjs";
const wf=get(".github/workflows/nico-one-shot-isolated-restore-verify-20261107.yml");

test("read-only replay pins the exact reviewed library blobs before secrets and live production scans",()=>{
 const refs=new Map([
  [rule,"038c4c0f6732232f1e751b6011cc5cb2cc4fd142"],
  [inventory,"a7f21e94857a0e515655b99a725382974646dad7"],
  [restore,"638bd79ed31ad28e7298d8ed2e6927730ec129b1"],
  [metadata,"8016a0501a309ff52a002f34bed53832658d2ffb"]
 ]);
 const checks=wf.match(/test "\$\(git hash-object [^"]+\)" = [a-f0-9]{40}/g)??[];
 for(const [path,expected] of refs){
  assert.equal(blob(path),expected,path+" changed since reviewer pinned it");
  assert.equal(checks.filter(v=>v.includes(path)&&v.endsWith(expected)).length,2,
   path+" must be checked BOTH before and during live verification");
 }
 const pin=wf.indexOf("- name: Reject unknown checkout or an unfrozen Rules writer");
 const secret=wf.indexOf("- name: Configure existing read-only inventory identity");
 assert(pin>=0&&secret>pin);
 assert.match(wf,/gh api repos\/Keikei-p\/-\/branches\/main --jq .commit.sha/);
 assert.match(wf,/persist-credentials: false/);
});
test("production verify only reads, stores no real documents in artifacts and writes only localhost emulator",()=>{
 const source=get(rule);
 const backend=get(inventory);
 const local=get(restore);
 assert.match(source,/if\(mode==='apply'\)stop\('LEGACY_APPLY_DISABLED_REAL_UID_PROOF_REQUIRED'\)/);
 assert.match(source,/if\(process\.env\.NICO_RULES_APPROVAL!=='VERIFY_ONLY'\)/);
 assert.match(source,/snapshot:\(\)=>collect\(request,\{maxDocuments:10000\}\)/);
 assert.match(source,/if\(!apply\)return summary/);
 assert.match(backend,/GET documents:list and POST documents:listCollectionIds/);
 assert.match(local,/only a local Firestore emulator and demo project/);
 assert.match(local,/currentDocument.exists=false/);
 assert.match(wf,/NICO_RULES_APPROVAL: VERIFY_ONLY/);
 assert.match(wf,/emulators:exec --project demo-sales-restore --only firestore/);
 assert.match(wf,/node tools\/production\/release-partner-boundary\.mjs verify/);
 assert.doesNotMatch(wf,/firebase deploy|:run|upload-artifact@|--import/);
 assert.match(wf,/rm -f "\$RUNNER_TEMP\/nico-one-shot-readonly.json"/);
 assert.match(wf,/rm -f firestore-debug.log firebase-debug.log ui-debug.log/);
 assert.match(wf,/managed READY backup payload/);
});
test("2026-11-08 live read-only inventory requires the one-time audited main commit only",()=>{
 const prefix="audit: recheck exact 20261108 isolated inventory (NO DEPLOY)";
 assert.ok(wf.includes("startsWith(github.event.head_commit.message, '"+prefix+"')"));
 assert.match(wf,/github\.repository == 'Keikei-p\/-'/);
 assert.match(wf,/github\.event_name == 'push'/);
 assert.match(wf,/needs\.offline\.result == 'success'/);
 assert.match(wf,/STOP_UNREVIEWED_PRODUCTION_REAUDIT/);
 assert.ok(wf.includes("REVIEWED_PUSH_MESSAGE: ${{ github.event.head_commit.message }}"));
 assert.match(wf,/case "\$REVIEWED_PUSH_MESSAGE" in/);
 assert.doesNotMatch(wf,/case "\$\{\{ github\.event\.head_commit\.message \}\}" in/);
 assert.match(wf,/test "\$GITHUB_SHA" = "\$\(git rev-parse HEAD\)"/);
 assert.match(wf,/test "\$GITHUB_SHA" = "\$\(gh api repos\/Keikei-p\/-\/branches\/main --jq \.commit\.sha\)"/);
 assert.match(wf,/FIREBASE_PROJECT_ID: sales-management-cc116/);
 assert.match(wf,/NICO_RULES_APPROVAL: VERIFY_ONLY/);
 assert.doesNotMatch(wf,/firebase deploy|--import|upload-artifact@/);
 assert.doesNotMatch(wf,/\bNICO_RULES_APPROVAL: (?!VERIFY_ONLY)\w+/);
});

test("the snapshot verification cannot be mistaken for an actual managed-backup restoration",()=>{
 const source=get(rule);
 assert.match(source,/managedBackupRestored:false/);
 assert.match(source,/metadataTimestampsRestored:false/);
 assert.match(source,/applied:false/);
 assert.match(wf,/Production data and credentials remain in ephemeral private files/);
 assert.match(wf,/NOT the actual managed READY backup payload/);
});
