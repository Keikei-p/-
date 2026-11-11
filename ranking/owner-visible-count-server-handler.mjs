/**
 * STAGING ONLY / NO DEPLOY. Authenticated count-only owner publication API.
 * This is a server adapter, NOT a registered route or Cloud Function.
 *
 * The missing production dependency is a trusted, exhaustive, snapshot-
 * consistent loader of the existing internal + partner count ledgers and
 * owner-reviewed exact SKU mappings. Never use browser-supplied sources,
 * product IDs, consent, roles or publication flags.
 *
 * IMPORTANT: the default source loader and owner settings reader use
 * separate read-only transactions. The optional atomic loader requires
 * both to share a single transaction and matching read-time proof, but
 * the real canonical Firestore adapters are still missing. Do NOT deploy
 * until exhaustive sources and real-account finance-denial E2E are proven.
 */
import {createVerifiedRankTokenReader,createFreshCombinedRankingContext}
 from "./trusted-combined-ranking-context.mjs";
import {createOwnerProductVisibilityStore}
 from "./owner-product-visibility-firestore.mjs";
import {buildOwnerVisibleCountRanking}
 from "./owner-product-visibility-rankings.mjs";
import {auditNoFinancialKeys} from "../security/public-projection.mjs";

const ORIGIN="https://nico-factory.web.app";
const PATH="/v1/owner-visible-counts";
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DAY=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TOKEN=/^Bearer ([A-Za-z0-9._-]{20,12000})$/;
class Block extends Error{
 constructor(status=503){super("request_blocked");this.status=status;}
}
function reply(status,body,origin){
 const headers={"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","Pragma":"no-cache",
  "X-Content-Type-Options":"nosniff","Vary":"Origin"};
 if(origin===ORIGIN)headers["Access-Control-Allow-Origin"]=ORIGIN;
 return new Response(JSON.stringify(body),{status,headers});
}
function validDay(day){
 if(typeof day!=="string"||!DAY.test(day))return false;
 const [y,m,d]=day.split("-").map(Number);
 const t=new Date(0);t.setUTCHours(0,0,0,0);t.setUTCFullYear(y,m-1,d);
 return t.getUTCFullYear()===y&&t.getUTCMonth()+1===m&&t.getUTCDate()===d;
}

// An authenticated monthly snapshot can safely answer a DAY or a WEEK only
// if every requested day belongs to that same canonical month. Cross-month
// weeks require a separate complete, atomic two-month reader: fail closed.
function requestedPeriod(params){
 const keys=[...params.keys()];
 if(keys.length!==1||!["month","day","week"].includes(keys[0]))
  throw new Block(400);
 const kind=keys[0],value=params.get(kind);
 if(kind==="month"){
  if(!MONTH.test(value??""))throw new Block(400);
  return {kind,month:value,day:value+"-01"};
 }
 if(!validDay(value))throw new Block(400);
 const month=value.slice(0,7);
 if(kind==="week"){
  const monday=new Date(value+"T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
  const sunday=new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate()+6);
  if(monday.toISOString().slice(0,7)!==month||
     sunday.toISOString().slice(0,7)!==month)
   throw new Block(400); // never publish an incomplete weekly total
 }
 return {kind,month,day:value};
}

function sameSet(a,b){
 return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
  new Set(a).size===a.length&&a.every(x=>b.includes(x));
}
/**
 * Inject ONLY a trusted server loader; it must return the complete canonical
 * count snapshot, never a page or pre-aggregated daily totals.
 *
 * A successful offline response is not proof of live Firebase availability.
 * Feature flag is OFF unless explicitly enabled by a future release gate.
 */
export function createStagedOwnerVisibleCountHandler({
 enabled=false,auth,db,FieldValue,loadCompleteVerifiedCountInput,
 loadAtomicVerifiedCountSnapshot
}={}){
 if(enabled!==true)return async request=>reply(503,
  {error:"service_disabled"},request?.headers?.get?.("Origin")??"");
 const atomic=typeof loadAtomicVerifiedCountSnapshot==="function";
 if(!db||!auth||!FieldValue||
    (!atomic&&typeof loadCompleteVerifiedCountInput!=="function"))
  throw Error("trusted server count dependencies missing");
 const verify=createVerifiedRankTokenReader({auth});
 const contextReader=createFreshCombinedRankingContext({db});
 const publicationReader=createOwnerProductVisibilityStore({db,FieldValue});
 return async request=>{
  const origin=request?.headers?.get?.("Origin")??"";
  try{
   if(request?.method!=="GET")throw new Block(405);
   if(origin&&origin!==ORIGIN)throw new Block(403);
   const url=new URL(request.url);
   if(url.pathname!==PATH||url.origin!==ORIGIN)throw new Block(404);
   const {kind,month,day}=requestedPeriod(url.searchParams);
   const token=request.headers.get("Authorization")?.match(TOKEN)?.[1];
   if(!token)throw new Block(401);
   let principal;
   try{principal=await verify(token);}catch{throw new Block(401);}
   const context=await contextReader(principal);
   // The optional atomic path requires a single read-only transaction
   // spanning canonical counts and owner publication. The legacy staged
   // loader remains for offline tests, but is NOT production-release ready.
   let input,publication;
   if(atomic){
    const pair=await loadAtomicVerifiedCountSnapshot({month,context});
    input=pair?.input;publication=pair?.publication;
    if(typeof input?.snapshotReadTime!=="string"||
       publication?.snapshotReadTime!==input.snapshotReadTime||
       !Array.isArray(input.sources)||
       input.sources.some(s=>s?.readTime!==input.snapshotReadTime))
     throw new Block();
   }else{
    input=await loadCompleteVerifiedCountInput({month,context});
   }
   if(!input||input.hubCompanyId!==context.hubCompanyId||
      !sameSet(input.approvedCompanyIds,context.approvedCompanyIds)||
      !input.period||input.period.kind!=="month"||
      input.period.day!==month+"-01"||
      !validDay(input.period.asOf)||
      input.period.asOf.slice(0,7)!==month||
      !Array.isArray(input.sources)||!Array.isArray(input.productGroups)||
      input.sources.length!==context.approvedCompanyIds.length||
      input.mappingsReviewed!==true)
    throw new Block();
   // A month-scoped transactional snapshot may be safely narrowed, but
   // never broadened into another month or after its trusted server asOf.
   if(day>input.period.asOf)throw new Block(400);
   // Ignore any context supplied by the loader. Only the fresh Auth-derived
   // server context is authorized to determine audience and company set.
   const {mappingsReviewed:_proof,context:_ignored,...countInput}=input;
   const period={kind,day,asOf:input.period.asOf};
   if(!atomic)publication=await publicationReader.readForRanking({
    context,mappingsReviewed:true
   });
   const result=buildOwnerVisibleCountRanking({
    input:{...countInput,period,context},publication
   });
   auditNoFinancialKeys(result);
   const json=JSON.stringify(result);
   if(/"(?:records|lines|rawProducts|revenue|unitPrice|cashback|price|amount)"\s*:/i.test(json))
    throw new Block();
   return reply(200,result,origin);
  }catch(error){
   return reply(error instanceof Block?error.status:503,
    {error:"request_blocked"},origin);
  }
 };
}
