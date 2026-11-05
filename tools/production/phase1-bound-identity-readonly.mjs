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
  if(document?.name!==url || !document.fields ||
     typeof document.fields!=='object'||Array.isArray(document.fields))
    stop('UNRECOGNIZED_DOCUMENT');
  const result=Object.create(null);
  for(const [key,field] of Object.entries(document.fields))
    result[key]=value(field);
  return result;
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
    if(ownerContext!==null || owner.companyId!==internalCompanyId ||
       owner.companyRole!=='owner' || owner.active===false ||
       !internalUser(owner) || !internal(company) || company.active===false ||
       ownerMember.companyRole!=='owner' || ownerMember.active===false ||
       !internalUser(ownerMember) ||
       !(company.ownerUid===expectedOwnerUid||
         company.masterUid===expectedOwnerUid))
      stop('OWNER_NOT_INDEPENDENTLY_BOUND');

    const context=await read('partnerWorkspaceContexts/'+expectedPartnerUid);
    const oldUser=await read('users/'+expectedPartnerUid);
    const oldMember=await read('companies/'+internalCompanyId+
      '/members/'+expectedPartnerUid);
    const partnerCompany=await read('companies/'+partnerCompanyId);
    const partnerMember=await read('companies/'+partnerCompanyId+
      '/members/'+expectedPartnerUid);
    if(context.uid!==expectedPartnerUid ||
       context.kind!=='partner_secondary'||context.active!==true||
       context.primaryCompanyId!==internalCompanyId||
       context.partnerCompanyId!==partnerCompanyId||
       context.hubCompanyId!==internalCompanyId||
       oldUser.companyId!==internalCompanyId||oldUser.active===false||
       oldUser.companyRole==='owner'||!internalUser(oldUser)||
       oldMember.companyRole==='owner'||oldMember.active===false||
       !internalUser(oldMember)||
       partnerCompany.companyKind!=='partner'||
       partnerCompany.hubCompanyId!==internalCompanyId||
       partnerCompany.active===false||
       partnerMember.uid!==expectedPartnerUid||
       partnerMember.companyId!==partnerCompanyId||
       partnerMember.active===false||
       partnerMember.accessKind!=='partner'||
       partnerMember.memberType!=='cooperator'||
       partnerMember.companyRole!=='member'||
       partnerMember.canViewRevenue!==false||
       partnerMember.canViewUnitPrice!==false)
      stop('AFFECTED_SECONDARY_NOT_BOUND');
    if(now()<start || now()-start>60_000)stop('IDENTITY_INVENTORY_EXPIRED');
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
