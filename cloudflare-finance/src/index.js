import {visibleMoney} from "./revenue-scope.js";
import {buildCompanyCountRanking} from "./company-count-ranking.mjs";
import {rankingAccess,validateViewerChange,buildPrivateRevenueRanking} from "./individual-ranking.mjs";
import {buildAnnualSalesReport,makeArchivePackage,writeImmutableArchive,readImmutableArchive} from "./sales-archive.mjs";
import {partnerActivationWrites} from "./partner-provision.mjs";
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
  return raw?{id:String(raw.name||"").split("/").pop(),...documentFields(raw.fields||{}),
    recordVersion:raw.updateTime||null}:null;
}
async function firestoreGet(env, path, fetcher = fetch) {
  const bearer=await googleBearer(env,fetcher);
  const result=await fetcher(base+"/documents/"+documentPath(path),{headers:{Authorization:"Bearer "+bearer}});
  if(result.status===404)return null;
  if(!result.ok)throw httpError(503,"firestore_read_unavailable");
  return docData(await result.json());
}
// Snapshot-pinned, name-cursor Firestore pagination. Unlike OFFSET,
// startAt reads each qualifying document only once and is stable across pages.
// Crucially: NEVER return only the first N records and silently undercount.
// The 100k hard ceiling is a resource safety guard, not a 2,000-record limit.
async function collectFirestoreQueryPages(pageReader,{collectionId,companyId,pageSize=500,maxPages=201}){
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(collectionId||"") ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(companyId||"") ||
      !Number.isInteger(pageSize) || pageSize<1 || pageSize>500 ||
      !Number.isInteger(maxPages) || maxPages<1 || maxPages>201)
    throw httpError(400,"invalid_query_args");
  const root="projects/"+PROJECT_ID+"/databases/(default)/documents/"+collectionId+"/";
  let cursor="",readTime="",lastName="";
  const all=[];
  const names=new Set();
  for(let page=0;page<maxPages;page++){
    const rows=await pageReader({cursor,readTime,pageSize});
    if(!Array.isArray(rows))throw httpError(503,"firestore_query_invalid_page");
    const documented=rows.filter(row=>row&&row.document);
    if(documented.length>pageSize)
      throw httpError(503,"firestore_query_excess_page");
    const stamp=rows.find(row=>typeof row?.readTime==="string")?.readTime;
    if(!stamp || !/^\d{4}-\d{2}-\d{2}T/.test(stamp))
      throw httpError(503,"firestore_snapshot_unavailable");
    if(!readTime)readTime=stamp;
    // Reject a shifting first-page snapshot instead of reporting incorrect totals.
    if(rows.some(row=>row?.readTime && row.readTime!==readTime))
      throw httpError(503,"firestore_snapshot_changed");
    if(rows.some(row=>row?.skippedResults>0))
      throw httpError(503,"firestore_query_skipped_results");
    for(const row of documented){
      const doc=row.document,name=doc.name;
      if(typeof name!=="string" || !name.startsWith(root) ||
         !/^[^/]+$/.test(name.slice(root.length)) || name<=lastName ||
         names.has(name))
        throw httpError(503,"firestore_query_invalid_cursor");
      if(!doc.fields || doc.fields.companyId?.stringValue!==companyId)
        throw httpError(503,"firestore_query_company_mismatch");
      const converted=docData(doc);
      if(converted.companyId!==companyId)
        throw httpError(503,"firestore_query_company_mismatch");
      names.add(name);
      all.push(converted);
      lastName=name;
      if(all.length>100000)throw httpError(503,"firestore_query_resource_limit");
    }
    if(documented.length<pageSize)return all;
    if(!lastName || lastName===cursor)
      throw httpError(503,"firestore_query_stalled");
    cursor=lastName;
  }
  throw httpError(503,"firestore_query_resource_limit");
}
async function firestoreQuery(env, collectionId, companyId, fetcher=fetch){
  const bearer=await googleBearer(env,fetcher);
  return collectFirestoreQueryPages(async ({cursor,readTime,pageSize})=>{
    const sq={structuredQuery:{
      from:[{collectionId}],
      where:{fieldFilter:{field:{fieldPath:"companyId"},op:"EQUAL",
        value:{stringValue:companyId}}},
      orderBy:[{field:{fieldPath:"__name__"},direction:"ASCENDING"}],
      limit:pageSize
    }};
    if(cursor)sq.structuredQuery.startAt={
      values:[{referenceValue:cursor}],before:false
    };
    if(readTime)sq.readTime=readTime;
    const result=await fetcher(base+"/documents:runQuery",{
      method:"POST",
      headers:{Authorization:"Bearer "+bearer,"Content-Type":"application/json"},
      body:JSON.stringify(sq)
    });
    if(!result.ok)throw httpError(503,"firestore_query_unavailable");
    return result.json();
  },{collectionId,companyId});
}
function active(obj) { return obj && obj.active !== false; }
// Server-side selection must precede serialization. Never send raw
// company member objects or any other team's names/emails to partners.
function safePartnerMembers(all,policy) {
  if(!policy.isPartner || !policy.teamId)throw httpError(403,"partner_only");
  return all.filter(m=>active(m) && m.teamId===policy.teamId &&
      (!m.companyId || m.companyId===policy.companyId) &&
      typeof m.uid==="string" && /^[A-Za-z0-9_-]{1,150}$/.test(m.uid))
    .map(m=>({uid:m.uid,name:withoutAmounts(String(m.name||"担当者")).slice(0,30),teamId:policy.teamId}))
    .sort((a,b)=>a.name.localeCompare(b.name,"ja"));
}
// Only called by the authenticated ranking routes. Do NOT send raw member
// documents or company finance data to the browser.
async function rankingMembers(env,policy,fetcher=fetch){
  // Use the SAME cursor-safe roster loader as partner and owner portals.
  // Ranking must never silently omit an employee beyond the first 500.
  const all=await companyMemberPages(env,policy,fetcher);
  return all.filter(m=>m && (!m.companyId || m.companyId===policy.companyId) &&
    m.active!==false && m.accessKind!=="partner" &&
    typeof m.uid==="string" && /^[A-Za-z0-9_-]{1,150}$/.test(m.uid));
}
// Page-aware company member loading. Never return a truncated roster.
async function collectFirestoreMemberPages(pageReader){
  const members=[],seenDocs=new Set(),seenTokens=new Set();
  let token="";
  for(let pageIndex=0;pageIndex<20;pageIndex++){
    const page=await pageReader(token);
    if(!page || typeof page!=="object" ||
       (page.documents!==undefined && !Array.isArray(page.documents)))
      throw httpError(503,"members_invalid_page");
    for(const doc of page.documents||[]){
      if(!doc || typeof doc.name!=="string" || seenDocs.has(doc.name))
        throw httpError(503,"members_duplicated_page");
      seenDocs.add(doc.name);
      members.push(docData(doc));
    }
    if(members.length>10000)throw httpError(503,"members_exceed_safety_limit");
    const next=page.nextPageToken;
    if(!next)return members;
    if(typeof next!=="string" || next.length>3000 || seenTokens.has(next))
      throw httpError(503,"members_invalid_page_token");
    seenTokens.add(next);
    token=next;
  }
  throw httpError(503,"members_exceed_page_limit");
}
async function companyMemberPages(env,policy,fetcher=fetch){
  const bearer=await googleBearer(env,fetcher);
  const path="companies/"+policy.companyId+"/members";
  return collectFirestoreMemberPages(async token=>{
    const args=new URLSearchParams({pageSize:"500"});
    if(token)args.set("pageToken",token);
    const response=await fetcher(base+"/documents/"+documentPath(path)+"?"+args,{
      headers:{Authorization:"Bearer "+bearer}
    });
    if(!response.ok)throw httpError(503,"company_members_unavailable");
    return response.json();
  });
}
async function ownerMemberList(env,policy,fetcher=fetch) {
  if(!policy.isOwner || policy.isPartner)throw httpError(403,"owner_only");
  const list=await companyMemberPages(env,policy,fetcher);
  return list.filter(m=>active(m) && (!m.companyId || m.companyId===policy.companyId)
      && typeof m.uid==="string" && /^[A-Za-z0-9_-]{1,150}$/.test(m.uid)
      && m.companyRole==="member" && m.role==="leader")
    .map(m=>({uid:m.uid,name:withoutAmounts(m.name||"担当者").slice(0,30),
      teamId:m.teamId||null,accessKind:m.accessKind==="partner"?"partner":"direct"}))
    .sort((a,b)=>a.name.localeCompare(b.name,"ja"));
}
async function partnerMemberList(env,policy,fetcher=fetch) {
  if(!policy.isPartner)throw httpError(403,"partner_only");
  return safePartnerMembers(await companyMemberPages(env,policy,fetcher),policy);
}
function approvedPolicy(user,member,company,uid,today="") {
  if(!user || !member || !company || !active(user) || !active(member) || !active(company) ||
      !user.companyId || member.uid!==uid ||
      (user.uid && user.uid!==uid) || member.companyRole!==user.companyRole ||
      (member.companyId && user.companyId!==member.companyId))throw httpError(403,"membership_denied");
  // Any partner marker is restrictive, even if its twin record has not yet
  // been stamped. Only a company administrator may provision accessKind.
  const isPartner=user.accessKind==="partner" || member.accessKind==="partner";
  const isMaster=(company.masterUid||company.ownerUid)===uid;
  if(isPartner && (isMaster || user.companyRole!=="member" || member.companyRole!=="member" ||
      user.role!=="leader" || member.role!=="leader" ||
      !user.teamId || user.teamId!==member.teamId)){
    throw httpError(403,"partner_assignment_invalid");
  }
  const isOwner=isMaster || (user.companyRole==="owner" && member.companyRole==="owner");
  // Existing client roles are stored in BOTH user and company-member docs.
  // If they disagree, NEVER infer extra permissions or silently migrate them.
  // Expose an admin-review indicator; preserve strict dual-grant behavior.
  const needsPermissionReview=!isOwner && (
    (user.canViewRevenue===true)!==(member.canViewRevenue===true) ||
    (user.canViewUnitPrice===true)!==(member.canViewUnitPrice===true)
  );
  const revenue=!isPartner && (isOwner || (user.canViewRevenue===true && member.canViewRevenue===true));
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
  return {companyId:user.companyId,uid,isOwner,isPartner,canViewRevenue:revenue,canViewUnitPrice:unit,
    teamId,revenueScopeStart:start,role:assignment.role,teamHistory:history,isLeader,
    needsPermissionReview};
}
function withoutAmounts(str) {
  const original=String(str||"").normalize("NFKC");
  const candidate=original
    .replace(/(?:CB|キャッシュバック|単価|売上|粗利|価格)\s*[:：=\-]?\s*[¥￥]?\s*[0-9][0-9,.]*(?:万円|千円|万|千|円)?/gi,"")
    .replace(/[¥￥]\s*[0-9][0-9,.]*(?:万円|千円|円)?/gi,"")
    .replace(/[0-9][0-9,.]*\s*(?:万円|千円|円)/gi,"")
    .trim().replace(/[-()\s]+$/g,"");
  // Free text such as 単価一万円 must never be treated as harmless.
  if(/(?:単価|売上|粗利|利益|報酬|原価|卸値|手数料|収益|売価|価格|税込|税抜|[一二三四五六七八九十百千万壱弐参拾]+円)/.test(candidate))
    return "商材";
  // Never publish a doubtful money-bearing label to an unapproved user.
  if(/[¥￥]|[0-9][0-9,.]*\s*(?:円|万円|千円)/i.test(candidate))
    return "商材";
  return candidate || "商材";
}
function safeProducts(all,policy) {
  return all.map(p=>{
    const safe={
      id:p.id, companyId:policy.companyId, name:withoutAmounts(p.name),
      sortOrder:p.sortOrder??0, active:p.active!==false
    };
    // One canonical plan resolver for granted and ungranted users.
    // The legacy browser also synthesizes pricingOptions for old products.
    // Omitting them here breaks older CB rows even for Owner/Leader.
    const plans=securePricing(p);
    safe.planIds=plans.map(v=>v.planId);
    // Cashback is customer-facing; never disclose internal price or sales data.
    if(policy.isPartner) safe.cashbackPlans=plans.map(v=>({planId:"cb_"+v.cashback,cashback:v.cashback}));
    if(policy.canViewUnitPrice){
      safe.revenue=p.revenue;
      safe.pricingOptions=plans.map(({cashback,revenuePerUnit})=>({cashback,revenuePerUnit}));
      safe.cashbackOptions=p.cashbackOptions;
      safe.name=p.name;
    }
    return safe;
  });
}
function safeRecords(all,policy,products=[]) {
  const productById=new Map(products.map(p=>[p.id,p]));
  // Partners never receive other teams' identities, record IDs or counts.
  // Apply scope BEFORE converting records to client-facing objects.
  return all.filter(record=>!policy.isPartner ||
      (policy.teamId && record.teamId===policy.teamId)).map(record=>{
    const out={
      id:record.id,companyId:record.companyId,uid:record.uid,
      memberNameSnapshot:policy.isPartner?withoutAmounts(record.memberNameSnapshot):record.memberNameSnapshot,
      teamId:record.teamId,teamNameSnapshot:policy.isPartner?withoutAmounts(record.teamNameSnapshot):record.teamNameSnapshot,
      date:record.date,workLocation:policy.isPartner?withoutAmounts(record.workLocation):record.workLocation,
      totalCount:record.totalCount,reportStatus:record.reportStatus,
      reportedAt:record.reportedAt,createdByUid:record.createdByUid,
      updatedByUid:record.updatedByUid,createdAt:record.createdAt,
      // The updateTime metadata comes from Firestore's server, not an
      // app-stored field or an untrusted client-provided revision value.
      updatedAt:record.updatedAt,recordVersion:record.recordVersion||null
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
      if(policy.isPartner && planId!==null){
        const cb=securePricing(product).find(p=>p.planId===planId)?.cashback;
        planId=Number.isSafeInteger(cb)?"cb_"+cb:null;
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
    // Even an explicitly price-granted user must not learn cashback from
    // result MAP KEYS belonging to another team/out-of-scope record.
    if(!policy.canViewUnitPrice || !permittedRevenue){
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
async function financeView(env,principal,fetcher=fetch,{partnerOnly=false}={}){
  const policy=await memberPolicy(env,principal,fetcher);
  if(partnerOnly && !policy.isPartner)throw httpError(403,"partner_only");
  const [products,records,revenueGoals,members]=await Promise.all([
    firestoreQuery(env,"products",policy.companyId,fetcher),
    firestoreQuery(env,"records",policy.companyId,fetcher),
    policy.canViewRevenue?firestoreQuery(env,"revenueGoals",policy.companyId,fetcher):Promise.resolve([]),
    partnerOnly?partnerMemberList(env,policy,fetcher):Promise.resolve([])
  ]);
  const payload={policy:{
    canViewRevenue:policy.canViewRevenue,canViewUnitPrice:policy.canViewUnitPrice,isOwner:policy.isOwner,isPartner:policy.isPartner,
    needsPermissionReview:policy.needsPermissionReview,teamId:policy.teamId
  },products:safeProducts(products,policy),records:safeRecords(records,policy,products),revenueGoals:safeGoals(revenueGoals,policy)};
  // Count-only monthly leaderboard uses the same records for internal teams
  // and external partner teams, avoiding a second registration or double count.
  // Only owners receive whole-company ranking data.
  if(policy.isOwner){
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit"})
      .formatToParts(new Date());
    const y=parts.find(p=>p.type==="year")?.value;
    const m=parts.find(p=>p.type==="month")?.value;
    try{
      payload.companyCountRanking=buildCompanyCountRanking(records,policy.companyId,y+"-"+m);
    }catch{
      // Legacy duplicate daily documents require review. Never let an
      // optional leaderboard disable the Owner's existing finance view.
      payload.companyCountRankingError="duplicate_or_inconsistent_records";
    }
  }
  if(partnerOnly)payload.members=members;
  return payload;
}
export default {
  async fetch(request,env){
    const origin=request.headers.get("origin")||"";
    const url=new URL(request.url);
    if(origin && !ALLOWED_ORIGINS.has(origin))return safeJSON({error:"origin_denied"},403);
    if(request.method==="OPTIONS"){
      if(!ALLOWED_ORIGINS.has(origin))return safeJSON({error:"origin_denied"},403);
      return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Max-Age":"600","Vary":"Origin"}});
    }
    if(url.pathname==="/health"&&request.method==="GET"){
      return safeJSON({ok:true,service:"finance-gateway",enabled:env.FINANCE_GATEWAY_ENABLED==="enabled",mode:"read_only"},200,origin);
    }
    // OWNER-ONLY financial archive and annual report; separate from the
    // amount-hidden personal ranking and partner dashboard.
    // No Firestore record DELETE, UPDATE or transformation is present here.
    if(["/v1/owner-annual-report","/v1/owner-annual-archive",
        "/v1/owner-annual-archive-list"].includes(url.pathname)){
      const route=url.pathname;
      if(env.FINANCE_GATEWAY_ENABLED!=="enabled" ||
         env.FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS" ||
         env.FINANCE_ARCHIVE_APPROVAL!=="OWNER_APPROVED_ARCHIVE_READS" ||
         env.FIREBASE_PROJECT_ID!==PROJECT_ID)
        return safeJSON({error:"annual_archive_not_released"},503,origin);
      if(request.method!=="GET" && !(route==="/v1/owner-annual-archive" && request.method==="POST"))
        return safeJSON({error:"method_not_allowed"},405,origin);
      const archiveYear=url.searchParams.get("year")||"";
      if(!/^20\d{2}$/.test(archiveYear))
        return safeJSON({error:"invalid_year"},400,origin);
      const auth=request.headers.get("authorization")||"";
      if(!auth.startsWith("Bearer "))
        return safeJSON({error:"authorization_required"},401,origin);
      try{
        const principal=await verifiedToken(auth.slice(7));
        const policy=await memberPolicy(env,principal);
        if(!policy.isOwner||policy.isPartner || policy.canViewRevenue!==true)
          throw httpError(403,"owner_only");
        // Archive bucket is private and NOT exposed as an R2 public domain.
        const bucket=env.SALES_PRIVATE_ARCHIVES;
        if(route==="/v1/owner-annual-archive-list"){
          if(!bucket?.list)throw httpError(503,"archive_bucket_not_configured");
          const prefix="v1/"+policy.companyId+"/"+archiveYear+"/";
          let cursor,files=[];
          for(let i=0;i<20;i++){
            const page=await bucket.list({prefix,limit:500,...(cursor?{cursor}:{})});
            if(!page || !Array.isArray(page.objects))throw httpError(503,"archive_index_corrupt");
            files.push(...page.objects.filter(o=>/^v1\/[A-Za-z0-9_-]+\/20\d{2}\/[a-f0-9]{64}\\.json$/.test(o.key) &&
              o.key.startsWith(prefix)).map(o=>({
                sha256:o.key.slice(prefix.length,-5),savedAt:o.uploaded?.toISOString?.()||null,
                bytes:o.size
              })));
            if(!page.truncated)return safeJSON({year:archiveYear,files},200,origin);
            if(!page.cursor||page.cursor===cursor)throw httpError(503,"archive_page_stalled");
            cursor=page.cursor;
          }
          throw httpError(503,"archive_index_limit");
        }
        if(route==="/v1/owner-annual-archive" && request.method==="GET"){
          if(!bucket?.get)throw httpError(503,"archive_bucket_not_configured");
          const digest=url.searchParams.get("sha256")||"";
          if(!/^[a-f0-9]{64}$/.test(digest))
            return safeJSON({error:"invalid_archive_checksum"},400,origin);
          const saved=await readImmutableArchive(bucket,policy.companyId,archiveYear,digest);
          if(!saved)return safeJSON({error:"archive_not_found"},404,origin);
          return new Response(saved.raw,{
            headers:{"Content-Type":"application/json; charset=utf-8",
              "Content-Disposition":"attachment; filename=\"sales-"+archiveYear+"-"+digest.slice(0,10)+".json\"",
              "Cache-Control":"no-store,private","X-Content-Type-Options":"nosniff",
              ...(ALLOWED_ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{})},
          });
        }
        // Read-only preparation requires Firestore page pagination and
        // original records, tariff plan and team ID to reconcile strictly.
        const [records,products,teams,goals]=await Promise.all([
          firestoreQuery(env,"records",policy.companyId),
          firestoreQuery(env,"products",policy.companyId),
          firestoreQuery(env,"teams",policy.companyId),
          firestoreQuery(env,"goals",policy.companyId)
        ]);
        const report=buildAnnualSalesReport({
          year:archiveYear,companyId:policy.companyId,records,products,teams
        });
        if(route==="/v1/owner-annual-report")
          return safeJSON({report,stored:false,sourceProtected:true},200,origin);
        // Never archive an unfinished calendar year.
        const nowYear=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric"})
          .format(new Date());
        if(Number(archiveYear)>=Number(nowYear))
          return safeJSON({error:"year_not_closed"},409,origin);
        if(env.FINANCE_ARCHIVE_WRITE_APPROVAL!=="OWNER_APPROVED_IMMUTABLE_R2"||
           !bucket?.put || !bucket?.get)
          return safeJSON({error:"archive_storage_not_released"},503,origin);
        const bundle=makeArchivePackage({report,records,products,teams,goals,
          createdAt:new Date().toISOString()});
        const result=await writeImmutableArchive(bucket,bundle);
        return safeJSON({saved:true,deletedFirestoreDocuments:0,...result},201,origin);
      }catch(e){
        if(e.status===403||e.status===401)
          return safeJSON({error:"forbidden"},e.status,origin);
        // Never print raw financial data, names, file content or token.
        return safeJSON({error:e.message==="archive_too_large_for_safe_worker"?
          "archive_too_large_review_required":"annual_report_review_required"},503,origin);
      }
    }

    // Strictly server-side SALES-ORDERED individual ranking. All financial
    // calculations remain in this Worker. The browser receives rank/name/count.
    if(["/v1/individual-ranking","/v1/individual-rank-viewers",
        "/v1/individual-rank-grant"].includes(url.pathname)){
      const rankRoute=url.pathname,adminRoute=rankRoute!=="/v1/individual-ranking";
      if(env.FINANCE_GATEWAY_ENABLED!=="enabled" ||
         env.FINANCE_RANKING_APPROVAL!=="OWNER_APPROVED_RANK_ONLY" ||
         env.FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS" ||
         env.FIREBASE_PROJECT_ID!==PROJECT_ID)
        return safeJSON({error:"ranking_not_released"},503,origin);
      if(adminRoute && rankRoute==="/v1/individual-rank-grant" &&
         (env.FINANCE_WRITE_ENABLED!=="enabled" ||
          env.FINANCE_WRITE_APPROVAL!=="DUAL_HOST_BACKUP_VERIFIED"))
        return safeJSON({error:"ranking_write_not_released"},503,origin);
      if(request.method!==(rankRoute==="/v1/individual-rank-grant"?"POST":"GET"))
        return safeJSON({error:"method_not_allowed"},405,origin);
      const auth=request.headers.get("authorization")||"";
      if(!auth.startsWith("Bearer "))return safeJSON({error:"authorization_required"},401,origin);
      try{
        const principal=await verifiedToken(auth.slice(7));
        const policy=await memberPolicy(env,principal);
        if(policy.isPartner || (adminRoute&&!policy.isOwner))
          throw httpError(403,"ranking_access_forbidden");
        const grantId=policy.companyId+"_"+policy.uid;
        if(rankRoute==="/v1/individual-ranking"){
          const stored=policy.isOwner?null:await firestoreGet(env,"individualRankingAccess/"+grantId);
          if(!rankingAccess(policy,stored))throw httpError(403,"ranking_not_permitted");
          const month=url.searchParams.get("month");
          if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||""))
            return safeJSON({error:"invalid_month"},400,origin);
          const [records,products,members]=await Promise.all([
            firestoreQuery(env,"records",policy.companyId),
            firestoreQuery(env,"products",policy.companyId),
            rankingMembers(env,policy)
          ]);
          const ranked=buildPrivateRevenueRanking(records,products,members,policy.companyId,month);
          const output=ranked.map(v=>({...v,name:withoutAmounts(v.name)}));
          return safeJSON({month,ranking:output,sort:"overall_revenue_desc",
            amountsIncluded:false},200,origin);
        }
        const members=await rankingMembers(env,policy);
        if(rankRoute==="/v1/individual-rank-viewers"){
          const existing=await firestoreQuery(env,"individualRankingAccess",policy.companyId);
          const grants=new Map(existing.map(a=>[a.uid,a.allowed===true]));
          return safeJSON({viewers:members.filter(m=>m.memberType!=="managed"&&m.hasAccount!==false)
            .map(m=>({uid:m.uid,name:withoutAmounts(m.name||"担当者").slice(0,30),
              allowed:grants.get(m.uid)===true,
              eligible:m.companyRole==="member"}))},200,origin);
        }
        if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
          return safeJSON({error:"json_only"},415,origin);
        const body=await request.text();
        if(body.length>1200)return safeJSON({error:"request_too_large"},413,origin);
        let data;
        try{data=JSON.parse(body);}catch{return safeJSON({error:"invalid_json"},400,origin);}
        if(!data || Object.keys(data).sort().join(",")!=="allowed,uid")
          return safeJSON({error:"invalid_grant"},400,origin);
        const viewer=members.find(m=>m.uid===data.uid);
        const account=viewer?await firestoreGet(env,"users/"+data.uid):null;
        if(!account || account.companyId!==policy.companyId||
           account.accessKind==="partner" || account.active===false ||
           account.companyRole!=="member" || account.uid!==data.uid)
          throw httpError(403,"not_internal_account");
        let validated;
        try{validated=validateViewerChange(policy,viewer,data.uid,data.allowed);}
        catch{throw httpError(403,"ranking_viewer_forbidden");}
        const documentId=policy.companyId+"_"+validated.uid;
        const old=await firestoreGet(env,"individualRankingAccess/"+documentId);
        if(old && (old.uid!==validated.uid||old.companyId!==validated.companyId))
          throw httpError(409,"conflicting_grant");
        if(old?.allowed===validated.allowed)
          return safeJSON({uid:validated.uid,allowed:validated.allowed,unchanged:true},200,origin);
        const auditor=crypto.randomUUID();
        const full="projects/"+PROJECT_ID+"/databases/(default)/documents/";
        const writes=[{update:{name:full+"individualRankingAccess/"+documentId,
          fields:{companyId:{stringValue:policy.companyId},
           uid:{stringValue:validated.uid},allowed:{booleanValue:validated.allowed},
           updatedByUid:{stringValue:principal.uid}}},
          currentDocument:old?{updateTime:old.recordVersion}:{exists:false}},
          {update:{name:full+"companies/"+policy.companyId+"/individualRankingAudits/"+auditor,
            fields:{targetUid:{stringValue:validated.uid},
              allowed:{booleanValue:validated.allowed},
              actorUid:{stringValue:principal.uid}}},
           currentDocument:{exists:false},
           updateTransforms:[{fieldPath:"createdAt",setToServerValue:"REQUEST_TIME"}]}];
        const bearer=await googleBearer(env);
        const result=await fetch(base+"/documents:commit",{
          method:"POST",headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
          body:JSON.stringify({writes})
        });
        if(result.status===409||result.status===412)return safeJSON({error:"grant_stale"},409,origin);
        if(!result.ok)return safeJSON({error:"grant_unavailable"},503,origin);
        return safeJSON({uid:validated.uid,allowed:validated.allowed},200,origin);
      }catch(err){
        if(err.status===401||err.status===403)
          return safeJSON({error:"forbidden"},err.status,origin);
        return safeJSON({error:"private_ranking_unavailable"},503,origin);
      }
    }
    // Lightweight partner update signal; never returns sales, prices, or
    // other teams' records. Re-check membership on every poll.
    if(url.pathname==="/v1/partner-sync" && request.method==="GET"){
      if(env.FINANCE_GATEWAY_ENABLED!=="enabled")
        return safeJSON({error:"cutover_not_authorized"},503,origin);
      if(env.FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS")
        return safeJSON({error:"billing_not_approved"},503,origin);
      if(env.FIREBASE_PROJECT_ID!==PROJECT_ID)
        return safeJSON({error:"project_mismatch"},503,origin);
      const auth=request.headers.get("authorization")||"";
      if(!auth.startsWith("Bearer "))return safeJSON({error:"authorization_required"},401,origin);
      try{
        const principal=await verifiedToken(auth.slice(7));
        const policy=await memberPolicy(env,principal);
        if(!policy.isPartner)throw httpError(403,"partner_only");
        const sync=await firestoreGet(env,"companies/"+policy.companyId+"/publicSync/state");
        return safeJSON({version:sync?.recordVersion||null},200,origin);
      }catch(error){
        if(error.status===401 || error.status===403)
          return safeJSON({error:"forbidden"},error.status,origin);
        return safeJSON({error:"partner_sync_unavailable"},503,origin);
      }
    }
    if(url.pathname==="/v1/owner-count-overview" && request.method==="GET"){
      if(env.FINANCE_GATEWAY_ENABLED!=="enabled")
        return safeJSON({error:"cutover_not_authorized"},503,origin);
      if(env.FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS")
        return safeJSON({error:"billing_not_approved"},503,origin);
      if(env.FIREBASE_PROJECT_ID!==PROJECT_ID)
        return safeJSON({error:"project_mismatch"},503,origin);
      const auth=request.headers.get("authorization")||"";
      if(!auth.startsWith("Bearer "))return safeJSON({error:"authorization_required"},401,origin);
      try{
        const principal=await verifiedToken(auth.slice(7));
        const policy=await memberPolicy(env,principal);
        if(!policy.isOwner || policy.isPartner)throw httpError(403,"owner_only");
        const month=url.searchParams.get("month")||
          new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit"}).format(new Date());
        if(!/^\d{4}-\d{2}$/.test(month))
          return safeJSON({error:"invalid_month"},400,origin);
        const [records,teams,leaders]=await Promise.all([
          firestoreQuery(env,"records",policy.companyId),
          firestoreQuery(env,"teams",policy.companyId),
          ownerMemberList(env,policy)
        ]);
        const ranking=buildCompanyCountRanking(records,policy.companyId,month,teams);
        const names=new Map(teams.map(t=>[t.id,withoutAmounts(t.name||t.id)]));
        return safeJSON({month,ranking:ranking.ranking.map(row=>({...row,
          teamName:names.get(row.teamId)||row.teamId})),
          totalCount:ranking.totalCount,leaders},200,origin);
      }catch(error){
        if(error.status===401||error.status===403)
          return safeJSON({error:"forbidden"},error.status,origin);
        return safeJSON({error:"owner_overview_unavailable"},503,origin);
      }
    }
    // Owner activation is separate from invitations: only already invited,
    // already assigned, active Leaders can be marked as partner accounts.
    if(url.pathname==="/v1/partner-activate" && request.method==="POST"){
      if(env.FINANCE_GATEWAY_ENABLED!=="enabled" || env.FINANCE_WRITE_ENABLED!=="enabled" ||
         env.FINANCE_WRITE_APPROVAL!=="DUAL_HOST_BACKUP_VERIFIED" ||
         env.FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS" ||
         env.FINANCE_PARTNER_APPROVAL!=="OWNER_APPROVED_PARTNER_ONBOARDING")
        return safeJSON({error:"partner_activation_not_released"},503,origin);
      if(env.FIREBASE_PROJECT_ID!==PROJECT_ID)return safeJSON({error:"project_mismatch"},503,origin);
      if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
        return safeJSON({error:"json_only"},415,origin);
      const auth=request.headers.get("authorization")||"";
      if(!auth.startsWith("Bearer "))return safeJSON({error:"authorization_required"},401,origin);
      try{
        const principal=await verifiedToken(auth.slice(7));
        const raw=await request.text();
        if(raw.length>2500)return safeJSON({error:"request_too_large"},413,origin);
        let data;
        try{data=JSON.parse(raw);}catch{return safeJSON({error:"invalid_json"},400,origin);}
        if(!data || Object.keys(data).length!==1 || typeof data.uid!=="string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(data.uid))
          return safeJSON({error:"invalid_partner_uid"},400,origin);
        const policy=await memberPolicy(env,principal);
        if(!policy.isOwner || policy.isPartner)return safeJSON({error:"forbidden"},403,origin);
        const [user,member]=await Promise.all([
          firestoreGet(env,"users/"+data.uid),
          firestoreGet(env,"companies/"+policy.companyId+"/members/"+data.uid)
        ]);
        const team=user?.teamId && /^[A-Za-z0-9_-]{1,128}$/.test(user.teamId)?
          await firestoreGet(env,"teams/"+user.teamId):null;
        let writes;
        try{writes=partnerActivationWrites({policy,targetUid:data.uid,user,member,team});}
        catch{return safeJSON({error:"partner_leader_not_ready"},409,origin);}
        if(!writes.length)return safeJSON({active:true,alreadyActivated:true},200,origin);
        const auditId=crypto.randomUUID();
        writes.push({
          update:{name:"projects/"+PROJECT_ID+"/databases/(default)/documents/companies/"+
            policy.companyId+"/partnerActivationAudits/"+auditId,
            fields:{activatedUid:{stringValue:data.uid},activatedByUid:{stringValue:principal.uid},
              teamId:{stringValue:user.teamId}}},
          currentDocument:{exists:false},
          updateTransforms:[{fieldPath:"createdAt",setToServerValue:"REQUEST_TIME"}]
        });
        const bearer=await googleBearer(env);
        const res=await fetch(base+"/documents:commit",{
          method:"POST",headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
          body:JSON.stringify({writes})
        });
        if(res.status===409||res.status===412)return safeJSON({error:"partner_activation_conflict"},409,origin);
        if(!res.ok)return safeJSON({error:"partner_activation_unavailable"},503,origin);
        const reply=await res.json();
        if(!Array.isArray(reply.writeResults)||reply.writeResults.length!==writes.length)
          return safeJSON({error:"activation_confirmation_unknown"},503,origin);
        return safeJSON({active:true},200,origin);
      }catch(error){
        if(error.status===401||error.status===403)
          return safeJSON({error:"unauthorized"},error.status,origin);
        return safeJSON({error:"partner_activation_unavailable"},503,origin);
      }
    }
    if(url.pathname==="/v1/count-record" && request.method==="POST"){
      // Three independent fail-closed switches. Never enable on an untested
      // dual-host release or when no safe backup has been verified.
      if(env.FINANCE_WRITE_ENABLED!=="enabled" ||
         env.FINANCE_GATEWAY_ENABLED!=="enabled" ||
         env.FINANCE_WRITE_APPROVAL!=="DUAL_HOST_BACKUP_VERIFIED" ||
         env.FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS"){
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
    const partnerOnly=url.pathname==="/v1/partner-dashboard";
    if((url.pathname!=="/v1/financial-view" && !partnerOnly)||request.method!=="GET")
      return safeJSON({error:"not_found"},404,origin);
    if(env.FINANCE_GATEWAY_ENABLED!=="enabled")return safeJSON({error:"cutover_not_authorized"},503,origin);
    // Even read-only secure views incur Firestore reads on Blaze.
    // Require explicit cost review before making ANY monetary-data query.
    if(env.FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS")
      return safeJSON({error:"billing_not_approved"},503,origin);
    if(env.FIREBASE_PROJECT_ID!==PROJECT_ID)return safeJSON({error:"project_mismatch"},503,origin);
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return safeJSON({error:"authorization_required"},401,origin);
    try{
      const principal=await verifiedToken(auth.slice(7));
      const answer=await financeView(env,principal,fetch,{partnerOnly});
      return safeJSON(answer,200,origin);
    }catch(error){
      if(error.status!==401&&error.status!==403)console.error("finance_gateway_failed",error.message);
      return safeJSON({error:error.status===401?"unauthorized":error.status===403?"forbidden":"unavailable"},error.status||503,origin);
    }
  }
};
export {approvedPolicy,safeProducts,safeRecords,safeGoals,safePartnerMembers,visibleMoney,withoutAmounts,verifiedToken,financeView,docData,collectFirestoreMemberPages,collectFirestoreQueryPages,firestoreQuery};
