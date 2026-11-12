/**
 * Phase-1 LIVE user-role probe (library only; NO CLI, NO DEPLOY).
 *
 * Requires two distinct, freshly authenticated Firebase user ID tokens from
 * real user sessions and two known, existing internal finance document IDs.
 * Service account / IAM OAuth tokens are NOT accepted: they bypass Rules.
 *
 * This module makes only document GET and the read-only Firestore :runQuery.
 * It never writes, logs, returns, or persists ID tokens, IDs or financial data.
 * A test-injected transport can only yield "synthetic-only", never a live proof.
 *
 * Use only AFTER separately reviewing the exact live Rules fingerprint. The
 * phase1Boundary engine verifies that source and rolls back on role failure.
 */
const PROJECT='sales-management-cc116';
const API='https://firestore.googleapis.com/v1/';
const RESOURCE_ROOT='projects/'+PROJECT+'/databases/(default)/documents';
const ROOT=API+RESOURCE_ROOT;
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const stop=code=>{throw Error('STOP_LIVE_ROLE_'+code);};

function identity(token, expectedUid, nowSeconds, minimumRemainingSeconds=60){
  if(typeof token!=='string'||token.length<100||token.length>8192||
     token.split('.').length!==3)stop('FIREBASE_USER_TOKEN_REQUIRED');
  let claims;
  try { claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8')); }
  catch { stop('TOKEN_CLAIMS'); }
  // This local parse is a preflight only. Google's Firestore endpoint performs
  // the actual cryptographic user-token verification against Security Rules.
  if(!ID.test(expectedUid||'')||claims.sub!==expectedUid||
     claims.aud!==PROJECT||
     claims.iss!=='https://securetoken.google.com/'+PROJECT||
     claims.email_verified!==true||
     typeof claims.email!=='string'||claims.email.trim().length===0||
     !claims.firebase||typeof claims.firebase.sign_in_provider!=='string'||
     !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||
     claims.iat>nowSeconds+60||claims.exp<=nowSeconds+minimumRemainingSeconds||
     claims.exp-claims.iat>3700||
     !Number.isSafeInteger(claims.auth_time)||
     claims.auth_time>nowSeconds+60)stop('USER_IDENTITY_NOT_VERIFIED');
  return claims.sub;
}

function financeQuery(collection,companyId){
  return {structuredQuery:{
    from:[{collectionId:collection}],
    where:{fieldFilter:{
      field:{fieldPath:'companyId'},op:'EQUAL',
      value:{stringValue:companyId}
    }},
    select:{fields:[{fieldPath:'companyId'}]},
    limit:1
  }};
}
async function requireResponse(fetcher,url,method,token,body,expectedStatus,field,companyId){
  let response;
  try {
    response=await fetcher(url,{
      method,redirect:'error',
      headers:{
        Authorization:'Bearer '+token,
        ...(body?{'Content-Type':'application/json'}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{})
    });
  } catch {
    // Do not propagate transport exception messages; they can contain URLs,
    // user tokens, email addresses or raw provider response bodies.
    stop('NETWORK_UNVERIFIED');
  }
  if(response?.status!==expectedStatus)stop('HTTP_STATUS_UNVERIFIED');
  if(expectedStatus===403){
    // A generic HTTP 403 (proxy, API quota, invalid identity, etc.) must
    // never be treated as proof that Firestore Security Rules blocked the
    // specific partner. Require Google's structured permission-denied error.
    let denial;
    try { denial=await response.json(); }
    catch { stop('PERMISSION_DENIAL_UNVERIFIED'); }
    if(denial?.error?.status!=='PERMISSION_DENIED'||
       denial?.error?.code!==403)
      stop('PERMISSION_DENIAL_UNVERIFIED');
    return;
  }
  let parsed;
  try { parsed=await response.json(); }
  catch { stop('RESPONSE_NOT_JSON'); }
  if(field){
    // Firestore Document.name is a RESOURCE name without the HTTPS hostname.
    // Equality, not prefix match, ensures this is the EXACT requested original.
    if(!parsed||typeof parsed!=='object'||
       parsed.name!==url.slice(API.length)||
       !parsed.fields||typeof parsed.fields!=='object'||
       parsed.fields.companyId?.stringValue!==companyId||
       !parsed.fields[field]||
       !('integerValue' in parsed.fields[field] ||
         'doubleValue' in parsed.fields[field]))stop('OWNER_FINANCE_NOT_VERIFIED');
  }else{
    // An HTTP 200 with an empty / unrelated query is not proof that Owner's
    // existing internal records can actually be listed. Require one selected
    // companyId-bearing document with the matching resource collection.
    const collection=body?.structuredQuery?.from?.[0]?.collectionId;
    const prefix=RESOURCE_ROOT+'/'+collection+'/';
    if(!['products','records'].includes(collection)||!Array.isArray(parsed))
      stop('OWNER_LIST_NOT_VERIFIED');
    const found=parsed.filter(entry=>entry&&typeof entry==='object'&&entry.document);
    if(found.length!==1||
       found[0]?.document?.fields?.companyId?.stringValue!==companyId||
       typeof found[0]?.document?.name!=='string'||
       !found[0].document.name.startsWith(prefix)||
       !/^[^/]+$/.test(found[0].document.name.slice(prefix.length)))
      stop('OWNER_LIST_NOT_VERIFIED');
  }
  // Deliberately discard the entire raw data response.
}

export function createLiveFirestoreRoleVerifier({
  ownerIdToken,partnerIdToken,expectedOwnerUid,expectedPartnerUid,
  internalCompanyId,productId,recordId,fetchImpl,now=()=>Date.now()
}={}){
  const transport=fetchImpl===undefined?globalThis.fetch:fetchImpl;
  if(typeof transport!=='function'||typeof now!=='function')stop('TRANSPORT');
  if(!ID.test(internalCompanyId||'')||
     !ID.test(productId||'')||!ID.test(recordId||''))stop('DOCUMENT_IDS');
  const nowSeconds=Math.floor(now()/1000);
  const ownerUid=identity(ownerIdToken,expectedOwnerUid,nowSeconds);
  const partnerUid=identity(partnerIdToken,expectedPartnerUid,nowSeconds);
  if(ownerUid===partnerUid||ownerIdToken===partnerIdToken)stop('DISTINCT_USERS_REQUIRED');
  const tests=[
    ['products',productId,'revenue'],
    ['records',recordId,'totalRevenue']
  ];
  // A transport injected for tests can never claim to verify live production,
  // even if its fake responses match the expected statuses.
  const provenance=fetchImpl===undefined?'production-live':'synthetic-only';
  let attempted=false;
  return async function verifyLiveRoles({expectedRulesSha256,releaseName}={}){
    if(attempted)stop('SINGLE_USE_VERIFIER');
    attempted=true;
    if(!/^[a-f0-9]{64}$/.test(expectedRulesSha256||'')||
       releaseName!==RELEASE)stop('RULES_RELEASE_NOT_PINNED');
    // A long pre-switch inventory/restore may outlive a token that was fresh
    // when this verifier was constructed. Recheck BOTH real sessions just
    // before the post-switch reads: never mistake an expired partner token's
    // failure for permission denial by the new Security Rules.
    const liveNow=Math.floor(now()/1000);
    identity(ownerIdToken,expectedOwnerUid,liveNow);
    identity(partnerIdToken,expectedPartnerUid,liveNow);
    // First prove these documents exist and that the *independent* Owner can
    // actually read their financial fields. Otherwise partner 403 is vacuous.
    for(const [collection,id,field] of tests){
      await requireResponse(transport,ROOT+'/'+collection+'/'+id,
        'GET',ownerIdToken,null,200,field,internalCompanyId);
      // Prove that the SAME constrained list query is permitted for Owner.
      await requireResponse(transport,ROOT+':runQuery',
        'POST',ownerIdToken,financeQuery(collection,internalCompanyId),200,null,internalCompanyId);
    }
    // Owner's four reads can take time. If either token is close to expiry
    // NOW, an ensuing 403 could be an auth/session error rather than a
    // meaningful denial by the reviewed Rules. Stop and trigger rollback.
    identity(ownerIdToken,expectedOwnerUid,Math.floor(now()/1000));
    identity(partnerIdToken,expectedPartnerUid,Math.floor(now()/1000));
    // Then require explicit 403, not 401/404/429/5xx or network failure.
    for(const [collection,id] of tests){
      await requireResponse(transport,ROOT+'/'+collection+'/'+id,
        'GET',partnerIdToken,null,403,null);
      await requireResponse(transport,ROOT+':runQuery',
        'POST',partnerIdToken,financeQuery(collection,internalCompanyId),403,null);
    }
    // Even if all eight REST responses looked correct, a session that has
    // become stale DURING verification is not evidence of a sustainable
    // production release. Do not return success on an expiring account.
    identity(ownerIdToken,expectedOwnerUid,Math.floor(now()/1000));
    identity(partnerIdToken,expectedPartnerUid,Math.floor(now()/1000));
    // Only booleans and a checked source label leave this module.
    return Object.freeze({
      checkedAgainst:provenance,
      partnerDocumentDenied:true,
      partnerListDenied:true,
      ownerFinanceAllowed:true
    });
  };
}


/**
 * Verify the still-active Owner's real Firestore finance access BEFORE a
 * candidate Rules release. This deliberately never asks the partner to be
 * denied under legacy Rules: that would deadlock the security fix.
 *
 * Only a native fetch (no test transport injection) labels real production;
 * the release bridge refuses synthetic-only proof. No live data leaves here.
 */
export function createLiveFirestoreOwnerPreflight({
  ownerIdToken,expectedOwnerUid,internalCompanyId,productId,recordId,
  fetchImpl,now=()=>Date.now()
}={}){
  const transport=fetchImpl===undefined?globalThis.fetch:fetchImpl;
  if(typeof transport!=='function'||typeof now!=='function')
    stop('TRANSPORT');
  if(!ID.test(internalCompanyId||'')||
     !ID.test(productId||'')||!ID.test(recordId||''))
    stop('DOCUMENT_IDS');
  const preflightUid=identity(ownerIdToken,expectedOwnerUid,Math.floor(now()/1000));
  if(!preflightUid)stop('OWNER_IDENTITY');
  let used=false;
  return async function verifyRealOwnerBeforeSwitch(){
    if(used)stop('SINGLE_USE_OWNER_PREFLIGHT');
    used=true;
    // Token age is checked AGAIN at the moment of the live requests.
    identity(ownerIdToken,expectedOwnerUid,Math.floor(now()/1000));
    for(const [collection,id,field] of [
      ['products',productId,'revenue'],
      ['records',recordId,'totalRevenue']
    ]){
      await requireResponse(transport,ROOT+'/'+collection+'/'+id,
        'GET',ownerIdToken,null,200,field,internalCompanyId);
      await requireResponse(transport,ROOT+':runQuery',
        'POST',ownerIdToken,financeQuery(collection,internalCompanyId),200,null,internalCompanyId);
    }
    // A four-request Owner proof can outlive a token that was valid on its
    // first GET. Fail closed rather than claiming continuing finance access
    // from stale authentication. No additional Firestore writes or reads.
    identity(ownerIdToken,expectedOwnerUid,Math.floor(now()/1000));
    return Object.freeze({
      checkedAgainst:fetchImpl===undefined?'production-live':'synthetic-only',
      ownerFinanceAllowed:true
    });
  };
}


/**
 * Local freshness-only gate for the final pre-PATCH window.
 *
 * JWT payloads are NOT proof of authentication; real Owner GET/List below
 * supplies cryptographic user-token validation by Firestore. This gate only
 * prevents an already/still-nearly-expired partner token from making a
 * production switch that would immediately require rollback.
 */
export function createLiveFirestoreSessionPreflight({
  ownerIdToken,partnerIdToken,expectedOwnerUid,expectedPartnerUid,
  now=()=>Date.now(),minimumRemainingSeconds=600
}={}){
  if(typeof now!=='function'||
     !Number.isSafeInteger(minimumRemainingSeconds)||
     minimumRemainingSeconds<120||minimumRemainingSeconds>1200)
    stop('INVALID_FRESHNESS_WINDOW');
  let used=false;
  return function verifySessionsImmediatelyBeforeSwitch(){
    if(used)stop('SINGLE_USE_SESSION_PREFLIGHT');
    used=true;
    const nowSeconds=Math.floor(now()/1000);
    const owner=identity(ownerIdToken,expectedOwnerUid,nowSeconds,minimumRemainingSeconds);
    const partner=identity(partnerIdToken,expectedPartnerUid,nowSeconds,minimumRemainingSeconds);
    if(owner===partner||ownerIdToken===partnerIdToken)
      stop('DISTINCT_USERS_REQUIRED');
    return Object.freeze({
      checkedAgainst:'local-claims-only',
      ownerSessionFresh:true,
      partnerSessionFresh:true,
      userTokenCryptographyVerified:false
    });
  };
}


/**
 * Read-only continuity proof for the affected partner's EXISTING count-entry
 * workspace, using their real Firebase USER ID token. A finance 403 is not
 * sufficient evidence that they can still enter counts.
 *
 * Calls ONLY getPartnerWorkspace with an exact input date and company ID.
 * It NEVER invokes submitPartnerWorkspaceCounts or other write APIs.
 * The response is discarded; only safe booleans leave this function.
 * Injected HTTP transports are synthetic-only and cannot certify production.
 */
export function createLivePartnerCountViewVerifier({
 partnerIdToken,expectedPartnerUid,partnerCompanyId,
 fetchImpl,now=()=>Date.now()
}={}){
 const transport=fetchImpl===undefined?globalThis.fetch:fetchImpl;
 if(typeof transport!=='function'||typeof now!=='function'||
    !ID.test(partnerCompanyId||''))stop('COUNT_VIEW_DEPENDENCIES');
 identity(partnerIdToken,expectedPartnerUid,Math.floor(now()/1000));
 const endpoint='https://asia-northeast1-'+PROJECT+
  '.cloudfunctions.net/getPartnerWorkspace';
 const provenance=fetchImpl===undefined?'production-live':'synthetic-only';
 let attempted=false;
 return async function verifyPartnerCountView(){
  if(attempted)stop('SINGLE_USE_COUNT_VIEW');
  attempted=true;
  identity(partnerIdToken,expectedPartnerUid,Math.floor(now()/1000));
  const date=new Intl.DateTimeFormat('en-CA',{
   timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date(now()));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))stop('COUNT_VIEW_DATE');
  let response;
  try{
   response=await transport(endpoint,{
    method:'POST',redirect:'error',
    headers:{Authorization:'Bearer '+partnerIdToken,
     'Content-Type':'application/json'},
    body:JSON.stringify({data:{date,workspaceCompanyId:partnerCompanyId}})
   });
  }catch{stop('COUNT_VIEW_TRANSPORT_UNVERIFIED');}
  if(response?.status!==200)stop('COUNT_VIEW_UNAVAILABLE');
  let payload;
  try{payload=await response.json();}
  catch{stop('COUNT_VIEW_RESPONSE_UNVERIFIED');}
  // Callable v2 successful responses are wrapped in the "result" field.
  // Do not mistake a generic HTTP 200 or error body for working count entry.
  const view=payload?.result;
  if(!view||typeof view!=='object'||Array.isArray(view)||
     !['owner','leader','member'].includes(view.role)||
     view.date!==date||!Array.isArray(view.categories)||
     !Array.isArray(view.teams)||!Array.isArray(view.staff)||
     !Array.isArray(view.records)||view.categories.length!==9||
     view.categories.some(key=>typeof key!=='string')||
     view.staff.length>150||view.records.length>200)
    stop('COUNT_VIEW_CONTRACT_UNVERIFIED');
  // Opening the screen is NOT proof of a usable count-entry route.
  // A visible staff member attached only to a retired/missing team can
  // submit a raw row, but its counts will be absent from ACTIVE team detail.
  // A release preflight must protect both count entry and team attribution.
  // This gate is stricter than the legacy submit endpoint; it never changes
  // existing data or retroactively reassigns staff/history.
  const activeTeamIds=new Set(view.teams.filter(team=>
    ID.test(team?.id||'')&&team.active===true).map(team=>team.id));
  if(activeTeamIds.size===0)
    stop('COUNT_VIEW_NO_ACTIVE_INPUT_ROUTE');
  const activeStaff=view.staff.filter(staff=>
    ID.test(staff?.id||'')&&staff.active===true&&
    ['account','managed'].includes(staff.kind));
  if(view.role==='member'){
    if(!activeStaff.some(staff=>staff.kind==='account'&&
      staff.uid===expectedPartnerUid&&activeTeamIds.has(staff.teamId)))
      stop('COUNT_VIEW_OWN_INPUT_UNAVAILABLE');
  }else if(!activeStaff.some(staff=>
    ID.test(staff.teamId||'')&&activeTeamIds.has(staff.teamId))){
    // Staff may exist, but nobody can be attributed to an active team.
    // Do not certify count continuity merely because a form opens.
    stop('COUNT_VIEW_NO_ACTIVE_INPUT_ROUTE');
  }
  // This endpoint must remain COUNT-ONLY, not just HTTP 200. Reject even a
  // nested financial field if an incompatible server release is encountered.
  const stack=[view];let checked=0;
  while(stack.length){
    const item=stack.pop();
    if(!item||typeof item!=='object')continue;
    if(++checked>4000)stop('COUNT_VIEW_CONTRACT_UNVERIFIED');
    for(const [key,value] of Object.entries(item)){
      if(/revenue|unit.?price|sales.?amount|commission|profit|cash.?back|cb.?amount|settlement|(^|_)price|fee.?amount|売上|単価|報酬|利益|還元金|キャッシュバック/i.test(key))
        stop('COUNT_VIEW_FINANCE_FIELD_EXPOSED');
      if(value&&typeof value==='object')stack.push(value);
    }
  }
  // A count form opened just before JST midnight cannot certify the
  // following day's ability to save. Fail closed and recheck the new date.
  const finishedAt=now();
  if(!Number.isFinite(finishedAt))stop('COUNT_VIEW_DATE_ROLLOVER');
  const finishedDay=new Intl.DateTimeFormat('en-CA',{
   timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date(finishedAt));
  if(finishedDay!==date)stop('COUNT_VIEW_DATE_ROLLOVER');
  // The read-only session must remain live at the end of this request too.
  identity(partnerIdToken,expectedPartnerUid,Math.floor(finishedAt/1000));
  return Object.freeze({
   checkedAgainst:provenance,partnerCountViewAllowed:true,
   productionDocumentWrites:0
  });
 };
}
