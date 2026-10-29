/**
 * DRAFT ONLY: verify Firebase Auth ID tokens on a trusted Worker/server.
 * No Firestore, LINE, production config, deployment, or secret keys.
 *
 * Uses Google's *Firebase Secure Token* public JWK endpoint (NOT Google Sign-In
 * account-token keys). Never trust decoded JWT claims before RS256 verification.
 * Source: https://firebase.google.com/docs/auth/admin/verify-id-tokens
 *
 * A valid token does NOT prove active membership, revocation state, company
 * access or team privileges. Call loadMembership() on the server for every
 * request; reject disabled/revoked accounts after authoritative verification.
 */
const CERTS="https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const DEFAULT_PROJECT="sales-management-cc116";
const SEGMENT=/^[A-Za-z0-9_-]+$/;
const reject=()=>{throw Error("Firebase ID token verification refused");};
function decode(part){
 if(typeof part!=="string"||!SEGMENT.test(part)||part.length>14000)reject();
 try {
  const padded=part.replace(/-/g,"+").replace(/_/g,"/")+
    "=".repeat((4-part.length%4)%4);
  const bytes=Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 }catch{reject();}
}
function signatureBytes(part){
 if(typeof part!=="string"||!SEGMENT.test(part)||part.length>12000)reject();
 try{
  const padded=part.replace(/-/g,"+").replace(/_/g,"/")+
    "=".repeat((4-part.length%4)%4);
  return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
 }catch{reject();}
}
const integer=x=>Number.isSafeInteger(x)&&x>=0;
function validateClaims(c,projectId,now){
 if(!c||typeof c!=="object"||Array.isArray(c)||
    c.aud!==projectId||c.iss!=="https://securetoken.google.com/"+projectId||
    typeof c.sub!=="string"||c.sub.length<1||c.sub.length>128||
    /[\x00-\x1F\x7F]/.test(c.sub)||
    !integer(c.iat)||!integer(c.exp)||!integer(c.auth_time)||
    c.iat>now||c.auth_time>now||c.exp<=now||c.exp<=c.iat||
    c.exp-c.iat>3600||c.email_verified!==true||
    (c.nbf!=null&&(!integer(c.nbf)||c.nbf>now)))
  reject();
 return {uid:c.sub,emailVerified:true,authTime:c.auth_time};
}
export function createFirebaseIdTokenVerifier({
 projectId=DEFAULT_PROJECT,
 fetchKeys=fetch,
 subtle=globalThis.crypto?.subtle,
 nowSeconds=()=>Math.floor(Date.now()/1000)
}={}){
 if(projectId!==DEFAULT_PROJECT||typeof fetchKeys!=="function"||
    !subtle||typeof subtle.importKey!=="function"||
    typeof subtle.verify!=="function"||typeof nowSeconds!=="function")reject();
 let cache=null;
 async function loadKeys(now){
  if(cache&&cache.until>now)return cache.keys;
  const resp=await fetchKeys(CERTS,{method:"GET",redirect:"error",headers:{Accept:"application/json"}});
  if(!resp?.ok)reject();
  const body=await resp.json();
  if(!body||!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>20)reject();
  const keys=new Map();
  for(const jwk of body.keys){
   if(!jwk||jwk.kty!=="RSA"||jwk.alg!=="RS256"||
      jwk.use!=="sig"||typeof jwk.kid!=="string"||!jwk.kid||
      typeof jwk.n!=="string"||typeof jwk.e!=="string"||
      !SEGMENT.test(jwk.n)||!SEGMENT.test(jwk.e)||
      keys.has(jwk.kid))reject();
   keys.set(jwk.kid,{kty:"RSA",n:jwk.n,e:jwk.e,alg:"RS256",ext:true,key_ops:["verify"]});
  }
  const cc=resp.headers?.get?.("Cache-Control")||"";
  const seconds=Number(cc.match(/(?:^|[, ])max-age=(\d+)/i)?.[1]??0);
  // Limit caching to 1h even if Google provides a longer duration.
  const ttl=Number.isSafeInteger(seconds)&&seconds>0?Math.min(seconds,3600):0;
  cache={keys,until:now+ttl};
  return keys;
 }
 return async function authenticateBearer(token){
  if(typeof token!=="string"||token.length<50||token.length>12000)reject();
  const parts=token.split(".");
  if(parts.length!==3)reject();
  const [h,p,s]=parts;
  const header=decode(h),claims=decode(p);
  if(!header||header.alg!=="RS256"||typeof header.kid!=="string"||
     !header.kid||header.crit!=null)reject();
  const now=nowSeconds();
  if(!integer(now))reject();
  validateClaims(claims,projectId,now);
  const keys=await loadKeys(now);
  // Unknown 'kid' is not trusted, including after certificate rotation.
  const jwk=keys.get(header.kid);
  if(!jwk)reject();
  let verified=false;
  try{
   const key=await subtle.importKey("jwk",jwk,
     {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
   verified=await subtle.verify("RSASSA-PKCS1-v1_5",key,signatureBytes(s),
     new TextEncoder().encode(h+"."+p));
  }catch{reject();}
  if(!verified)reject();
  return validateClaims(claims,projectId,now);
 };
}
