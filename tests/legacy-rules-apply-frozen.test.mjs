import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const wf=readFileSync(new URL('../.github/workflows/nico-partner-boundary-manual.yml',import.meta.url),'utf8');
const cli=new URL('../tools/production/release-partner-boundary.mjs',import.meta.url);
test('the legacy production dispatch exposes VERIFY_ONLY, never an apply option',()=>{
 assert.match(wf,/options: \[verify\]/);
 assert.match(wf,/default: verify/);
 assert.match(wf,/inputs\.mode == 'verify' && inputs\.rules_approval == 'VERIFY_ONLY'/);
 assert.match(wf,/case "\$RELEASE_MODE" in verify\)/);
 assert.doesNotMatch(wf,/options: \[verify, apply\]|case "\$RELEASE_MODE" in verify\|apply/);
});
test('direct CLI apply stops before requiring a credential or connecting to a project',()=>{
 const result=spawnSync(process.execPath,[cli.pathname,'apply'],{
  encoding:'utf8',timeout:5000,
  env:{PATH:process.env.PATH||'',GITHUB_ACTIONS:'true',RUNNER_TEMP:'/dev/null',
   FIREBASE_PROJECT_ID:'sales-management-cc116',
   NICO_USAGE_APPROVAL:'EXISTING_FUNCTIONS_AND_FULL_INVENTORY_APPROVED',
   NICO_RULES_APPROVAL:'APPROVED_PARTNER_BOUNDARY_ONLY'}
 });
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.match(result.stderr,/STOP_LEGACY_APPLY_DISABLED_REAL_UID_PROOF_REQUIRED/);
 assert.doesNotMatch(result.stderr,/private_key|access_token|Bearer|service-account/);
});
test('synthetic release rollback library survives for regression, while CLI verify remains available',()=>{
 const source=readFileSync(cli,'utf8');
 assert.match(source,/export async function releaseBoundary\(/);
 assert.match(source,/if\(!apply\)return summary/);
 assert.match(source,/if\(mode==='apply'\)stop\('LEGACY_APPLY_DISABLED_REAL_UID_PROOF_REQUIRED'\)/);
 assert.match(source,/if\(mode!=='verify'/);
 assert.match(source,/NICO_RULES_APPROVAL!=='VERIFY_ONLY'/);
 assert.match(wf,/node tools\/production\/release-partner-boundary\.mjs \$RELEASE_MODE/);
});
