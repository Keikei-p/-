/**
 * STAGING ONLY / NO DEPLOY.
 * One Owner-selected publication for every associated partner company.
 * Dedicated settings + append-only audit ONLY. No sales/count/finance reads
 * or mutations. Client-supplied hub/role/company cannot grant access.
 *
 * All requested tabs must be enforced by the partner count API BEFORE any
 * live UI enables this setting; a hidden DOM tab is never a security fence.
 */
const VALID_TABS = Object.freeze([
  "product", "team", "individual", "detail",
  "report", "daily", "history", "goal"
]);
const ALLOWED = new Set(VALID_TABS);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCHEMA = "nico-partner-tabs-v1";
const blocked = () => { throw Error("PARTNER_TAB_PUBLICATION_NOT_AUTHORIZED_OR_UNVERIFIED"); };
const okId = x => typeof x === "string" && ID.test(x) &&
  !["__proto__", "constructor", "prototype"].includes(x);
const obj = x => !!x && typeof x === "object" && !Array.isArray(x);
const read = snap => snap?.exists === true && typeof snap.data === "function"
  ? snap.data() : null;
const validVersion = x => Number.isSafeInteger(x) && x >= 0 && x <= 999999;
function tabs(value) {
  if (!Array.isArray(value) || value.length > VALID_TABS.length) blocked();
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== "string" || !ALLOWED.has(id) || seen.has(id)) blocked();
    seen.add(id);
  }
  return VALID_TABS.filter(id => seen.has(id));
}
function principalOk(principal) {
  return okId(principal?.uid) && principal.emailVerified === true &&
    typeof principal.email === "string" && EMAIL.test(principal.email);
}
function state(saved, hub, uid) {
  if (saved == null) return {version:0,published:false,tabs:[]};
  if (!obj(saved) || saved.schema !== SCHEMA ||
    saved.hubCompanyId !== hub || saved.ownerUid !== uid ||
    !validVersion(saved.version) || saved.version < 1 ||
    typeof saved.published !== "boolean") blocked();
  return {version:saved.version,published:saved.published,tabs:tabs(saved.tabs)};
}
const publicShape = value => Object.freeze({
  schema:SCHEMA,
  revision:value.version,
  published:value.published,
  tabs:Object.freeze(value.published ? [...value.tabs] : [])
});

