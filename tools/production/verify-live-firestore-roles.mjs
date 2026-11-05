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
const ROOT='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents';
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const stop=code=>{throw Error('STOP_LIVE_ROLE_'+code);};

function identity(token, expectedUid, nowSeconds){
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
     !claims.firebase||typeof claims.firebase.sign_in_provider!=='string'||
     !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||
     claims.iat>nowSeconds+60||claims.exp<=nowSeconds+60||
     claims.exp-claims.iat>3700||
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
async function requireResponse(fetcher,url,method,token,body,expectedStatus,field){
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
  if(expectedStatus!==200)return;
  let parsed;
  try { parsed=await response.json(); }
  catch { stop('RESPONSE_NOT_JSON'); }
  if(field){
    if(!parsed||typeof parsed!=='object'||!parsed.name?.startsWith(ROOT+'/')||
       !parsed.fields||typeof parsed.fields!=='object'||
       !parsed.fields[field]||
       !('integerValue' in parsed.fields[field] ||
         'doubleValue' in parsed.fields[field]))stop('OWNER_FINANCE_NOT_VERIFIED');
  }else if(!Array.isArray(parsed)){
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
    // First prove these documents exist and that the *independent* Owner can
    // actually read their financial fields. Otherwise partner 403 is vacuous.
    for(const [collection,id,field] of tests){
      await requireResponse(transport,ROOT+'/'+collection+'/'+id,
        'GET',ownerIdToken,null,200,field);
      // Prove that the SAME constrained list query is permitted for Owner.
      await requireResponse(transport,ROOT+':runQuery',
        'POST',ownerIdToken,financeQuery(collection,internalCompanyId),200,null);
    }
    // Then require explicit 403, not 401/404/429/5xx or network failure.
    for(const [collection,id] of tests){
      await requireResponse(transport,ROOT+'/'+collection+'/'+id,
        'GET',partnerIdToken,null,403,null);
      await requireResponse(transport,ROOT+':runQuery',
        'POST',partnerIdToken,financeQuery(collection,internalCompanyId),403,null);
    }
    // Only booleans and a checked source label leave this module.
    return Object.freeze({
      checkedAgainst:provenance,
      partnerDocumentDenied:true,
      partnerListDenied:true,
      ownerFinanceAllowed:true
    });
  };
}
