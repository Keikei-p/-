/**
 * STAGING ONLY / NO DEPLOY.
 * One Owner-selected publication for every associated partner company.
 * Dedicated settings + append-only audit ONLY. No sales/count/finance reads
 * or mutations. Client-supplied hub/role/company cannot grant access.
 *
 * All requested tabs must be enforced by the partner count API BEFORE any
 * live UI enables this setting; a hidden DOM tab is never a security fence.
 */
import {createHash} from "node:crypto";
const CODE_SESSION=/^[A-Za-z0-9_-]{43}$/;
const COMPANY_CODE=/^NICO-[A-F0-9]{24}$/;

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

  async function verifiedPartnerViewer(tx, actor, workspaceCompanyId="",strictOptional=false) {
    if(!principalOk(actor)||typeof workspaceCompanyId!=="string"||
       (workspaceCompanyId!==""&&!okId(workspaceCompanyId))) blocked();
    const [us,secondary] = await Promise.all([
      tx.get(col("users").doc(actor.uid)),
      tx.get(col("partnerWorkspaceContexts").doc(actor.uid))
    ]);
    const user = read(us), context = read(secondary);
    if(!obj(user)||user.uid!==actor.uid||!okId(user.companyId)||
       user.active!==true||
       (typeof user.email==="string"&&
        user.email.trim().toLowerCase()!==actor.email.toLowerCase()))blocked();
    const partner=workspaceCompanyId||user.companyId;
    const isSecondary=partner!==user.companyId;
    // An internal primary account may only read a partner workspace through
    // its current, independently authenticated secondary membership. NEVER
    // interpret a browser company ID or role as authorization.
    if(isSecondary){
      if(!obj(context)||secondary.exists!==true||
         context.active!==true||context.kind!=="partner_secondary"||
         context.uid!==actor.uid||context.primaryCompanyId!==user.companyId||
         context.partnerCompanyId!==partner||!okId(context.hubCompanyId)||
         typeof context.emailLower!=="string"||
         context.emailLower!==actor.email.toLowerCase()||
         !["owner","leader","member"].includes(context.role)||
         !["internal",undefined,null].includes(user.accessKind)||
         !["internal","direct","member","managed",undefined,null].includes(user.memberType)||
         user.authKind==="partner_code_shared")blocked();
      const [primaryCompanySnap,primaryMemberSnap]=await Promise.all([
        tx.get(company(user.companyId)),
        tx.get(company(user.companyId).collection("members").doc(actor.uid))
      ]);
      const primaryCompany=read(primaryCompanySnap),primaryMember=read(primaryMemberSnap);
      if(!obj(primaryCompany)||!obj(primaryMember)||
         primaryCompany.active===false||
         !["internal","direct",undefined,null].includes(primaryCompany.companyKind)||
         primaryMember.uid!==actor.uid||primaryMember.active!==true||
         (primaryMember.companyId!=null&&primaryMember.companyId!==user.companyId)||
         !["internal",undefined,null].includes(primaryMember.accessKind)||
         !["internal","direct","member","managed",undefined,null].includes(primaryMember.memberType))
       blocked();
    }else{
      // A direct partner identity with another active workspace must not
      // silently acquire a second company's tab policy.
      if(secondary.exists===true&&context?.active!==false)blocked();
      if(user.accessKind!=="partner"||user.memberType!=="cooperator"||
         user.canViewRevenue!==false||user.canViewUnitPrice!==false)blocked();
    }
    const [cs,ms,rel]=await Promise.all([
      tx.get(company(partner)),
      tx.get(company(partner).collection("members").doc(actor.uid)),
      tx.get(col("partnerRelations").doc(partner))
    ]);
    const c=read(cs),m=read(ms),relation=read(rel);
    if(!obj(c)||c.companyKind!=="partner"||!okId(c.hubCompanyId)||
       c.active!==true||!obj(m)||m.uid!==actor.uid||m.active!==true||
       m.accessKind!=="partner"||m.memberType!=="cooperator"||
       m.canViewRevenue!==false||m.canViewUnitPrice!==false||
       (m.companyId!=null&&m.companyId!==partner)||
       !obj(relation)||relation.active!==true||
       relation.countSharingApproved!==true||
       relation.partnerCompanyId!==partner||
       relation.hubCompanyId!==c.hubCompanyId)blocked();
    // The existing code-principal login has an independent revocable
    // credential record. Never infer access solely from a historical
    // users/{uid} + member row if that credential was disabled.
    // This is a defensive DENY for any JWT identity carrying code auth;
    // opaque codeSessionToken authentication is NOT supported by these
    // new Firebase onCall endpoints and still requires a separate E2E gate.
    if(user.authKind==="partner_code_shared"){
      if(isSecondary||workspaceCompanyId!==""||
         c.companyCodePrincipalUid!==actor.uid||
         m.authKind!=="partner_code_shared"||
         user.companyRole!=="owner"||m.companyRole!=="owner"||
         user.canViewRevenue!==false||user.canViewUnitPrice!==false)
        blocked();
      const credential=read(await tx.get(
        col("partnerCodeCredentials").doc(partner)));
      if(!obj(credential)||credential.active!==true||
         credential.companyId!==partner||
         credential.principalUid!==actor.uid)blocked();
    }else if(m.authKind==="partner_code_shared")blocked();
    if(isSecondary){
      if(c.hubCompanyId!==context.hubCompanyId)blocked();
      const owner=context.role==="owner"&&c.ownerUid===actor.uid&&
       c.masterUid===actor.uid&&m.companyRole==="owner"&&
       m.role==="leader"&&m.teamId==null;
      const worker=["leader","member"].includes(context.role)&&
       m.companyRole==="member"&&m.role===context.role&&
       okId(context.teamId)&&m.teamId===context.teamId&&
       c.ownerUid!==actor.uid;
      if(!owner&&!worker)blocked();
    }
    const hs=await tx.get(company(c.hubCompanyId));
    const hub=read(hs);
    if(!obj(hub)||hub.active===false||!okId(hub.ownerUid)||
       !["internal","direct",undefined,null].includes(hub.companyKind))blocked();
    // Strict same-member count scope for optional records. A partner member
    // never inherits another staff person's history merely from a company ID.
    let role,teamId=null;
    if(strictOptional===true){
    if(isSecondary){
      role=context.role;
      teamId=role==="owner"?null:context.teamId;
    }else if(c.ownerUid===actor.uid&&user.companyRole==="owner"&&
       m.companyRole==="owner"){
      role="owner";
    }else if(user.companyRole==="member"&&m.companyRole==="member"&&
       ["leader","member"].includes(user.role)&&m.role===user.role&&
       okId(user.teamId)&&m.teamId===user.teamId&&c.ownerUid!==actor.uid){
      role=user.role;teamId=user.teamId;
    }else if(user.authKind==="partner_code_shared"&&
       c.companyCodePrincipalUid===actor.uid&&
       user.companyRole==="owner"&&m.companyRole==="owner"&&
       user.canViewRevenue===false&&user.canViewUnitPrice===false){
      role="owner";
    }else blocked();
    }
    return {hub:c.hubCompanyId,ownerUid:hub.ownerUid,
      partner,uid:actor.uid,role,teamId,companyName:c.name};
  }

  // The existing partner-workspace uses an opaque codeSessionToken, not a
  // Firebase email ID token. Revalidate that exact existing credential model
  // inside the SAME read-only transaction as Owner publication and counts.
  // Never persist, echo, log or include the supplied opaque token in output.
  async function verifiedCodeSessionPartner(tx,opaque) {
    if(typeof opaque!=="string"||!CODE_SESSION.test(opaque))blocked();
    const hash=createHash("sha256").update(opaque).digest("hex");
    const session=read(await tx.get(col("partnerCodeSessions").doc(hash)));
    const ms=session;
    if(!obj(ms)||ms.active!==true||!okId(ms.principalUid)||
       !okId(ms.companyId)||!validVersion(ms.version)||ms.version<1||
       !COMPANY_CODE.test(ms.companyCode)||
       typeof ms.expiresAt?.toMillis!=="function"||
       !Number.isFinite(ms.expiresAt.toMillis())||
       ms.expiresAt.toMillis()<=Date.now())blocked();
    const uid=ms.principalUid,cid=ms.companyId;
    const [credentialSnap,loginSnap,userSnap,companySnap,
      memberSnap,relationSnap]=await Promise.all([
      tx.get(col("partnerCodeCredentials").doc(cid)),
      tx.get(col("partnerCodeLogins").doc(ms.companyCode)),
      tx.get(col("users").doc(uid)),tx.get(company(cid)),
      tx.get(company(cid).collection("members").doc(uid)),
      tx.get(col("partnerRelations").doc(cid))
    ]);
    const credential=read(credentialSnap),login=read(loginSnap);
    const user=read(userSnap),c=read(companySnap),m=read(memberSnap);
    const relation=read(relationSnap);
    if(!obj(credential)||credential.active!==true||
       credential.companyId!==cid||credential.principalUid!==uid||
       credential.companyCode!==ms.companyCode||
       credential.version!==ms.version||
       !obj(login)||login.status!=="active"||
       login.principalUid!==uid||login.partnerCompanyId!==cid||
       login.version!==ms.version||
       !obj(user)||user.active!==true||user.uid!==uid||
       user.companyId!==cid||user.authKind!=="partner_code_shared"||
       user.accessKind!=="partner"||user.memberType!=="cooperator"||
       user.companyRole!=="owner"||user.canViewRevenue!==false||
       user.canViewUnitPrice!==false||
       !obj(c)||c.active!==true||c.companyKind!=="partner"||
       c.companyCodePrincipalUid!==uid||!okId(c.hubCompanyId)||
       !obj(m)||m.active!==true||m.uid!==uid||m.companyId!==cid||
       m.authKind!=="partner_code_shared"||
       m.accessKind!=="partner"||m.memberType!=="cooperator"||
       m.companyRole!=="owner"||m.canViewRevenue!==false||
       m.canViewUnitPrice!==false||
       !obj(relation)||relation.active!==true||
       relation.countSharingApproved!==true||
       relation.partnerCompanyId!==cid||
       relation.hubCompanyId!==c.hubCompanyId)blocked();
    const hub=read(await tx.get(company(c.hubCompanyId)));
    if(!obj(hub)||hub.active===false||!okId(hub.ownerUid)||
       ![undefined,null,"internal","direct"].includes(hub.companyKind)||
       typeof c.name!=="string"||c.name.trim().length===0||
       c.name.trim().length>80)blocked();
    return {hub:c.hubCompanyId,ownerUid:hub.ownerUid,
      partner:cid,uid,role:"owner",teamId:null,companyName:c.name};
  }

  async function readOwner(actor) {
    return db.runTransaction(async tx => {
      const {hub,uid}=await verifiedHubOwner(tx,actor);
      return publicShape(state(read(await tx.get(config(hub))),hub,uid));
    },{readOnly:true});
  }

  async function readPartner(actor,workspaceCompanyId="") {
    return db.runTransaction(async tx => {
      const {hub,ownerUid}=await verifiedPartnerViewer(tx,actor,workspaceCompanyId);
      return publicShape(state(read(await tx.get(config(hub))),hub,ownerUid));
    },{readOnly:true});
  }

  async function readPartnerCodeSession(codeSessionToken){
    return db.runTransaction(async tx=>{
      const who=await verifiedCodeSessionPartner(tx,codeSessionToken);
      return publicShape(state(read(await tx.get(config(who.hub))),
       who.hub,who.ownerUid));
    },{readOnly:true});
  }

  async function readPublishedOptional({actor,codeSessionToken,
    workspaceCompanyId="",tab,date,reader}={}){
    if(!["report","daily","history","goal"].includes(tab)||
       typeof reader!=="function"||
       typeof date!=="string"||
       !/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)||
       Number.isNaN(Date.parse(date+"T00:00:00Z"))||
       new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date)
      blocked();
    return db.runTransaction(async tx=>{
      const codeMode=codeSessionToken!==undefined;
      if(codeMode&&(actor!==undefined||workspaceCompanyId!==""))blocked();
      const who=codeMode?
        await verifiedCodeSessionPartner(tx,codeSessionToken):
        await verifiedPartnerViewer(tx,actor,workspaceCompanyId,true);
      const p=state(read(await tx.get(config(who.hub))),who.hub,who.ownerUid);
      if(p.published!==true||!p.tabs.includes(tab))blocked();
      // No second policy query: authenticated membership, the Owner's current
      // selection, source entries and audits use THIS read-only transaction.
      const result=await reader({tx,db,identity:who,tab,date});
      if(!obj(result)||result.tab!==tab||result.date!==date||
         result.schema!=="nico-published-partner-optional-v1")
        blocked();
      return result;
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

  return Object.freeze({readOwner,readPartner,readPartnerCodeSession,
    readPublishedOptional,saveOwner});
}
