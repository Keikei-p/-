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
 "schema","role","unit","period","range","readTime","start","end",
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
const rankRows=(rows,keys)=>Array.isArray(rows)&&rows.length<=10000&&
 rows.every(row=>exact(row,keys)&&
  Number.isSafeInteger(row.rank)&&row.rank>0&&
  Number.isSafeInteger(row.count)&&row.count>=0&&
  keys.filter(k=>["name","company"].includes(k)).every(k=>
   typeof row[k]==="string"&&row[k].trim().length>0));
// The shared allowlist covers both roles. Enforce the exact role envelope too:
// otherwise a partner response could smuggle hub-only aggregate fields that
// happen to be individually allowlisted (for example partner/total/people).
const HUB_ENVELOPE=["schema","role","unit","period","range","readTime",
 "summary","memberRanking","productRanking","companyBreakdown","teamBreakdown","filters"];
const PARTNER_ENVELOPE=["schema","role","unit","period","range","readTime",
 "own","publicRanking"];
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
 if(!exact(data,PARTNER_ENVELOPE)||!partnerOwnScopeSafe(data.own))return false;
 const p=data.publicRanking;
 if(!p||typeof p!=="object"||Array.isArray(p)||
    !own(p,"members")||!own(p,"products")||
    Object.keys(p).some(k=>!["members","products","companies","teams"].includes(k)))
  return false;
 return rankRows(p.members,["rank","company","name","count"])&&
  rankRows(p.products,["rank","name","count"])&&
  (!own(p,"companies")||rankRows(p.companies,["rank","name","count"]))&&
  (!own(p,"teams")||rankRows(p.teams,["rank","name","company","count"]));
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
       !moneyFree(data)||
       (data.role==="partner_owner"&&!partnerPublicScopeSafe(data))||
       (data.role==="hub_owner"&&!exact(data,HUB_ENVELOPE)))fail();
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
