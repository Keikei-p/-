"use strict";
/**
 * STAGING ONLY / NO DEPLOY.
 * Express (Firebase Functions v2 onRequest) -> validated standard Request
 * for the pre-existing authenticated count-only monthly ranking handler.
 *
 * This is an adapter, NOT a deployed Function. Only the known direct Function ingress and the future Hosting rewrite
 * /v1/owner-visible-counts are accepted and normalized to one trusted path.
 * No Firebase credentials, data stores, finance APIs or production switches
 * are used here. The caller must inject the real, verified backend handler.
 */
const ORIGIN="https://nico-factory.web.app";
const PATH="/v1/owner-visible-counts";
const DIRECT_FUNCTION_PATH="/getVerifiedJointCountRanking";
const TOKEN=/^Bearer ([A-Za-z0-9._-]{20,12000})$/;
// Exact output fields of buildVerifiedCountDashboard (hub/partner owner).
// A newly introduced response field must be explicitly security-reviewed.
// A blacklist alone cannot catch an unforeseen finance field (e.g. salary).
const PUBLIC_FIELDS=new Set([
 "schema","role","unit","period","scope","range","readTime","start","end",
 "previousStart","previousEnd","days","summary","own","partner","total",
 "unidentified","memberRanking","productRanking","companyBreakdown",
 "teamBreakdown","filters","publicRanking","members","products","people",
 "companies","teams","id","name","company","companyId","companyName","kind",
 "teamId","teamName","uid","productId","count","unidentifiedCount",
 "ownCount","partnerCount","rank","hasVerifiedSubmission","reportStatus","reportedDays",
 "previousCount","change","growth","topProduct","remainingToGoal",
 "personalBestStatus"
]);
const FINANCE_KEY=/(?:revenue|sales|amount|price|unitprice|cashback|commission|salary|profit|margin|payment|fee|売上|単価|金額|報酬|利益|キャッシュバック)/i;
const PRIVATE_TEXT=/(?:[¥￥$€]|(?:[0-9０-９])[0-9０-９.,，]*\s*(?:万円|千円|円)|(?:売上|単価|キャッシュバック|cash\s*back|revenue|commission|salary|unit\s*price|CB)[\s:_=-]*[0-9０-９])/i;
const fail=()=>{throw Error("JOINT_COUNT_HTTP_ADAPTER_INVALID");};
const originFrom=req=>typeof req?.headers?.origin==="string"?
 req.headers.origin:"";
function headers(res,origin){
 res.setHeader("Content-Type","application/json; charset=utf-8");
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Pragma","no-cache");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("Vary","Origin");
 if(origin===ORIGIN)res.setHeader("Access-Control-Allow-Origin",ORIGIN);
}
function deny(res,code,origin){
 headers(res,origin);
 res.status(code).send(JSON.stringify({error:"request_blocked"}));
}
function requestPath(req){
 const raw=req?.originalUrl;
 if(typeof raw!=="string"||raw.length>512||
    !raw.startsWith("/")||raw.startsWith("//")||
    raw.includes("#")||raw.includes("\\")||
    /[\r\n\x00-\x1F]/.test(raw))return null;
 // Reject the ORIGINAL path before URL normalizes /./, /../ or %2e%2e.
 // Only these two literal ingress paths are authorized; no encoded aliases.
 const rawPath=raw.split("?")[0];
 if(rawPath!==PATH&&rawPath!==DIRECT_FUNCTION_PATH)return null;
 const url=new URL(raw,ORIGIN);
 if(url.origin!==ORIGIN||
    ![PATH,DIRECT_FUNCTION_PATH].includes(url.pathname)||
    url.username||url.password)return null;
 // The direct HTTPS Cloud Function path is allowed only as an ingress alias.
 // Internal ranking authorization always receives the same canonical path.
 return new URL(PATH+url.search,ORIGIN);
}
function moneyFree(value,depth=0){
 if(depth>32)return false;
 if(typeof value==="string")return value.length<=5000&&
  !PRIVATE_TEXT.test(value.normalize("NFKC"));
 if(value===null||typeof value==="number"||typeof value==="boolean")
  return typeof value!=="number"||Number.isFinite(value);
 if(Array.isArray(value))
  return value.length<=10000&&value.every(x=>moneyFree(x,depth+1));
 if(typeof value!=="object")return false;
 const keys=Object.keys(value);
 return keys.length<=10000&&keys.every(k=>
  !FINANCE_KEY.test(k)&&PUBLIC_FIELDS.has(k)&&moneyFree(value[k],depth+1));
}
// A partner may receive only the approved count-only public leaderboard rows.
// The general field allowlist is NOT sufficient: it also contains hub-only IDs.
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const exact=(obj,keys)=>obj!==null&&typeof obj==="object"&&
 !Array.isArray(obj)&&Object.keys(obj).length===keys.length&&
 keys.every(key=>own(obj,key));
