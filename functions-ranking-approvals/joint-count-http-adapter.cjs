"use strict";
/**
 * STAGING ONLY / NO DEPLOY.
 * Express (Firebase Functions v2 onRequest) -> validated standard Request
 * for the pre-existing authenticated count-only monthly ranking handler.
 *
 * This is an adapter, NOT a deployed Function. The only supported public
 * endpoint is a future Hosting rewrite to /v1/owner-visible-counts.
 * No Firebase credentials, data stores, finance APIs or production switches
 * are used here. The caller must inject the real, verified backend handler.
 */
const ORIGIN="https://nico-factory.web.app";
const PATH="/v1/owner-visible-counts";
const TOKEN=/^Bearer ([A-Za-z0-9._-]{20,12000})$/;
const DANGEROUS=new Set([
 "revenue","unitprice","cashback","price","amount","totalrevenue",
 "unitrevenue","commission","profit","cost","rawproducts",
 "records","lines","bankaccount","financials","payout"
]);
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
 const url=new URL(raw,ORIGIN);
 if(url.origin!==ORIGIN||url.pathname!==PATH||
    url.username||url.password)return null;
 return url;
}
function moneyFree(value,depth=0){
 if(depth>32)return false;
 if(Array.isArray(value))
  return value.length<=10000&&value.every(x=>moneyFree(x,depth+1));
 if(value===null||typeof value!=="object")return true;
 const keys=Object.keys(value);
 return keys.length<=10000&&keys.every(k=>
  !DANGEROUS.has(k.toLowerCase())&&
  !["__proto__","prototype","constructor"].includes(k)&&
  moneyFree(value[k],depth+1));
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
      Number(req.headers["content-length"])>0){
    deny(res,400,origin);return;
   }
   const token=req.headers?.authorization;
   if(typeof token!=="string"||!TOKEN.test(token)){
    deny(res,401,origin);return;
   }
   if(!pending)pending=Promise.resolve().then(()=>loadHandler());
   const handler=await pending;
   if(typeof handler!=="function")fail();
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
   if(!moneyFree(data))fail();
   headers(res,origin);
   res.status(response.status).send(JSON.stringify(data));
  }catch{
   // Fail closed, never forward exceptions, raw records, headers or tokens.
   deny(res,503,origin);
  }
 };
}
module.exports={createJointCountHttpAdapter};
