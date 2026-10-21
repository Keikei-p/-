/**
 * Protected financial-view gateway (read-only foundation).
 * No production data changes: GET only. There is NO record-write endpoint.
 * All monetary access is checked against the user's current Firestore role
 * and explicit grants, never request parameters or client-side role flags.
 */
const PROJECT_ID = "sales-management-cc116";
const TOKEN_SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
import {securePricing} from "./write-plan.js";
import {submitCounts, SaveConflict, PermissionDenied} from "./count-service.js";
import {makeFirestoreRestStore} from "./firestore-writer.js";
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
      (user.uid && user.uid!==uid) || member.companyRole!==user.companyRole ||
      (member.companyId && user.companyId!==member.companyId))throw httpError(403,"membership_denied");
  const isMaster=(company.masterUid||company.ownerUid)===uid;
  const isOwner=isMaster || (user.companyRole==="owner" && member.companyRole==="owner");
  const revenue= isOwner || (user.canViewRevenue===true && member.canViewRevenue===true);
  const unit= isOwner || (revenue && user.canViewUnitPrice===true && member.canViewUnitPrice===true);
  // Browser uses companies/{id}/members as the source for Leaders, while
  // ordinary members read their users/{uid} document. Keep those semantics
  // during the cutover, without trusting roles or dates sent by the client.
  const isLeader=member.role==="leader" && member.companyRole!=="owner";
  const assignment=isLeader?member:user;
  const teamId=assignment.teamId || null;
  const history=(Array.isArray(assignment.teamHistory)?assignment.teamHistory:[])
    .filter(x=>x && typeof x.effectiveDate==="string" && /^\d{4}-\d{2}-\d{2}$/.test(x.effectiveDate))
    .slice().sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
  const lastArrival=history.filter(x=>x.toTeamId===teamId && x.effectiveDate<=today).at(-1);
  const start=lastArrival?.effectiveDate ?? today;
  return {companyId:user.companyId,uid,isOwner,canViewRevenue:revenue,canViewUnitPrice:unit,
    teamId,revenueScopeStart:start,role:assignment.role,teamHistory:history,isLeader};
}
// This reproduces the existing browser's canCurrentUserViewRevenueForRecord:
// - Leader: any date from the CURRENT team only
// - Explicitly granted ordinary member: the team assigned ON the record date
// The chart's stricter scope-start calculation must not replace record access.
function visibleMoney(policy,record) {
  if(!policy.canViewRevenue)return false;
  if(policy.isOwner)return true;
  if(!record || !record.teamId || typeof record.date!=="string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.date))return false;
  if(policy.isLeader)return Boolean(policy.teamId && record.teamId===policy.teamId);
  const history=policy.teamHistory||[];
  let assigned=policy.teamId;
  if(history.length){
    assigned=history[0].fromTeamId??null;
    for(const change of history){
      if(change.effectiveDate<=record.date)assigned=change.toTeamId??null;
    }
  }
  return Boolean(assigned && assigned===record.teamId);
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
      safe.planIds=securePricing(p).map(v=>v.planId);
    }
    return safe;
  });
}
function safeRecords(all,policy,products=[]) {
  const productById=new Map(products.map(p=>[p.id,p]));
  return all.map(record=>{
    const out={
      id:record.id,companyId:record.companyId,uid:record.uid,
      memberNameSnapshot:record.memberNameSnapshot,
      teamId:record.teamId,teamNameSnapshot:record.teamNameSnapshot,
      date:record.date,workLocation:record.workLocation,
      totalCount:record.totalCount,reportStatus:record.reportStatus,
      reportedAt:record.reportedAt,createdByUid:record.createdByUid,
      updatedByUid:record.updatedByUid,createdAt:record.createdAt,
      updatedAt:record.updatedAt,
      // This is Firestore's server document version, not an editable price.
      recordVersion:record.__firestoreUpdateTime||null
    };
    const permittedRevenue=visibleMoney(policy,record);
    if(permittedRevenue)out.totalRevenue=record.totalRevenue;
    const input=record.results && typeof record.results==="object"?record.results:{};
    out.results=Object.fromEntries(Object.entries(input).map(([k,v])=>{
      const result=v && typeof v==="object"?v:{};
      const productId=result.productId ||
        products.find(p=>k===p.id || k.startsWith(p.id+"__cb_"))?.id || null;
      const product=productById.get(productId);
      let planId=null;
      // Older snapshots can reference deleted/renamed plans. Their count
      // remains visible but the line cannot be silently repriced.
      if(product){
        try{
          planId=securePricing(product).find(p=>p.cashback===Number(result.cashback||0))?.planId||null;
        }catch{planId=null;}
      }
      const safe={productId,planId,productName:withoutAmounts(result.productName),
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
  // Revenue-goal access is for the CURRENT team, unlike historical
  // record access by explicitly granted ordinary members.
  return all.filter(goal=>policy.canViewRevenue &&
      (policy.isOwner || Boolean(policy.teamId && goal.teamId===policy.teamId)))
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
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const t=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const tokyo=`${t.year}-${t.month}-${t.day}`;
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
  },products:safeProducts(products,policy),records:safeRecords(records,policy,products),revenueGoals:safeGoals(revenueGoals,policy)};
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
    if(url.pathname==="/v1/count-record" && request.method==="POST"){
      // Three independent fail-closed switches. Never enable on an untested
      // dual-host release or when no safe backup has been verified.
      if(env.FINANCE_WRITE_ENABLED!=="enabled" ||
         env.FINANCE_GATEWAY_ENABLED!=="enabled" ||
         env.FINANCE_WRITE_APPROVAL!=="DUAL_HOST_BACKUP_VERIFIED" ||
         env.FIREBASE_SPARK_VERIFIED!=="I_VERIFIED_SPARK_NO_BILLING"){
        return safeJSON({error:"safe_write_not_released"},503,origin);
      }
      if(env.FIREBASE_PROJECT_ID!==PROJECT_ID)return safeJSON({error:"project_mismatch"},503,origin);
      if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
        return safeJSON({error:"json_only"},415,origin);
      const auth=request.headers.get("authorization")||"";
      if(!auth.startsWith("Bearer "))return safeJSON({error:"authorization_required"},401,origin);
      const length=Number(request.headers.get("content-length")||0);
      if(length>20000)return safeJSON({error:"request_too_large"},413,origin);
      try{
        const principal=await verifiedToken(auth.slice(7));
        const raw=await request.text();
        if(raw.length>20000)return safeJSON({error:"request_too_large"},413,origin);
        let payload;
        try{payload=JSON.parse(raw);}catch{return safeJSON({error:"invalid_json"},400,origin);}
        const timeParts=new Intl.DateTimeFormat("en-US",{
          timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
        }).formatToParts(new Date());
        const tokyo=Object.fromEntries(timeParts.map(p=>[p.type,p.value]));
        const day=`${tokyo.year}-${tokyo.month}-${tokyo.day}`;
        const store=makeFirestoreRestStore(env,{token:googleBearer});
        const saved=await submitCounts(store,principal,payload,{
          policyResolver:(user,member,company,uid)=>approvedPolicy(user,member,company,uid,day)
        });
        return safeJSON(saved,200,origin);
      }catch(error){
        if(error instanceof PermissionDenied || error.status===403)
          return safeJSON({error:"forbidden"},403,origin);
        if(error instanceof SaveConflict || error.status===409)
          return safeJSON({error:"record_conflict_reload_required"},409,origin);
        if(error.name==="ValidationError")
          return safeJSON({error:"invalid_count_or_record"},400,origin);
        if(error.status===401)return safeJSON({error:"unauthorized"},401,origin);
        // Never print source Firestore data, money, names or tokens.
        console.error("finance_count_submission_failed",error.name||"Error");
        return safeJSON({error:"unavailable_retry_only_after_refresh"},503,origin);
      }
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