const scopedEnvelope=(data,keys)=>data!==null&&typeof data==="object"&&
 (own(data,"scope")?
  ["joint","own","partner"].includes(data.scope)&&exact(data,[...keys,"scope"]):
  exact(data,keys));
const rankRows=(rows,keys)=>Array.isArray(rows)&&rows.length<=10000&&
 rows.every((row,i)=>exact(row,keys)&&
  Number.isSafeInteger(row.rank)&&row.rank>0&&
  Number.isSafeInteger(row.count)&&row.count>=0&&
  keys.filter(k=>["name","company"].includes(k)).every(k=>
   typeof row[k]==="string"&&row[k].trim().length>0)&&
  // Standard competition ranking: equal counts tie; the next place skips.
  // The trusted canonical builder emits highest score first.
  (i===0?row.rank===1:
   rows[i-1].count>=row.count&&
   row.rank===(rows[i-1].count===row.count?rows[i-1].rank:i+1)));
const sumCounts=rows=>{
 let sum=0;
 for(const row of rows){
  sum+=row.count;
  if(!Number.isSafeInteger(sum))return null;
 }
 return sum;
};
// The shared allowlist covers both roles. Enforce the exact role envelope too:
// otherwise a partner response could smuggle hub-only aggregate fields that
// happen to be individually allowlisted (for example partner/total/people).
const HUB_ENVELOPE=["schema","role","unit","period","range","readTime",
 "summary","memberRanking","productRanking","companyBreakdown","teamBreakdown","filters"];
const PARTNER_ENVELOPE=["schema","role","unit","period","range","readTime",
 "own","publicRanking"];
const HUB_COMPANY_ROW=["id","name","kind","count","unidentifiedCount",
 "hasVerifiedSubmission","rank"];
const HUB_TEAM_ROW=["id","companyId","companyName","name","count","rank"];
function validHubCompanyRow(row){
 return exact(row,HUB_COMPANY_ROW)&&
  typeof row.id==="string"&&typeof row.name==="string"&&
  ["自社","協力店"].includes(row.kind)&&
  Number.isSafeInteger(row.count)&&row.count>=0&&
  Number.isSafeInteger(row.unidentifiedCount)&&row.unidentifiedCount>=0&&
  row.unidentifiedCount<=row.count&&
  typeof row.hasVerifiedSubmission==="boolean"&&
  (row.hasVerifiedSubmission?
   Number.isSafeInteger(row.rank)&&row.rank>0:
   row.rank===null);
}
function validHubTeamRow(row){
 return exact(row,HUB_TEAM_ROW)&&
  ["id","companyId","companyName","name"].every(key=>
   typeof row[key]==="string"&&row[key].trim().length>0)&&
  Number.isSafeInteger(row.count)&&row.count>=0&&
  Number.isSafeInteger(row.rank)&&row.rank>0;
}
function hubPublicScopeSafe(data){
 if(!scopedEnvelope(data,HUB_ENVELOPE)||
    !exact(data.summary,["own","partner","total","unidentified"])||
    Object.values(data.summary).some(x=>!Number.isSafeInteger(x)||x<0)||
    !Array.isArray(data.companyBreakdown)||data.companyBreakdown.length>10000||
    !data.companyBreakdown.every(validHubCompanyRow)||
    !Array.isArray(data.teamBreakdown)||data.teamBreakdown.length>10000||
    !data.teamBreakdown.every(validHubTeamRow)||
    !Array.isArray(data.memberRanking)||data.memberRanking.length>10000||
    !Array.isArray(data.productRanking)||data.productRanking.length>10000)
  return false;
 const companies=data.companyBreakdown,teams=data.teamBreakdown;
 const self=companies.filter(x=>x.kind==="自社");
 const companyIds=new Set(companies.map(x=>x.id));
 if(self.length!==1||companyIds.size!==companies.length||
    teams.some(x=>!companyIds.has(x.companyId)))return false;
 const totals=data.summary;
 const companyTotal=sumCounts(companies),teamTotal=sumCounts(teams);
 const memberTotal=sumCounts(data.memberRanking);
 const productTotal=sumCounts(data.productRanking);
 const unidentified=companies.reduce((n,x)=>n+x.unidentifiedCount,0);
 if([companyTotal,teamTotal,memberTotal,productTotal].some(x=>x===null)||
    !Number.isSafeInteger(unidentified)||
    totals.own!==self[0].count||
    totals.total!==companyTotal||
    totals.partner!==totals.total-totals.own||
    totals.unidentified!==unidentified||
    teamTotal!==memberTotal||
    memberTotal!==totals.total-unidentified||
    productTotal!==totals.total)return false;
 // Original product records cannot be manufactured or moved between firms.
 // A product's own/partner breakdown must reconcile to exact company counts.
 for(const row of data.productRanking){
  if(!row||!Number.isSafeInteger(row.count)||row.count<0||
     !Number.isSafeInteger(row.ownCount)||row.ownCount<0||
     !Number.isSafeInteger(row.partnerCount)||row.partnerCount<0||
     row.ownCount+row.partnerCount!==row.count||
     !Array.isArray(row.companies)||row.companies.length>10000)
    return false;
  let ownCount=0,partnerCount=0;
  const seen=new Set();
  for(const company of row.companies){
   if(!company||typeof company.companyId!=="string"||
      !companyIds.has(company.companyId)||seen.has(company.companyId)||
      !Number.isSafeInteger(company.count)||company.count<0)
    return false;
   seen.add(company.companyId);
   if(company.companyId===self[0].id)ownCount+=company.count;
   else partnerCount+=company.count;
  }
  if(!Number.isSafeInteger(ownCount)||!Number.isSafeInteger(partnerCount)||
     ownCount!==row.ownCount||partnerCount!==row.partnerCount)return false;
 }
 return true;
}

