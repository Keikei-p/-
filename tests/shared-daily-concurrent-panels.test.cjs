const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
function extract(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'expected current production-page function markers');
  return html.slice(a, b);
}
const initialization = extract('let sharedDailyRankingGeneration=0;', 'function verifiedDirectDayCounts(date)');
const loader = extract('async function loadSharedDailyStandings(where,force=false){', '// Explicit opt-in monthly count mode.');

function fixture() {
  const pending = [];
  const rendered = [];
  const nodes = {};
  const auth = { currentUser: { uid: 'owner' } };
  for (const kind of ['Individual', 'Product']) {
    nodes['ownerSharedDate' + kind] = { value: '2026-11-04' };
    nodes['ownerSharedStatus' + kind] = { textContent: '' };
    nodes['ownerSharedContent' + kind] = { replaceChildren() { this.cleared = true; } };
  }
  const ctx = {
    Map, Date, auth,
    getTodayString: () => '2026-11-04',
    canReadSharedCountOnlyRanks: () => true,
    PARTNER_QUICK_RANK_KEYS: ['NURO'],
    pInline: id => {
      assert.ok(nodes[id], 'missing node: ' + id);
      return nodes[id];
    },
    readPartnerWorkDay: () => new Promise(resolve => pending.push(resolve)),
    ownerJointIndividualMode: true,
    ownerJointProductMode: true,
    renderOwnerJointIndividualRanking: () => rendered.push('Individual'),
    renderOwnerJointProductRanking: () => rendered.push('Product'),
    console: { error() {} },
  };
  vm.runInNewContext(initialization + '\n' + loader + '\nthis.run=loadSharedDailyStandings;', ctx);
  const response = {
    scope: 'shared_counts_only', role: 'hub', date: '2026-11-04',
    companies: [], teams: [], people: [], categories: ['NURO'],
    productCounts: { NURO: 0 }, additionalTotalCount: 0,
    complete: true, includesDirect: true,
    direct: { people: [], teams: [], counts: { NURO: 2 },
      totalCount: 2, otherCount: 0, recordsVerified: 1 }
  };
  return {
    run: ctx.run, pending, rendered, auth, nodes,
    resolve(index) { pending[index]({ data: response }); },
    invalidate() { vm.runInNewContext('++sharedDailyRankingGeneration;', ctx); },
  };
}

test('individual and product ranking cards can finish simultaneous reads independently', async () => {
  const f = fixture();
  const individual = f.run('Individual', true);
  const product = f.run('Product', true);
  assert.equal(f.pending.length, 2);
  f.resolve(1); await product;
  f.resolve(0); await individual;
  assert.deepEqual(f.rendered, ['Product', 'Individual']);
});

test('an obsolete result for the same card is not rendered', async () => {
  const f = fixture();
  const old = f.run('Individual', true);
  const recent = f.run('Individual', true);
  f.resolve(1); await recent;
  f.resolve(0); await old;
  assert.deepEqual(f.rendered, ['Individual']);
});

test('global invalidation after logout/period switch still discards pending results', async () => {
  for (const kind of ['logout', 'switch']) {
    const f = fixture();
    const task = f.run('Product', true);
    if (kind === 'logout') f.auth.currentUser = null;
    else f.invalidate();
    f.resolve(0); await task;
    assert.deepEqual(f.rendered, [], kind);
  }
});
