/**
 * Phase-1 affected-secondary identity binding (NO DEPLOY, READ ONLY).
 *
 * Why: a random unprivileged user returning 403 does NOT prove that the
 * affected dual-membership partner is denied old internal financial access.
 * This independent trusted inventory checks exact Owner/Partner UIDs, the
 * secondary workspace context and both internal + partner memberships.
 *
 * Uses a privileged OAuth credential ONLY to GET the minimal identity docs.
 * The credential is NEVER used to prove Security Rules denial. That is done
 * later using the two real Firebase USER ID tokens in the live-role probe.
 *
 * No CLI, no production workflow, no writes, no logging of IDs, emails,
 * prices, tokens, document bodies or names. An injected fetch is synthetic,
 * never an approved production identity attestation.
 */
const PROJECT='sales-management-cc116';
const ROOT='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/';
const ID=/^[A-Za-z0-9_-]{1,128}$/;
// Keep name constraints aligned with partner-workspace submit()'s validName.
const STAFF_NAME=/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u;
const FINANCE_NAME=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const stop=code=>{throw Error('STOP_PHASE1_IDENTITY_'+code);};
const internalKinds=new Set(['internal','direct']);
const oldMemberTypes=new Set(['internal','direct','member','managed']);
const internalAccess=new Set(['internal']);
function internal(data){
  return internalKinds.has(data?.companyKind??'internal');
}
function internalUser(data){
  return internalAccess.has(data?.accessKind??'internal') &&
    oldMemberTypes.has(data?.memberType??'internal');
}
function value(field){
  if(field?.stringValue!==undefined && typeof field.stringValue==='string')
    return field.stringValue;
  if(typeof field?.booleanValue==='boolean')return field.booleanValue;
  return undefined;
}
function unpack(document,url){
  // Firestore Document.name is a resource path, not an HTTPS URL.
  if(document?.name!==url.slice('https://firestore.googleapis.com/v1/'.length) || !document.fields ||
     typeof document.fields!=='object'||Array.isArray(document.fields))
    stop('UNRECOGNIZED_DOCUMENT');
  const result=Object.create(null);
  for(const [key,field] of Object.entries(document.fields))
    result[key]=value(field);
  return result;
}

// Mirror the two legitimate secondary workspace account shapes in
// functions-partner-workspace/service.cjs. A partner owner is NOT companyRole
// "member"; rejecting one at the read-only audit blocks a valid cutover.
// Conversely, a mismatched team/role must never satisfy a real-UID 403 proof.
function matchingPartnerRole(context,company,member,uid){
  const owner=context.role==='owner'&&
    company.ownerUid===uid&&company.masterUid===uid&&
    member.companyRole==='owner'&&member.role==='leader'&&
    member.teamId==null;
  const worker=['leader','member'].includes(context.role)&&
    member.companyRole==='member'&&member.role===context.role&&
    ID.test(context.teamId||'')&&member.teamId===context.teamId&&
    company.ownerUid!==uid;
  return owner||worker;
}