const PARTNER_OWN_FIELDS=new Set(["company","count","unidentifiedCount","people","products"]);
const OWN_PRODUCT_ROW=["id","name","count"];
const OWN_PERSON_ROW=["id","name","companyId","companyName","teamId",
 "teamName","count","reportStatus","reportedDays","previousCount",
 "change","growth","topProduct","remainingToGoal","personalBestStatus","rank"];
const ownRows=(rows,keys)=>Array.isArray(rows)&&rows.length<=10000&&
 rows.every(row=>exact(row,keys)&&Number.isSafeInteger(row.count)&&row.count>=0);
function partnerOwnScopeSafe(ownData){
 if(!ownData||typeof ownData!=="object"||Array.isArray(ownData)||
    Object.keys(ownData).some(key=>!PARTNER_OWN_FIELDS.has(key))||
    !Number.isSafeInteger(ownData.count)||ownData.count<0)return false;
 if(own(ownData,"company")&&typeof ownData.company!=="string")return false;
 if(own(ownData,"unidentifiedCount")&&
    (!Number.isSafeInteger(ownData.unidentifiedCount)||
     ownData.unidentifiedCount<0||ownData.unidentifiedCount>ownData.count))return false;
 if(own(ownData,"people")&&!ownRows(ownData.people,OWN_PERSON_ROW))return false;
 if(own(ownData,"products")&&!ownRows(ownData.products,OWN_PRODUCT_ROW))return false;
 return true;
}
function partnerPublicScopeSafe(data){
 if(!scopedEnvelope(data,PARTNER_ENVELOPE)||!partnerOwnScopeSafe(data.own))return false;
 // The partner's own-company detail is independent of the selected PUBLIC
 // scope. Prove it against its own rows, never a different firm's total.
 if(own(data,"scope")&&(!exact(data.own,["company","count","unidentifiedCount","people","products"])||
    sumCounts(data.own.products)!==data.own.count||
    sumCounts(data.own.people)!==data.own.count-data.own.unidentifiedCount||
    new Set(data.own.products.map(x=>x.id)).size!==data.own.products.length||
    new Set(data.own.people.map(x=>x.id)).size!==data.own.people.length))return false;
 const p=data.publicRanking;
 if(!p||typeof p!=="object"||Array.isArray(p)||
    !own(p,"members")||!own(p,"products")||
    Object.keys(p).some(k=>!["members","products","companies","teams"].includes(k)))
  return false;
 // The published contract always contains all FOUR leaderboards.
 // A partial page is not a verified joint ranking; don't silently present it.
 if(!exact(p,["members","products","companies","teams"])||
    !rankRows(p.members,["rank","company","name","count"])||
    !rankRows(p.products,["rank","name","count"])||
    !rankRows(p.companies,["rank","name","count"])||
    !rankRows(p.teams,["rank","name","company","count"]))return false;
 const productTotal=sumCounts(p.products),companyTotal=sumCounts(p.companies);
 const memberTotal=sumCounts(p.members),teamTotal=sumCounts(p.teams);
 // Unidentified company-code rows belong to companies and products but
 // NEVER to a fabricated person or team. They can explain only the gap
 // between total published counts and attributable counts.
 return productTotal!==null&&companyTotal!==null&&
  memberTotal!==null&&teamTotal!==null&&
  productTotal===companyTotal&&memberTotal===teamTotal&&
  memberTotal<=companyTotal&&
  (data.scope!==undefined&&data.scope!=="joint"||data.own.count<=companyTotal);
}
/**
 * Calling this function never accesses live data. While the feature flag
 * is false, it never initializes or even invokes the ranking backend.
 *
 * @param {Object} config
 * @param {()=>boolean} config.enabled Trusted server-side release flag
 * @param {()=>Promise<Function>|Function} config.loadHandler Auth+Rules
 *  verified canonical handler (never a browser-provided callback).
 */
