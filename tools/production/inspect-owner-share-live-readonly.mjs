/**
 * READ ONLY, NO DEPLOY: production visibility of the existing Owner product
 * share panel. This is not authenticated user acceptance or finance-deny proof.
 * No Firestore, Auth user data, product records, hosting or function writes.
 */
export const ASSETS = Object.freeze({
  "/ranking/owner-product-visibility-dashboard-mount.mjs": "mountOwnerProductVisibilityDashboard",
  "/ranking/owner-product-visibility-firebase-bridge.mjs": "createOwnerProductVisibilityFirebaseBridge",
  "/ranking/owner-product-visibility-panel.mjs": "createOwnerProductVisibilityPanel"
});
const PROJECT = "sales-management-cc116";
const REGION = "asia-northeast1";
const PREFIX = "projects/" + PROJECT + "/locations/" + REGION + "/functions/";
const exact = x => typeof x === "string" && x.startsWith(PREFIX);
const enabled = x => x?.state === "ACTIVE" &&
  x?.serviceConfig?.environmentVariables?.NICO_OWNER_PRODUCT_VISIBILITY_ENABLED === "enabled";
const rankEnabled = x => x?.state === "ACTIVE" &&
  x?.serviceConfig?.environmentVariables?.NICO_JOINT_COUNT_RANKING_ENABLED === "enabled";

export function inspectOwnerShareLive({ publicFiles, cloudFunctions, mainIndexMatches } = {}) {
  if (!publicFiles || typeof publicFiles !== "object" ||
      !Array.isArray(cloudFunctions) || typeof mainIndexMatches !== "boolean")
    throw Error("OWNER_SHARE_AUDIT_EVIDENCE_MISSING");
  if (cloudFunctions.length === 0 || cloudFunctions.some(x => !exact(x?.name)) ||
      new Set(cloudFunctions.map(x => x.name)).size !== cloudFunctions.length)
    throw Error("OWNER_SHARE_AUDIT_CLOUD_SCOPE_INVALID");
  const index = publicFiles["/index.html"];
  if (!index || !Number.isInteger(index.status) || typeof index.body !== "string")
    throw Error("OWNER_SHARE_AUDIT_INDEX_UNVERIFIED");
  const indexReady = index.status === 200 &&
    index.body.includes("OWNER_PRODUCT_SHARE_INLINE_START") &&
    index.body.includes('id="ownerProductShareInline"') &&
    index.body.includes("mountOwnerProductVisibilityDashboard") &&
    mainIndexMatches;
  const assets = Object.fromEntries(Object.entries(ASSETS).map(([p, marker]) => {
    const row = publicFiles[p];
    if (!row || !Number.isInteger(row.status) || typeof row.body !== "string")
      throw Error("OWNER_SHARE_AUDIT_ASSET_UNVERIFIED");
    return [p, row.status === 200 && !row.body.includes("<!DOCTYPE html") &&
      row.body.includes(marker)];
  }));
  const functions = new Map(cloudFunctions.map(x => [x.name.slice(PREFIX.length), x]));
  const get = functions.get("getOwnerProductVisibility");
  const set = functions.get("setOwnerProductVisibility");
  const rank = functions.get("getVerifiedJointCountRanking");
  const visibilityGetActive = get?.state === "ACTIVE";
  const visibilitySetActive = set?.state === "ACTIVE";
  const visibilityGetEnabled = enabled(get);
  const visibilitySetEnabled = enabled(set);
  const rankingActive = rank?.state === "ACTIVE";
  const rankingEnabled = rankEnabled(rank);
  const assetsReady = Object.values(assets).every(Boolean);
  return Object.freeze({
    project: PROJECT, region: REGION,
    indexReady, mainIndexMatches, assets,
    assetsReady,
    functionsInventoried: cloudFunctions.length,
    visibilityGetActive: !!visibilityGetActive,
    visibilitySetActive: !!visibilitySetActive,
    visibilityGetEnabled: !!visibilityGetEnabled,
    visibilitySetEnabled: !!visibilitySetEnabled,
    rankingActive: !!rankingActive,
    rankingEnabled: !!rankingEnabled,
    ownerShareTechnicalReady: !!(indexReady && assetsReady &&
      visibilityGetEnabled && visibilitySetEnabled),
    realOwnerAuthenticatedGetVerified: false,
    partnerFinanceGetListDeniedVerified: false,
    actualOwnerToggleSaveVerified: false,
    firestoreWrites: 0, functionUpdates: 0, hostingWrites: 0
  });
}
