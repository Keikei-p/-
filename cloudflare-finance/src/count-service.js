/**
 * Financial record submission coordinator.
 * Production switch is in index.js and defaults to OFF.
 * All reads and writes pass through a transaction-capable adapter; no original
 * record or correction can be deleted by this module.
 */
import {buildRecordFromCounts,ValidationError} from "./write-plan.js";
import {visibleMoney} from "./revenue-scope.js";

export class SaveConflict extends Error {
  constructor(reason){super(reason);this.name="SaveConflict";this.status=409;}
}
export class PermissionDenied extends Error {
  constructor(){super("record_write_forbidden");this.name="PermissionDenied";this.status=403;}
}
function keyOf(doc) {
  return doc && typeof doc.id==="string" ? doc.id : null;
}
function stripInternal(document){
  if(!document)return null;
  const {__firestoreUpdateTime,...original}=document;
  return original;
}
function auditPayload(before,after,actor,recordId,date,companyId){
  const snapshot=value=>({
    memberNameSnapshot:value.memberNameSnapshot||"",
    teamId:value.teamId??null,
    teamNameSnapshot:value.teamNameSnapshot||"",
    workLocation:value.workLocation||"",
    results:value.results||{},
    totalCount:value.totalCount,
    totalRevenue:value.totalRevenue,
    reportStatus:value.reportStatus||"submitted"
  });
  return {
    companyId,recordId,recordUid:after.uid,recordDate:date,
    changedByUid:actor.uid,changedByName:actor.name||"名前未設定",
    before:snapshot(before),after:snapshot(after)
  };
}
/**
 * Store contract:
 *   store.runTransaction(async tx => {tx.get(path); tx.queryDaily(cid,uid,date);
 *     tx.saveRecord(id, data, oldVersion); tx.addCorrection(id, data); ...})
 * write staging and commit are atomic; a thrown error must abort.
 */
export async function submitCounts(store,principal,input,options={}){
  if(!principal?.uid)throw new PermissionDenied();
  const clock=options.now || (()=>new Date().toISOString());
  const policyResolver=options.policyResolver;
  if(typeof policyResolver!=="function")throw Error("policy_resolver_missing");
  const idProvider=options.newAuditId || (()=>crypto.randomUUID());
  const approved=await store.runTransaction(async tx=>{
    // All identity, role, product price, target team and existing record reads
    // must happen INSIDE the Firestore transaction, not before it.
    const user=await tx.get("users/"+principal.uid);
    if(!user?.companyId||!/^[a-zA-Z0-9_-]{1,128}$/.test(user.companyId)){
      throw new PermissionDenied();
    }
    const cid=user.companyId;
    const [member,company]=await Promise.all([
      tx.get("companies/"+cid+"/members/"+principal.uid),
      tx.get("companies/"+cid)
    ]);
    let policy;
    try{policy=policyResolver(user,member,company,principal.uid);}catch{throw new PermissionDenied();}
    if(!policy || policy.companyId!==cid || policy.uid!==principal.uid){
      throw new PermissionDenied();
    }
    // Never let the client assign the company or price.
    if(!input || !input.uid || !input.date || !input.teamId){
      throw new ValidationError("Missing target person, date or team");
    }
    const target=await tx.get("companies/"+cid+"/members/"+input.uid);
    const team=await tx.get("teams/"+input.teamId);
    if(!target || target.active===false)throw new PermissionDenied();
    // External partners can proxy only for current members assigned to
    // their team; a forged UID for another team must never be accepted.
    if(policy.isPartner && !policy.isPartnerCompanyOwner &&
       (policy.role!=="leader" || target.teamId!==policy.teamId)){
      throw new PermissionDenied();
    }
    // This is an intentional fail-closed restriction until proxy-eligibility
    // tests of historical team assignments cover every currently used flow.
    if(!policy.isOwner && policy.role!=="leader" && principal.uid!==input.uid){
      throw new PermissionDenied();
    }
    if(!policy.isOwner && input.teamId!==policy.teamId){
      throw new PermissionDenied();
    }
    const matches=await tx.queryDaily(cid,input.uid,input.date);
    if(matches.length>1)throw new SaveConflict("multiple_existing_daily_records");
    const existing=matches[0]||null;
    const canonicalId=cid+"_"+input.uid+"_"+input.date;
    if(existing && input.recordId!==existing.id){
      throw new SaveConflict("existing_record_requires_explicit_edit");
    }
    if(!existing && input.recordId && input.recordId!==canonicalId){
      throw new SaveConflict("cannot_create_legacy_document");
    }
    if(existing && !policy.isOwner && existing.teamId!==input.teamId){
      throw new PermissionDenied();
    }
    const currentVersion=existing?.__firestoreUpdateTime || null;
    if(existing && (!input.expectedRecordUpdateTime || input.expectedRecordUpdateTime!==currentVersion)){
      throw new SaveConflict("stale_or_missing_record_version");
    }
    if(!existing && input.expectedRecordUpdateTime){
      throw new SaveConflict("record_was_removed_or_changed");
    }
    // Product list must be read inside the transaction to prevent client-side
    // substitution of productId, cashback, price or company ownership.
    const products=await tx.queryProducts(cid);
    const now=clock();
    // Count-only corrections must not overwrite old location metadata with
    // a redacted value returned to the partner browser.
    const trustedIntent=policy.isPartner && existing?
      {...input,workLocation:existing.workLocation||""}:input;
    const built=buildRecordFromCounts(trustedIntent,policy,products,target,team,
      existing?{...existing,updatedAt:currentVersion}:null,now);
    // Do not rewrite any old financial values on unchanged line items.
    const recordId=existing?.id||canonicalId;
    if(built.recordId!==recordId)throw new SaveConflict("record_identity_mismatch");
    // Record and immutable correction audit are staged together.
    tx.saveRecord(recordId,built.document,currentVersion);
    if(existing){
      const correctionId=idProvider();
      if(!/^[a-f0-9-]{16,80}$/i.test(correctionId))throw Error("invalid_audit_identifier");
      tx.addCorrection(correctionId,auditPayload(stripInternal(existing),
        built.document,{uid:principal.uid,name:member?.name},recordId,input.date,cid));
    }
    // Safe event-driven refresh across the two URLs. No amounts in this doc.
    // Reject a missing atomic signal rather than silently losing synchronization.
    if(typeof tx.addSyncSignal!=="function")throw Error("secure_sync_not_available");
    tx.addSyncSignal(cid);
    return {recordId,totalCount:built.document.totalCount,
      totalRevenue:built.document.totalRevenue,canViewRevenue:visibleMoney(policy,built.document),
      canViewUnitPrice:policy.canViewUnitPrice,corrected:Boolean(existing)};
  });
  // No monetary value in unapproved responses, even when the trusted server
  // successfully persisted revenue.
  return {
    saved:true,recordId:approved.recordId,totalCount:approved.totalCount,
    corrected:approved.corrected,
    ...(approved.canViewRevenue?{totalRevenue:approved.totalRevenue}:{})
  };
}
