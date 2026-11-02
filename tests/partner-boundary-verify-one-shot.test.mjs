import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const wf=read('.github/workflows/nico-partner-boundary-verify-once.yml');
const original=read('.github/workflows/nico-partner-boundary-manual.yml');
const verifier=read('tools/production/release-partner-boundary.mjs');
test('one-time trigger is exact main-push workflow path, no repeat schedule',()=>{
 assert.match(wf,/push:\s*\n\s*branches: \[main\]/);
 assert.match(wf,/paths:\s*\n\s*- '\.github\/workflows\/nico-partner-boundary-verify-once\.yml'/);
 assert.ok(wf.includes('pull_request:\n    branches: [main]'), 'PR offline-only validation trigger missing');
 assert.doesNotMatch(wf,/schedule:|cron:|workflow_dispatch:/);
 assert.match(wf,/github\.event_name == 'push'/);
 assert.match(wf,/STOP_MAIN_CHANGED/);
 assert.match(wf,/group: firebase-rules-production/);
 assert.match(wf,/cancel-in-progress: false/);
});
test('all production actions are hardcoded verify-only, cannot publish rules',()=>{
 assert.match(wf,/RELEASE_MODE: verify/);
 assert.match(wf,/NICO_RULES_APPROVAL: VERIFY_ONLY/);
 assert.match(wf,/test "\$RELEASE_MODE" = verify/);
 assert.match(wf,/test "\$NICO_RULES_APPROVAL" = VERIFY_ONLY/);
 assert.doesNotMatch(wf,/APPROVED_PARTNER_BOUNDARY_ONLY|RELEASE_MODE: apply|firebase deploy|--only firestore:rules|curl.*PATCH/);
 assert.match(wf,/release-partner-boundary\.mjs \$RELEASE_MODE/);
 assert.match(verifier,/apply:mode==='apply'/);
 assert.match(verifier,/if\(mode==='apply'&&process\.env\.NICO_RULES_APPROVAL!==/);
});
test('performs the same full inventory, restore and finance regression as protected original',()=>{
 for(const marker of ['tests/partner-boundary-release.test.mjs',
   'tests/live-rules-surgical-preview.test.mjs',
   'tests/internal-owner-finance-visibility.test.cjs',
   'tools/readonly-backup/backup.test.mjs',
   'firebase emulators:exec --project demo-sales-support',
   'firebase emulators:exec --project demo-sales-restore',
   'node tools/production/release-partner-boundary.mjs',
   'partner-boundary-summary.json',
   'partner-boundary-private.log']) {
  assert.ok(wf.includes(marker),marker);
  assert.ok(original.includes(marker), 'original '+marker);
 }
 assert.match(wf,/if-no-files-found: error/);
 assert.match(wf,/name: Remove private temporary credentials and logs/);
 assert.match(wf,/path: \\$\\{\\{ runner\\.temp \\}\\}\\/partner-boundary-summary\\.json/);
 assert.doesNotMatch(wf,/path:.*partner-boundary-private\\.log/);
});
