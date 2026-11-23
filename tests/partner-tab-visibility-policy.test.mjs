import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTNER_PUBLICATION_SCHEMA as SCHEMA,
  PARTNER_OPTIONAL_TABS as TABS,
  PARTNER_ALWAYS_AVAILABLE_ACTION,
  PARTNER_UNAVAILABLE_FINANCE_TABS,
  prepareOwnerTabPublication,
  readVerifiedPartnerTabPolicy,
  visiblePartnerTabs
} from "../ranking/partner-tab-visibility-policy.mjs";

const saved = (overrides = {}) => ({
  schema: SCHEMA, revision: 12, published: true,
  tabs: ["history", "team", "report"], ...overrides
});
const reject = fn => assert.throws(fn, /PARTNER_TABS_UNVERIFIED_OR_FORBIDDEN/);

test("all eight count-only options in stable shared display order", () => {
  assert.deepEqual(TABS.map(tab => tab.label), [
    "商材ランキング", "班ランキング", "個人ランキング", "班詳細",
    "報告文", "日別", "登録履歴", "目標日割り"
  ]);
  assert.equal(new Set(TABS.map(tab => tab.id)).size, 8);
  assert.equal(PARTNER_ALWAYS_AVAILABLE_ACTION, "record");
  assert.equal(TABS.some(tab => PARTNER_UNAVAILABLE_FINANCE_TABS.includes(tab.id)), false);
});

test("unpublished, absent and explicitly cleared policies disclose no optional tabs", () => {
  assert.deepEqual(visiblePartnerTabs(null), []);
  assert.deepEqual(visiblePartnerTabs(undefined), []);
  assert.deepEqual(visiblePartnerTabs(saved({ published: false })), []);
  assert.deepEqual(visiblePartnerTabs(saved({ tabs: [] })), []);
  assert.deepEqual(readVerifiedPartnerTabPolicy(null), {
    schema: SCHEMA, revision: 0, published: false, tabs: []
  });
});

test("one common Owner publication produces one order for all companies", () => {
  const fromServer = saved();
  const initial = structuredClone(fromServer);
  const first = visiblePartnerTabs(fromServer);
  const partnerA = visiblePartnerTabs(fromServer).map(tab => tab.id);
  const partnerB = visiblePartnerTabs(fromServer).map(tab => tab.id);
  assert.deepEqual(partnerA, ["team", "report", "history"]);
  assert.deepEqual(partnerB, partnerA);
  assert.deepEqual(first.map(tab => tab.label), ["班ランキング", "報告文", "登録履歴"]);
  assert.deepEqual(fromServer, initial);
});

test("Owner can explicitly publish eight, some, or zero without rewriting history", () => {
  const ids = TABS.map(tab => tab.id).reverse();
  const before = [...ids];
  const full = prepareOwnerTabPublication(ids, 12);
  assert.deepEqual(full.tabs, TABS.map(tab => tab.id));
  assert.equal(full.expectedRevision, 12);
  assert.equal(full.published, true);
  assert.deepEqual(ids, before);
  assert.deepEqual(prepareOwnerTabPublication([], 12).tabs, []);
  assert.equal("records" in full, false);
  assert.equal("companyId" in full, false);
  assert.equal("partnerWorkEntries" in full, false);
  assert.equal(Object.isFrozen(full), true);
  assert.equal(Object.isFrozen(full.tabs), true);
});

test("invalid IDs, duplicates, unknown capabilities and finance cannot be published", () => {
  for (const id of [
    "salesAnalysis", "revenueChart", "unitPrice", "cb", "amount",
    "finance", "recordCorrections", "companies", "__proto__"
  ]) {
    reject(() => prepareOwnerTabPublication([id], 5));
    reject(() => visiblePartnerTabs(saved({ tabs: [id] })));
  }
  reject(() => prepareOwnerTabPublication(["team", "team"], 5));
  reject(() => prepareOwnerTabPublication(["report"], -1));
  reject(() => prepareOwnerTabPublication(["report"], NaN));
  reject(() => prepareOwnerTabPublication("report", 0));
});

test("unexpected client role, per-company overrides, finance payload and bad schema fail closed", () => {
  reject(() => readVerifiedPartnerTabPolicy({ ...saved(), companyId: "partnerA" }));
  reject(() => readVerifiedPartnerTabPolicy({ ...saved(), role: "owner" }));
  reject(() => readVerifiedPartnerTabPolicy({ ...saved(), revenue: 1 }));
  reject(() => readVerifiedPartnerTabPolicy({ ...saved(), partnerOverrides: {} }));
  reject(() => readVerifiedPartnerTabPolicy(saved({ revision: "12" })));
  reject(() => readVerifiedPartnerTabPolicy(saved({ published: "true" })));
  reject(() => readVerifiedPartnerTabPolicy(saved({ schema: "v0" })));
  reject(() => readVerifiedPartnerTabPolicy(saved({ tabs: ["team", "team"] })));
  reject(() => readVerifiedPartnerTabPolicy(saved({ tabs: null })));
});

test("output is immutable, input history is untouched, no side effect available", () => {
  const source = saved({ tabs: ["goal", "daily"] });
  const before = structuredClone(source);
  const view = readVerifiedPartnerTabPolicy(source);
  assert.deepEqual(view.tabs, ["daily", "goal"]);
  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.tabs), true);
  assert.throws(() => { view.tabs.push("revenueChart"); }, TypeError);
  assert.equal(JSON.stringify(view).includes("revenue"), false);
});
