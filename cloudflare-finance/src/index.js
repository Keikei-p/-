/**
 * Protected financial-view gateway (read-only foundation).
 * No production data changes: GET only. There is NO record-write endpoint.
 * All monetary access is checked against the user's current Firestore role
 * and explicit grants, never request parameters or client-side role flags.
 */
const PROJECT_ID = "sales-management-cc116";
const TOKEN_SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_KEYS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const ALLOWED_ORIGINS = new Set([
  "https://nico-factory.web.app",
  "https://keikei-p.github.io"
]);
const encoder = new TextEncoder();
let googleCache = {token: "",expires:0};
let signingKeys = {keys: [], expires: 0};

function base64url(bytes) {
  let binary = "";
  for (const item of bytes) binary += String.fromCharCode(item);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error("invalid_b64");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
function textBase64(value) {
  return JSON.parse(new TextDecoder().decode(decode64(value)));
}
function pemBytes(pem) {
  const body = String(pem || "").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  return decode64(body.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")).buffer;
}
function httpError(status, label) {
  const err = new Error(label); err.status = status; return err;
}
function safeJSON(value, status = 200, origin = "") {
  const headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(value), {status, headers});
}

async function verifiedToken(raw, fetcher = fetch, clock = Date.now()) {
  if (typeof raw !== "string" || raw.length > 12000) throw httpError(401, "invalid_token");
  const sections = raw.split(".");
  if (sections.length !== 3) throw httpError(401, "invalid_token");
  let header, payload;
  try {
    header = textBase64(sections[0]);
    payload = textBase64(sections[1]);
  } catch { throw httpError(401, "invalid_token"); }
  const now = Math.floor(clock / 1000);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid ||
    payload.aud !== PROJECT_ID ||
    payload.iss !== "https://securetoken.google.com/" + PROJECT_ID ||
    typeof payload.sub !== "string" || !/^[\w\-:.]{1,128}$/.test(payload.sub) ||
    payload.email_verified !== true || typeof payload.email !== "string" ||
    !Number.isInteger(payload.iat) || payload.iat > now + 60 ||
    !Number.isInteger(payload.exp) || payload.exp <= now ||
    !Number.isInteger(payload.auth_time) || payload.auth_time > now + 60) {
    throw httpError(401, "invalid_claims");
  }
  if (!signingKeys.keys.length || signingKeys.expires < clock) {
    const res = await fetcher(GOOGLE_KEYS_URL);
    if (!res.ok) throw httpError(503, "signing_keys_unavailable");
    const body = await res.json();
    if (!Array.isArray(body.keys)) throw httpError(503, "invalid_signing_keys");
    const cc = res.headers.get("cache-control") || "";
    const ttl = Math.max(60, Math.min(21600, Number(cc.match(/max-age=(\d+)/)?.[1] || 600)));
    signingKeys = {keys: body.keys,expires:clock+ttl*1000};
  }
  const jwk = signingKeys.keys.find(k => k.kid === header.kid && k.kty === "RSA" && k.alg === "RS256" && k.use === "sig");
  if (!jwk) throw httpError(401, "unknown_signing_key");
  let verified = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode64(sections[2]),encoder.encode(sections[0]+"."+sections[1]));
  } catch { verified = false; }
  if (!verified) throw httpError(401, "bad_token_signature");
  return {uid:payload.sub,email:payload.email};
}
async function googleBearer(env, fetcher = fetch) {
  const ms=Date.now();
  if(googleCache.token && googleCache.expires-ms>60000)return googleCache.token;
  let credentials;
  try{credentials=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON||"{}");}catch{throw httpError(503,"credentials_invalid");}
  if(!credentials.client_email || !credentials.private_key)throw httpError(503,"credentials_missing");
  const seconds=Math.floor(ms/1000);
  const unsigned=[
    base64url(encoder.encode(JSON.stringify({alg:"RS256",typ:"JWT"}))),
    base64url(encoder.encode(JSON.stringify({iss:credentials.client_email,scope:TOKEN_SCOPE,aud:TOKEN_URL,iat:seconds,exp:seconds+3600})))
  ].join(".");
  const privateKey=await crypto.subtle.importKey("pkcs8",pemBytes(credentials.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",privateKey,encoder.encode(unsigned));
  const tokenResponse=await fetcher(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:unsigned+"."+base64url(new Uint8Array(signature))})});
  if(!tokenResponse.ok)throw httpError(503,"credential_exchange_failed");
  const x=await tokenResponse.json();
  if(!x.access_token)throw httpError(503,"missing_credentials");
  googleCache={token:x.access_token,expires:ms+Number(x.expires_in||3600)*1000};
  return googleCache.token;
}
const base = "https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)";
function documentPath(value) {
  const parts=String(value).split("/");
  if(parts.some(s=>!/^[A-Za-z0-9_\-]+$/.test(s)))throw httpError(400,"invalid_document_path");
  return parts.map(encodeURIComponent).join("/");
}
function firestoreValue(v) {
  if(v===undefined || v===null)return null;
  if("stringValue" in v)return v.stringValue;
  if("integerValue" in v)return Number(v.integerValue);
  if("doubleValue" in v)return Number(v.doubleValue);
  if("booleanValue" in v)return Boolean(v.booleanValue);
  if("timestampValue" in v)return v.timestampValue;
  if("mapValue" in v)return documentFields(v.mapValue.fields||{});
  if("arrayValue" in v)return (v.arrayValue.values||[]).map(firestoreValue);
  return null;
}
function documentFields(fields) {
  return Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,firestoreValue(v)]));
}
function docData(raw) {
  return raw?{id:String(raw.name||"").split("/").pop(),...documentFields(raw.fields||{})}:null;
}
async function firestoreGet(env, path, fetcher = fetch) {
  const bearer=await googleBearer(env,fetcher);
  const result=await fetcher(base+"/documents/"+documentPath(path),{headers:{Authorization:"Bearer "+bearer}});
  if(result.status===404)return null;
  if(!result.ok)throw httpError(503,"firestore_read_unavailable");
  return docData(await result.json());
}
async function firestoreQuery(env, collectionId, companyId, fetcher = fetch) {
  const bearer=await googleBearer(env,fetcher);
  const sq={structuredQuery:{
    from:[{collectionId}],
    where:{fieldFilter:{field:{fieldPath:"companyId"},op:"EQUAL",value:{stringValue:companyId}}},
    limit:2000
  }};
  const result=await fetcher(base+"/documents:runQuery",{method:"POST",headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
    body:JSON.stringify(sq)});
  if(!result.ok)throw httpError(503,"firestore_query_unavailable");
  const rows=await result.json();
  if(!Array.isArray(rows))throw httpError(503,"firestore_query_invalid");
  const all=rows.filter(row=>row.document).map(row=>docData(row.document));
  if(all.length>=2000)throw httpError(503,"records_exceed_safety_limit");
  return all;
}
function active(obj) { return obj && obj.active !== false; }
function approvedPolicy(user,member,company,uid,today="") {
  if(!user || !member || !company || !active(user) || !active(member) || !active(company) ||
      !user.companyId || member.uid!==uid ||
      user.uid!==uid || member.companyRole!==user.companyRole ||
      user.companyId!==member.companyId)throw httpError(403,"membership_denied");
  const isMaster=(company.masterUid||company.ownerUid)===uid;
  const isOwner=isMaster || (user.companyRole==="owner" && member.companyRole==="owner");
  const revenue= isOwner || (user.canViewRevenue===true && member.canViewRevenue===true);
  const unit= isOwner || (revenue && user.canViewUnitPrice===true && member.canViewUnitPrice===true);
  const teamId = member.teamId ?? user.teamId ?? null;
  const history=Array.isArray(member.teamHistory)?member.teamHistory:[];
  const start=history.filter(x=>x&&x.toTeamId===teamId&&typeof x.effectiveDate==="string"&&x.effectiveDate<=(today||"9999-99-99")).map(x=>x.effectiveDate).sort().at(-1)??(today||"9999-99-99");
  return {companyId:user.companyId,uid,isOwner,canViewRevenue:revenue,canViewUnitPrice:unit,teamId,revenueScopeStart:start,role:member.role};
}
function visibleMoney(policy,record) {
  return policy.canViewRevenue && (policy.isOwner ||
    (record.teamId && policy.teamId && record.teamId===policy.teamId &&
     typeof record.date==="string" && record.date>=policy.revenueScopeStart));
}
function withoutAmounts(str) {
  // Old product names can contain cashback amounts (e.g. "HTB CB5000").
  return String(str||"").replace(/(?:\s*[-–(（]?\s*)(?:CB|キャッシュバック)[\s:：-]*[￥¥]?\s*[\d,.]+(?:万|千)?(?:円)?[)）]?/gi,"").trim();
}
function safeProducts(all,policy) {
  return all.map(p=>{
    const safe={
      id:p.id, companyId:policy.companyId, name:withoutAmounts(p.name),
      sortOrder:p.sortOrder??0, active:p.active!==false
    };
    if(policy.canViewUnitPrice){
      safe.revenue=p.revenue;
      safe.pricingOptions=p.pricingOptions;
      safe.cashbackOptions=p.cashbackOptions;
      safe.name=p.name;
    } else {
      const variants=Array.isArray(p.pricingOptions)?p.pricingOptions:[];
      safe.planIds=variants.map((_v,i)=>"plan_"+i);
    }
    return safe;
  });
}
function safeRecords(all,policy) {
  return all.map(record=>{
    const out={
      id:record.id,companyId:record.companyId,uid:record.uid,
      memberNameSnapshot:record.memberNameSnapshot,
      teamId:record.teamId,teamNameSnapshot:record.teamNameSnapshot,
      date:record.date,workLocation:record.workLocation,
      totalCount:record.totalCount,reportStatus:record.reportStatus,
      reportedAt:record.reportedAt,createdByUid:record.createdByUid,
      updatedByUid:record.updatedByUid,createdAt:record.createdAt,
      updatedAt:record.updatedAt
    };
    const permittedRevenue=visibleMoney(policy,record);
    if(permittedRevenue)out.totalRevenue=record.totalRevenue;
    const input=record.results && typeof record.results==="object"?record.results:{};
    out.results=Object.fromEntries(Object.entries(input).map(([k,v])=>{
      const result=v && typeof v==="object"?v:{};
      const safe={productId:result.productId,productName:withoutAmounts(result.productName),
        count:result.count};
      if(policy.canViewUnitPrice && permittedRevenue){
        safe.revenuePerUnit=result.revenuePerUnit;
        safe.cashback=result.cashback;
        safe.productName=result.productName;
      }
      return [k,safe];
    }));
    // Map keys can themselves contain monetary CB suffixes (old record keys).
    // Do NOT emit keys from the original result map in the non-price view.
    if(!policy.canViewUnitPrice){
      out.results=Object.fromEntries(Object.values(out.results).map((value,i)=>["item_"+i,value]));
    }
    return out;
  });
}
function safeGoals(all,policy) {
  return all.filter(goal=>visibleMoney(policy,{teamId:goal.teamId,date:goal.month+"-31"}))
    .map(goal=>({id:goal.id,companyId:goal.companyId,teamId:goal.teamId,month:goal.month,targetRevenue:goal.targetRevenue}));
}