export const PARTNER_TAB_ALLOWED_IDS = VALID_TABS;
export function createPartnerTabPublicationStore({db,FieldValue}={}) {
  if (!db || typeof db.collection !== "function" ||
      typeof db.runTransaction !== "function" ||
      typeof FieldValue?.serverTimestamp !== "function") blocked();
  const col = name => db.collection(name);
  const company = id => col("companies").doc(id);
  const config = hub => company(hub).collection("partnerTabPublication").doc("shared");
  const audit = hub => company(hub).collection("partnerTabPublicationAudits").doc();

  async function verifiedHubOwner(tx, actor) {
    if (!principalOk(actor)) blocked();
    const [us,secondary] = await Promise.all([
      tx.get(col("users").doc(actor.uid)),
      tx.get(col("partnerWorkspaceContexts").doc(actor.uid))
    ]);
    const user = read(us), other = read(secondary);
    if (!obj(user) || user.uid !== actor.uid || !okId(user.companyId) ||
        user.active !== true || user.companyRole !== "owner" ||
        user.authKind === "partner_code_shared" ||
        user.accessKind === "partner" ||
        user.memberType === "cooperator" ||
        (typeof user.email === "string" &&
         user.email.trim().toLowerCase() !== actor.email.toLowerCase()) ||
        (secondary.exists === true && other?.active !== false)) blocked();
    const hub = user.companyId;
    const [cs,ms] = await Promise.all([
      tx.get(company(hub)), tx.get(company(hub).collection("members").doc(actor.uid))
    ]);
    const c = read(cs), m = read(ms);
    if (!obj(c) || !obj(m) || c.ownerUid !== actor.uid ||
        c.active === false || ![undefined,null,"internal","direct"].includes(c.companyKind) ||
        m.uid !== actor.uid || m.companyRole !== "owner" || m.active !== true ||
        (m.companyId != null && m.companyId !== hub) ||
        m.accessKind === "partner" || m.memberType === "cooperator") blocked();
    return {hub,uid:actor.uid};
  }

  async function verifiedPartnerViewer(tx, actor) {
    if (!principalOk(actor)) blocked();
    const [us,secondary] = await Promise.all([
      tx.get(col("users").doc(actor.uid)),
      tx.get(col("partnerWorkspaceContexts").doc(actor.uid))
    ]);
    const user = read(us), context = read(secondary);
    // Secondary financial identities are NOT unlocked by browser role flags.
    // Future secondary-authorized readers must add their own audited identity proof.
    if (secondary.exists === true && context?.active !== false) blocked();
    if (!obj(user) || user.uid !== actor.uid || !okId(user.companyId) ||
        user.active !== true || user.accessKind !== "partner" ||
        user.memberType !== "cooperator" ||
        user.canViewRevenue !== false || user.canViewUnitPrice !== false ||
        (typeof user.email === "string" &&
         user.email.trim().toLowerCase() !== actor.email.toLowerCase())) blocked();
    const partner = user.companyId;
    const [cs,ms,rel] = await Promise.all([
      tx.get(company(partner)),
      tx.get(company(partner).collection("members").doc(actor.uid)),
      tx.get(col("partnerRelations").doc(partner))
    ]);
    const c=read(cs), m=read(ms), relation=read(rel);
    if (!obj(c) || c.companyKind !== "partner" ||
        !okId(c.hubCompanyId) || c.active !== true ||
        !obj(m) || m.uid !== actor.uid || m.active !== true ||
        m.accessKind !== "partner" || m.memberType !== "cooperator" ||
        m.canViewRevenue !== false || m.canViewUnitPrice !== false ||
        (m.companyId != null && m.companyId !== partner) ||
        !obj(relation) || relation.active !== true ||
        relation.countSharingApproved !== true ||
        relation.partnerCompanyId !== partner ||
        relation.hubCompanyId !== c.hubCompanyId) blocked();
    const hs=await tx.get(company(c.hubCompanyId));
    const hub=read(hs);
    if (!obj(hub) || hub.active === false || !okId(hub.ownerUid) ||
        ![undefined,null,"internal","direct"].includes(hub.companyKind)) blocked();
    return {hub:c.hubCompanyId,ownerUid:hub.ownerUid};
  }

  async function readOwner(actor) {
    return db.runTransaction(async tx => {
      const {hub,uid}=await verifiedHubOwner(tx,actor);
      return publicShape(state(read(await tx.get(config(hub))),hub,uid));
    },{readOnly:true});
  }

  async function readPartner(actor) {
    return db.runTransaction(async tx => {
      const {hub,ownerUid}=await verifiedPartnerViewer(tx,actor);
      return publicShape(state(read(await tx.get(config(hub))),hub,ownerUid));
    },{readOnly:true});
  }

  async function saveOwner({actor,expectedRevision,published,selectedTabs}={}) {
    if (!validVersion(expectedRevision) || expectedRevision >= 999999 ||
        typeof published !== "boolean") blocked();
    const selection=tabs(selectedTabs);
    return db.runTransaction(async tx => {
      const {hub,uid}=await verifiedHubOwner(tx,actor);
      const ref=config(hub), oldSnap=await tx.get(ref);
      const before=state(read(oldSnap),hub,uid);
      if (before.version !== expectedRevision) blocked();
      if (before.published === published &&
          before.tabs.join("|") === selection.join("|")) {
        return {saved:false,...publicShape(before)};
      }
      const updated={schema:SCHEMA,hubCompanyId:hub,ownerUid:uid,
        version:before.version+1,published,tabs:selection,
        updatedByUid:uid,updatedAt:FieldValue.serverTimestamp()};
      if (oldSnap.exists) tx.update(ref,updated);
      else tx.create(ref,{...updated,createdAt:FieldValue.serverTimestamp()});
      tx.create(audit(hub),{schema:SCHEMA,version:updated.version,
        previousPublished:before.published,published,
        previousTabs:before.tabs,tabs:selection,
        changedByUid:uid,changedAt:FieldValue.serverTimestamp()});
      return {saved:true,...publicShape(updated)};
    });
  }

  return Object.freeze({readOwner,readPartner,saveOwner});
}