function createJointCountHttpAdapter({enabled=()=>false,loadHandler}={}){
 if(typeof enabled!=="function"||typeof loadHandler!=="function")fail();
 let pending=null;
 return async function jointCountHttp(req,res){
  const origin=originFrom(req);
  try{
   if(enabled()!==true){deny(res,503,origin);return;}
   if(origin&&origin!==ORIGIN){deny(res,403,origin);return;}
   const path=requestPath(req);
   if(!path){deny(res,404,origin);return;}
   if(req.method==="OPTIONS"){
    const method=req.headers?.["access-control-request-method"];
    const asked=req.headers?.["access-control-request-headers"];
    if(origin!==ORIGIN||method!=="GET"||
       typeof asked!=="string"||
       !/^authorization(?:\s*,\s*accept)?$/i.test(asked.trim())){
     deny(res,403,origin);return;
    }
    headers(res,origin);
    res.setHeader("Access-Control-Allow-Methods","GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Authorization, Accept");
    res.setHeader("Access-Control-Max-Age","300");
    res.status(204).send("");
    return;
   }
   if(req.method!=="GET"){deny(res,405,origin);return;}
   const scopeValues=path.searchParams.getAll("scope");
   if(scopeValues.length>1||scopeValues.some(x=>!["joint","own","partner"].includes(x))){
    deny(res,400,origin);return;
   }
   const requestedScope=scopeValues[0]??"joint";
   if(req.headers?.["content-length"]!==undefined&&
      (!/^(?:0+)$/.test(String(req.headers["content-length"])))){
    deny(res,400,origin);return;
   }
   const token=req.headers?.authorization;
   if(typeof token!=="string"||!TOKEN.test(token)){
    deny(res,401,origin);return;
   }
   if(!pending){
    const attempt=Promise.resolve().then(()=>loadHandler())
     .then(fn=>{if(typeof fn!=="function")fail();return fn;})
     .catch(error=>{if(pending===attempt)pending=null;throw error;});
    pending=attempt;
   }
   const handler=await pending;
   // Never forward a user-controlled Host or X-Forwarded-* header.
   const request=new Request(path.href,{
    method:"GET",
    headers:{"Authorization":token,...origin?{"Origin":origin}:{}}
   });
   const response=await handler(request);
   if(!response||typeof response.text!=="function"||
      !Number.isSafeInteger(response.status))fail();
   if(![200,400,401,403,404,405,503].includes(response.status))fail();
   const body=await response.text();
   if(typeof body!=="string"||body.length>900000)fail();
   const data=JSON.parse(body);
   if(response.status===200){
    if(!data||data.schema!=="nico-verified-dual-count-v1"||
       !["hub_owner","partner_owner"].includes(data.role)||
       (own(data,"scope")?data.scope!==requestedScope:scopeValues.length>0)||
       !moneyFree(data)||
       (data.role==="partner_owner"&&!partnerPublicScopeSafe(data))||
       (data.role==="hub_owner"&&!hubPublicScopeSafe(data)))fail();
   }else if(!data||typeof data!=="object"||Array.isArray(data)||
            Object.keys(data).length!==1||
            !["request_blocked","service_disabled"].includes(data.error))fail();
   headers(res,origin);
   res.status(response.status).send(JSON.stringify(data));
  }catch{
   // Fail closed, never forward exceptions, raw records, headers or tokens.
   deny(res,503,origin);
  }
 };
}
module.exports={createJointCountHttpAdapter};
