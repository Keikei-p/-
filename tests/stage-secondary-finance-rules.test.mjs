import test from 'node:test';
import assert from 'node:assert/strict';
import {stageSecondaryRules} from '../tools/production/stage-secondary-finance-rules.mjs';
import {originalRules} from '../security/secondary-finance-read-fence.mjs';

test('stage, read back, reuse, and stop on live drift without writing any release', async () => {
  const root = 'projects/sales-management-cc116';
  const collection = root + '/rulesets';
  const current = collection + '/existing', staged = collection + '/staged';
  const sets = new Map([[current, [{name: 'firestore.rules', content: originalRules()}]]]);
  let creations = 0;
  const request = async (path, body) => {
    if (body) {
      assert.equal(path, collection);
      creations++;
      sets.set(staged, body.source.files);
      return {name: staged};
    }
    if (path === root + '/releases/cloud.firestore') return {rulesetName: current};
    if (path.startsWith(collection + '?')) return {rulesets: [...sets.keys()].map(name => ({name}))};
    assert.ok(sets.has(path));
    return {name: path, source: {files: sets.get(path)}};
  };
  assert.equal((await stageSecondaryRules(request)).created, true);
  assert.equal((await stageSecondaryRules(request)).created, false);
  sets.get(current)[0].content += '\n';
  await assert.rejects(stageSecondaryRules(request), /Active rules changed/);
  assert.equal(creations, 1);
});
