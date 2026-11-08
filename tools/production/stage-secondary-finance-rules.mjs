import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {originalRules, proposeSecondaryFinanceFence} from '../../security/secondary-finance-read-fence.mjs';

const project = 'sales-management-cc116';
const root = 'projects/' + project;
const releasePath = root + '/releases/cloud.firestore';
const collection = root + '/rulesets';
const fingerprint = '25fd2c0257e92beb5ba9e3b2f8b3a5801d2fa010188675c685c05051eafb12a8';
const validName = /^projects\/sales-management-cc116\/rulesets\/[a-zA-Z0-9_-]+$/;

export async function stageSecondaryRules(request) {
  const candidate = proposeSecondaryFinanceFence();
  assert.equal(createHash('sha256').update(candidate).digest('hex'), fingerprint);
  const read = async name => {
    assert.ok(validName.test(name), 'Unexpected ruleset name');
    const result = await request(name);
    assert.equal(result.name, name);
    return result.source?.files;
  };
  const current = (await request(releasePath)).rulesetName;
  const activeFiles = await read(current);
  assert.ok(activeFiles?.length === 1 && activeFiles[0].content === originalRules(), 'Active rules changed');
  const files = [{name: activeFiles[0].name, content: candidate}];
  // Check the project inventory before creating another immutable revision on retry.
  let nextPage = '', staged = '', created = false;
  do {
    const params = new URLSearchParams({pageSize: '100'});
    if (nextPage) params.set('pageToken', nextPage);
    const page = await request(collection + '?' + params);
    assert.ok(Array.isArray(page.rulesets), 'Missing ruleset inventory');
    for (const entry of page.rulesets) {
      const source = await read(entry.name);
      if (source?.length === 1 && source[0].name === files[0].name && source[0].content === candidate) {
        staged = entry.name;
        break;
      }
    }
    nextPage = page.nextPageToken;
  } while (!staged && nextPage);
  if (!staged) {
    assert.equal((await request(releasePath)).rulesetName, current);
    staged = (await request(collection, {source: {files}})).name;
    created = true;
  }
  const stored = await read(staged);
  assert.ok(stored?.length === 1 && stored[0].content === candidate && stored[0].name === files[0].name);
  assert.notEqual(staged, current);
  assert.equal((await request(releasePath)).rulesetName, current);
  return {created, staged, active: current, sha256: fingerprint};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.GITHUB_REPOSITORY, 'Keikei-p/-');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  const require = createRequire(new URL('../../functions-partner-workspace/package.json', import.meta.url));
  const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  assert.equal(key.project_id, project);
  const credential = require('firebase-admin/app').cert(key);
  const request = async (resource, body) => {
    const token = await credential.getAccessToken();
    const response = await fetch('https://firebaserules.googleapis.com/v1/' + resource, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: {Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw Error('Rules API returned ' + response.status + ' for ' + resource.split('?')[0]);
    return response.json();
  };
  console.log(await stageSecondaryRules(request));
}