/** Human-readable IDs are accepted only as private arguments, never output. */
export function createAffectedSecondaryIdentityVerifier({
  credential,expectedOwnerUid,expectedPartnerUid,
  internalCompanyId,partnerCompanyId,
  fetchImpl,now=()=>Date.now()
}={}){
  const source=fetchImpl===undefined?globalThis.fetch:fetchImpl;
  if(typeof source!=='function'||typeof now!=='function'||
     typeof credential?.getAccessToken!=='function')
    stop('DEPENDENCIES');
  if(![expectedOwnerUid,expectedPartnerUid,internalCompanyId,partnerCompanyId]
    .every(x=>ID.test(x||''))||
     expectedOwnerUid===expectedPartnerUid||
     internalCompanyId===partnerCompanyId)
    stop('INVALID_IDENTITY_SCOPE');
  const provenance=fetchImpl===undefined?'production-admin-readonly':'synthetic-only';
  let used=false;
  return async function attestAffectedSecondary(){
    if(used)stop('SINGLE_USE_ATTESTATION');
    used=true;
    const start=now();
    if(!Number.isFinite(start))stop('INVALID_CLOCK');
    let oauth;
    try{oauth=(await credential.getAccessToken())?.access_token;}
    catch{stop('AUTH_CREDENTIAL_UNAVAILABLE');}
    if(typeof oauth!=='string'||oauth.length<20||oauth.length>8192)
      stop('AUTH_CREDENTIAL_UNAVAILABLE');

    const read=async(path,optional=false)=>{
      const url=ROOT+path;
      let response;
      try {
        response=await source(url,{method:'GET',redirect:'error',headers:{
          Authorization:'Bearer '+oauth
        }});
      } catch {stop('IDENTITY_READ_FAILED');}
      if(optional && response?.status===404)return null;
      if(response?.status!==200)stop('IDENTITY_READ_UNVERIFIED');
      let data;
      try{data=await response.json();}
      catch{stop('IDENTITY_RESPONSE_INVALID');}
      return unpack(data,url);
    };
    const owner=await read('users/'+expectedOwnerUid);
    const company=await read('companies/'+internalCompanyId);
    const ownerMember=await read('companies/'+internalCompanyId+
      '/members/'+expectedOwnerUid);
    const ownerContext=await read('partnerWorkspaceContexts/'+expectedOwnerUid,true);
    // Owner must not be dual-context. Never use a finance-enabled leader as
    // the Owner proof, since leader permissions do not guarantee Owner parity.
    // Mirror scope(): a present-but-disabled or mismatched users/{uid}
    // record cannot authenticate, even if finance GET permissions look valid.
    // Internal Owner scope requires the actual ownerUid (not masterUid alone).
    if(ownerContext!==null || owner.uid!==expectedOwnerUid ||
       owner.companyId!==internalCompanyId ||
       owner.companyRole!=='owner' || owner.active!==true ||
       !internalUser(owner) || !internal(company) || company.active!==true ||
       ownerMember.uid!==expectedOwnerUid ||
       (ownerMember.companyId!=null&&ownerMember.companyId!==internalCompanyId)||
       ownerMember.companyRole!=='owner' || ownerMember.active!==true ||
       !internalUser(ownerMember) || company.ownerUid!==expectedOwnerUid)
      stop('OWNER_NOT_INDEPENDENTLY_BOUND');

    const context=await read('partnerWorkspaceContexts/'+expectedPartnerUid);
    const oldUser=await read('users/'+expectedPartnerUid);
    const oldMember=await read('companies/'+internalCompanyId+
      '/members/'+expectedPartnerUid);
    const partnerCompany=await read('companies/'+partnerCompanyId);
    const partnerMember=await read('companies/'+partnerCompanyId+
      '/members/'+expectedPartnerUid);
    // The live submitPartnerWorkspaceCounts Callable checks partnerRelations
    // on EVERY call. A disabled/mismatched relation can still yield a valid
    // partner 403 for money, but the user can no longer submit counts.
    // This must be detected BEFORE changing any live Security Rules.
    const relation=await read('partnerRelations/'+partnerCompanyId);
    if(relation.partnerCompanyId!==partnerCompanyId||
       relation.hubCompanyId!==internalCompanyId||
       relation.active!==true||relation.countSharingApproved!==true)
      stop('PARTNER_COUNT_SHARING_NOT_READY');
    // submitPartnerWorkspaceCounts explicitly refuses to write when today's
    // company report exists in an old/non-staff-entries-v1 format. A valid
    // getPartnerWorkspace response cannot prove this hidden write precondition.
    // Read the EXACT day/report path via trusted Admin GET only; never change
    // the legacy report or rewrite staff counts to force a pass.
    const jstDay=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
    }).format(new Date(start));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(jstDay))
      stop('CURRENT_DAY_UNVERIFIED');
    const existingDay=await read('companies/'+internalCompanyId+
      '/partnerWorkCountDays/'+jstDay+'/reports/'+partnerCompanyId,true);
    if(existingDay!==null&&(
       existingDay.source!=='staff-entries-v1'||
       existingDay.hubCompanyId!==internalCompanyId||
       existingDay.partnerCompanyId!==partnerCompanyId||
       existingDay.date!==jstDay))
      stop('PARTNER_CURRENT_DAY_INPUT_BLOCKED');
    // Leader/member submit has an authenticated self-staff path. A missing,
    // deactivated or moved-to-another-team staff row makes their ordinary
    // count-entry form fail even when all financial reads are denied.
    if(['leader','member'].includes(context.role)){
      const staff=await read('companies/'+partnerCompanyId+
        '/partnerWorkStaff/'+expectedPartnerUid);
      if(staff.uid!==expectedPartnerUid||
         staff.companyId!==partnerCompanyId||
         staff.kind!=='account'||staff.active!==true||
         staff.role!==context.role||
         staff.teamId!==context.teamId||
         typeof staff.name!=='string'||!STAFF_NAME.test(staff.name)||
         FINANCE_NAME.test(staff.name))
        stop('PARTNER_SELF_COUNT_ENTRY_NOT_READY');
    }
    if(context.uid!==expectedPartnerUid ||
       context.kind!=='partner_secondary'||context.active!==true||
       context.primaryCompanyId!==internalCompanyId||
       context.partnerCompanyId!==partnerCompanyId||
       context.hubCompanyId!==internalCompanyId||
       oldUser.uid!==expectedPartnerUid||
       oldUser.companyId!==internalCompanyId||oldUser.active!==true||
       oldUser.companyRole==='owner'||!internalUser(oldUser)||
       (oldMember.uid!=null&&oldMember.uid!==expectedPartnerUid)||
       (oldMember.companyId!=null&&oldMember.companyId!==internalCompanyId)||
       oldMember.companyRole==='owner'||oldMember.active===false||
       !internalUser(oldMember)||
       partnerCompany.companyKind!=='partner'||
       partnerCompany.hubCompanyId!==internalCompanyId||
       partnerCompany.active!==true||
       partnerMember.uid!==expectedPartnerUid||
       partnerMember.companyId!==partnerCompanyId||
       partnerMember.active!==true||
       partnerMember.accessKind!=='partner'||
       partnerMember.memberType!=='cooperator'||
       !matchingPartnerRole(context,partnerCompany,partnerMember,expectedPartnerUid)||
       partnerMember.canViewRevenue!==false||
       partnerMember.canViewUnitPrice!==false)
      stop('AFFECTED_SECONDARY_NOT_BOUND');
    // A company report and the live count workspace are date-scoped in JST.
    // If an audit crosses midnight, the previous day's safe summary cannot
    // certify the new day's input precondition. Abort rather than flip Rules.
    const finish=now();
    if(!Number.isFinite(finish)||finish<start||finish-start>60_000)
      stop('IDENTITY_INVENTORY_EXPIRED');
    const finishJstDay=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
    }).format(new Date(finish));
    if(finishJstDay!==jstDay)stop('CURRENT_DAY_ROLLOVER');
    // Avoid retaining the decoded private snapshot in the result.
    return Object.freeze({
      checkedAgainst:provenance,
      ownerInternalBound:true,
      affectedSecondaryBound:true,
      projectId:PROJECT,
      productionDocumentWrites:0
    });
  };
}
