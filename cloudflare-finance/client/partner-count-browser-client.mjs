/**
 * Browser-only, COUNT-ONLY partner report bridge for the canonical NICO host.
 * No Firestore SDK, price fields, raw financial reads, localStorage, deletes,
 * or automatic correction after ambiguous network acknowledgements.
 *
 * Not enabled by merely importing this module. A separately reviewed UI
 * must explicitly configure the approved HTTPS gateway and enabled=true.
 */
const CANONICAL="https://nico-factory.web.app";
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const RETRY=/^[A-Za-z0-9_-]{16,96}$/;
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const deny=()=>{throw Error("partner_count_client_blocked");};
const MONEY=/(?:[¥￥$€]|(?:\d|[０-９])[\d０-９,.，]*\s*(?:万|千)?円|(?:\d|[０-９])[\d０-９,.，]*\s*万(?:\D|$)|(?:CB|cashback|revenue|unitprice|単価|売上|報酬|利益)[\s:_=-]*(?:\d|[０-９]))/i;
const exact=(value,keys)=>{
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join(",")!==[...keys].sort().join(","))deny();
};
const isValidDay=value=>{
 if(typeof value!=="string"||!DATE.test(value))return false;
 const d=new Date(value+"T00:00:00.000Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
};
function normalizeReport(report){
 exact(report,["date","teamId","status","lines"]);
 if(!isValidDay(report.date)||!ID.test(report.teamId)||
    !["submitted","no_result"].includes(report.status)||
    !Array.isArray(report.lines)||report.lines.length>50)deny();
 const seen=new Set();let total=0;
 const lines=report.lines.map(row=>{
  exact(row,["catalogId","count"]);
  if(typeof row.catalogId!=="string"||!ID.test(row.catalogId)||
     seen.has(row.catalogId)||!Number.isSafeInteger(row.count)||
     row.count<1||row.count>1000000)deny();
  seen.add(row.catalogId);total+=row.count;
  if(!Number.isSafeInteger(total))deny();
  return {catalogId:row.catalogId,count:row.count};
 });
 if((report.status==="no_result")!==(!lines.length))deny();
 return {date:report.date,teamId:report.teamId,status:report.status,lines};
}
function checkedDay(value,date,teamId){
 if(!value||typeof value!=="object"||Array.isArray(value)||
    typeof value.found!=="boolean"||
    value.date!==date||value.teamId!==teamId)deny();
 if(!value.found){
  exact(value,["found","date","teamId"]);
  return value;
 }
 exact(value,["found","date","teamId","recordId","version",
   "status","ownCount","sharedCount","lines"]);
 if(!ID.test(value.recordId)||!Number.isSafeInteger(value.version)||
    value.version<1||!Number.isSafeInteger(value.ownCount)||
    !Number.isSafeInteger(value.sharedCount)||value.ownCount<0||
    value.sharedCount<0||value.sharedCount>value.ownCount)deny();
 normalizeReport({date,teamId,status:value.status,lines:value.lines});
 const count=value.lines.reduce((n,row)=>n+row.count,0);
 if(count!==value.ownCount)deny();
 return value;
}
function matches(current,report){
 if(!current.found||current.status!==report.status||
    current.lines.length!==report.lines.length)return false;
 const a=new Map(current.lines.map(x=>[x.catalogId,x.count]));
 return report.lines.every(x=>a.get(x.catalogId)===x.count);
}
function savedReply(data,current){
 if(!data||typeof data!=="object"||Array.isArray(data)||
    data.saved!==true||!["registered","corrected","already_registered"].includes(data.status)||
    !ID.test(data.recordId)||!Number.isSafeInteger(data.version)||
    data.version<1||data.recordId!==current.recordId||
    data.version!==current.version)deny();
 if(data.ownCount!==undefined){
  if(!Number.isSafeInteger(data.ownCount)||data.ownCount!==current.ownCount||
     !Number.isSafeInteger(data.sharedCount)||data.sharedCount!==current.sharedCount)deny();
 }
 return data;
}
export function createPartnerCountBrowserClient({
 enabled=false,origin,gatewayBase,getIdToken,fetcher=fetch,
 mintRetryKey=()=>globalThis.crypto.randomUUID().replaceAll("-","")
}={}){
 if(enabled!==true)deny();
 if(origin!==CANONICAL||typeof gatewayBase!=="string"||
    typeof getIdToken!=="function"||typeof fetcher!=="function"||
    typeof mintRetryKey!=="function")deny();
 let url;
 try{url=new URL(gatewayBase);}
 catch{deny();}
 if(url.protocol!=="https:"||url.username||url.password||
    url.search||url.hash||url.pathname!=="/"||url.hostname==="")deny();
 const base=url.origin;
 // Keep a retry key through an ambiguous POST outcome. Never change it
 // for an identical retry until an authoritative GET confirms the save.
 const pending=new Map();
 async function send(path,method,body){
  const token=await getIdToken();
  if(typeof token!=="string"||token.length<20||token.length>12000)deny();
  const response=await fetcher(base+path,{
   method,headers:{Authorization:"Bearer "+token,
    ...(body?{"Content-Type":"application/json"}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),
   cache:"no-store",credentials:"omit",redirect:"error"
  });
  if(!response?.ok)throw Error("partner_count_request_unconfirmed");
  const content=await response.json();
  if(!content||typeof content!=="object"||Array.isArray(content))deny();
  return content;
 }
 async function readCatalog(){
  const payload=await send("/v1/partner-count-catalog","GET");
  exact(payload,["teams","products"]);
  if(!Array.isArray(payload.teams)||payload.teams.length>100||
     !Array.isArray(payload.products)||payload.products.length>100)deny();
  const teamIds=new Set(),productIds=new Set();
  const teams=payload.teams.map(team=>{
   exact(team,["teamId","name"]);
   if(!ID.test(team.teamId)||teamIds.has(team.teamId)||
      typeof team.name!=="string"||!team.name.trim()||
      team.name.length>80||MONEY.test(team.name))deny();
   teamIds.add(team.teamId);
   return Object.freeze({teamId:team.teamId,name:team.name});
  });
  const products=payload.products.map(product=>{
   exact(product,["catalogId","name","visibility"]);
   if(!ID.test(product.catalogId)||productIds.has(product.catalogId)||
      !["shared_counts","private"].includes(product.visibility)||
      typeof product.name!=="string"||!product.name.trim()||
      product.name.length>80||
      MONEY.test(product.name))deny();
   productIds.add(product.catalogId);
   return Object.freeze({
    catalogId:product.catalogId,name:product.name,
    visibility:product.visibility
   });
  });
  return Object.freeze({
   teams:Object.freeze(teams),products:Object.freeze(products)
  });
 }
 async function readDay({date,teamId}={}){
  if(!isValidDay(date)||typeof teamId!=="string"||!ID.test(teamId))deny();
  const q=new URLSearchParams({date,teamId});
  return checkedDay(await send("/v1/partner-own-day?"+q,"GET"),date,teamId);
 }
 async function saveDay(report){
  const clean=normalizeReport(report);
  const key=clean.date+":"+clean.teamId;
  const payload=JSON.stringify(clean);
  const previous=pending.get(key);
  if(previous&&previous.payload!==payload)
   throw Error("partner_count_uncertain_prior_save_refresh_required");
  // No POST before current state has been freshly read from the server.
  const current=await readDay(clean);
  if(matches(current,clean)){
   pending.delete(key);
   return {confirmed:true,alreadyCurrent:true,recordId:current.recordId,
    version:current.version,ownCount:current.ownCount,
    sharedCount:current.sharedCount};
  }
  let cmd;
  if(current.found){
   // A prior uncertain write may have been superseded on another device.
   // Never silently overwrite it as a new correction.
   if(previous)throw Error("partner_count_uncertain_prior_save_refresh_required");
   cmd={action:"correct",request:clean,
    recordId:current.recordId,expectedVersion:current.version};
   pending.set(key,{kind:"correct",payload});
  }else{
   if(previous?.kind==="correct")
    throw Error("partner_count_uncertain_prior_save_refresh_required");
   let retryKey=previous?.retryKey;
   if(!retryKey){
    retryKey=mintRetryKey();
    if(typeof retryKey!=="string"||!RETRY.test(retryKey))deny();
    pending.set(key,{kind:"create",payload,retryKey});
   }
   cmd={action:"create",request:clean,retryKey};
  }
  // After a network failure retain pending, and never claim success.
  const result=await send("/v1/partner-counts","POST",cmd);
  const check=await readDay(clean);
  if(!matches(check,clean))throw Error("partner_count_ack_not_reconciled");
  savedReply(result,check);
  pending.delete(key);
  return {confirmed:true,alreadyCurrent:false,recordId:check.recordId,
   version:check.version,ownCount:check.ownCount,
   sharedCount:check.sharedCount};
 }
 return Object.freeze({readDay,saveDay,readCatalog});
}
