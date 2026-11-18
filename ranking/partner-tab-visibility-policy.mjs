/**
 * One Hub-Owner policy for EVERY partner company (no per-company tab overrides).
 * This is a PURE policy/UI projection: it NEVER reads/writes Firestore, Auth,
 * sales records, ranking aggregates, financial records, or partner history.
 *
 * Security boundary: caller MUST obtain this contract from an authenticated,
 * server-authorized Hub policy endpoint. Hiding DOM does NOT replace server
 * denials of finance endpoints and unpublished count/ranking endpoints.
 * No production caller or writer is introduced by this module.
 */
export const PARTNER_PUBLICATION_SCHEMA = "nico-partner-tabs-v1";

export const PARTNER_OPTIONAL_TABS = Object.freeze([
  Object.freeze({ id: "product", label: "商材ランキング" }),
  Object.freeze({ id: "team", label: "班ランキング" }),
  Object.freeze({ id: "individual", label: "個人ランキング" }),
  Object.freeze({ id: "detail", label: "班詳細" }),
  Object.freeze({ id: "report", label: "報告文" }),
  Object.freeze({ id: "daily", label: "日別" }),
  Object.freeze({ id: "history", label: "登録履歴" }),
  Object.freeze({ id: "goal", label: "目標日割り" })
]);

const tabIds = new Set(PARTNER_OPTIONAL_TABS.map(item => item.id));
const fail = () => { throw new Error("PARTNER_TABS_UNVERIFIED_OR_FORBIDDEN"); };
const plain = value => value !== null && typeof value === "object" &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const exact = (object, keys) => plain(object) &&
  Object.keys(object).length === keys.length &&
  Object.keys(object).every(key => keys.includes(key));
const safeRevision = version => Number.isSafeInteger(version) &&
  version >= 0 && version <= 2147483647;
const normalizeIds = ids => {
  if (!Array.isArray(ids) || ids.length > PARTNER_OPTIONAL_TABS.length) fail();
  const unique = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || !tabIds.has(id) || unique.has(id)) fail();
    unique.add(id);
  }
  // Canonical order is shared across Owner settings and all partner companies.
  return Object.freeze(PARTNER_OPTIONAL_TABS
    .filter(tab => unique.has(tab.id)).map(tab => tab.id));
};

const frozen = (revision, published, enabled) => Object.freeze({
  schema: PARTNER_PUBLICATION_SCHEMA,
  revision,
  published,
  tabs: Object.freeze([...enabled])
});

/**
 * Only the server-authorized Hub/Owner endpoint may supply this document.
 * Missing means unpublished, NOT "all" (zero optional tabs are public).
 * Never accept a partner-company override, browser role, or financial keys.
 */
export function readVerifiedPartnerTabPolicy(document) {
  if (document === null || document === undefined)
    return frozen(0, false, []);
  if (!exact(document, ["schema", "revision", "published", "tabs"]) ||
      document.schema !== PARTNER_PUBLICATION_SCHEMA ||
      !safeRevision(document.revision) ||
      typeof document.published !== "boolean") fail();
  const ids = normalizeIds(document.tabs);
  return frozen(document.revision, document.published,
    document.published ? ids : []);
}

/**
 * Called ONLY on deliberate Hub Owner "公開設定を保存" action. The server
 * MUST recheck verified Owner membership, revision CAS, whole-company scope,
 * and reject partner writers. This returns data, NOT a database mutation.
 */
export function prepareOwnerTabPublication(selectedIds, expectedRevision) {
  if (!safeRevision(expectedRevision)) fail();
  return Object.freeze({
    schema: PARTNER_PUBLICATION_SCHEMA,
    expectedRevision,
    published: true,
    tabs: normalizeIds(selectedIds)
  });
}

/** Partner UI shows only explicitly published optional tabs, or none. */
export function visiblePartnerTabs(verifiedServerPolicy) {
  const policy = readVerifiedPartnerTabPolicy(verifiedServerPolicy);
  return Object.freeze(PARTNER_OPTIONAL_TABS.filter(tab =>
    policy.published && policy.tabs.includes(tab.id)));
}

/** Critical input and company management remain on their existing secure path. */
export const PARTNER_ALWAYS_AVAILABLE_ACTION = "record";
export const PARTNER_UNAVAILABLE_FINANCE_TABS = Object.freeze([
  "salesAnalysis", "revenueChart", "finance", "unitPrice",
  "cashback", "revenueGoals"
]);