async function memberPolicy(env,principal,fetcher=fetch,now=new Date()) {
  const user=await firestoreGet(env,"users/"+principal.uid,fetcher);
  const companyId=user?.companyId;
  if(!companyId || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId))throw httpError(403,"membership_denied");
  const [member,company]=await Promise.all([
    firestoreGet(env,"companies/"+companyId+"/members/"+principal.uid,fetcher),
    firestoreGet(env,"companies/"+companyId,fetcher)
  ]);
  const tokyo=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  return approvedPolicy(user,member,company,principal.uid,tokyo);
}
async function financeView(env,principal,fetcher=fetch){
  const policy=await memberPolicy(env,principal,fetcher);
  const [products,records,revenueGoals]=await Promise.all([
    firestoreQuery(env,"products",policy.companyId,fetcher),
    firestoreQuery(env,"records",policy.companyId,fetcher),
    policy.canViewRevenue?firestoreQuery(env,"revenueGoals",policy.companyId,fetcher):Promise.resolve([])
  ]);
  const payload={policy:{
    canViewRevenue:policy.canViewRevenue,canViewUnitPrice:policy.canViewUnitPrice,isOwner:policy.isOwner,
    teamId:policy.teamId
  },products:safeProducts(products,policy),records:safeRecords(records,policy),revenueGoals:safeGoals(revenueGoals,policy)};
  return payload;
}
export default {
  async fetch(request,env){
    const origin=request.headers.get("origin")||"";
    const url=new URL(request.url);
    if(origin && !ALLOWED_ORIGINS.has(origin))return safeJSON({error:"origin_denied"},403);
    if(request.method==="OPTIONS"){
      if(!ALLOWED_ORIGINS.has(origin))return safeJSON({error:"origin_denied"},403);
      return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, OPTIONS",
        "Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Max-Age":"600","Vary":"Origin"}});
    }
    if(url.pathname==="/health"&&request.method==="GET"){
      return safeJSON({ok:true,service:"finance-gateway",enabled:env.FINANCE_GATEWAY_ENABLED==="enabled",mode:"read_only"},200,origin);
    }
    if(url.pathname!=="/v1/financial-view"||request.method!=="GET")return safeJSON({error:"not_found"},404,origin);
    if(env.FINANCE_GATEWAY_ENABLED!=="enabled")return safeJSON({error:"cutover_not_authorized"},503,origin);
    if(env.FIREBASE_PROJECT_ID!==PROJECT_ID)return safeJSON({error:"project_mismatch"},503,origin);
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return safeJSON({error:"authorization_required"},401,origin);
    try{
      const principal=await verifiedToken(auth.slice(7));
      const answer=await financeView(env,principal);
      return safeJSON(answer,200,origin);
    }catch(error){
      if(error.status!==401&&error.status!==403)console.error("finance_gateway_failed",error.message);
      return safeJSON({error:error.status===401?"unauthorized":error.status===403?"forbidden":"unavailable"},error.status||503,origin);
    }
  }
};
export {approvedPolicy,safeProducts,safeRecords,safeGoals,visibleMoney,withoutAmounts,verifiedToken,financeView};
