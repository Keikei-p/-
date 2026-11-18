/**
 * Staging only / NOT DEPLOYED. Server-side resource-level authorization for
 * the SAME application partner count dashboard.
 *
 * The legacy getPartnerWorkspace count-entry payload is intentionally NOT
 * modified. Rank/detail tabs must be served via this narrowly shaped
 * projection after an authenticated, same-transaction Owner policy read.
 */
import {auditNoFinancialKeys} from "../security/public-projection.mjs";
const SCHEMA="nico-partner-tabs-v1";
const OUTPUT="nico-published-partner-count-tab-v1";
const TAB_IDS=Object.freeze(["product","team","individual","detail",
 "report","daily","history","goal"]);
const COUNT_TABS=new Set(["product","team","individual","detail"]);
const safeId=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const safeCount=x=>Number.isSafeInteger(x)&&x>=0;
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const denied=()=>{throw Error("PARTNER_PUBLISHED_TAB_ACCESS_DENIED");};
const MONEY_LABEL=/(?:売上|単価|収益|原価|価格|報酬|利益|キャッシュバック|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|salary|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
function inspectMoneyText(value,depth=0){
 if(depth>32)denied();
 if(typeof value==="string"){
  if(MONEY_LABEL.test(value.normalize("NFKC")))denied();
  return;
 }
 if(Array.isArray(value)){if(value.length>10000)denied();
  value.forEach(x=>inspectMoneyText(x,depth+1));return;}
 if(plain(value)){
  const keys=Object.keys(value);if(keys.length>10000)denied();
  keys.forEach(k=>inspectMoneyText(value[k],depth+1));
 }
}
const TIME=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
function verifiedContext(context){
 if(!plain(context)||context.serverVerified!==true||
    context.role!=="partner_owner"||!safeId(context.viewerUid)||
    !safeId(context.viewerCompanyId)||!safeId(context.hubCompanyId)||
    context.viewerCompanyId===context.hubCompanyId||
    context.activeCountSharingVerified!==true)denied();
}
function checkedTabs(raw){
 if(!Array.isArray(raw)||raw.length>TAB_IDS.length||
    raw.some(x=>!TAB_IDS.includes(x))||
    new Set(raw).size!==raw.length)denied();
 return TAB_IDS.filter(x=>raw.includes(x));
}
/**
 * MUST be called with the SAME READ-ONLY transaction as canonical counts.
 * No browser role/company identifier and no second/delayed policy read.
 * Owner verified against active company row; inactive/forged policy refuses.
 */
export function createPartnerPublishedTabPolicyReader({db}={}){
 if(!db||typeof db.collection!=="function")denied();
 return async function readPublished({tx,context}={}){
  verifiedContext(context);
  if(!tx||typeof tx.get!=="function")denied();
  const hubRef=db.collection("companies").doc(context.hubCompanyId);
  const policyRef=hubRef.collection("partnerTabPublication").doc("shared");
  const [hubSnap,configSnap]=await Promise.all([
   tx.get(hubRef),tx.get(policyRef)
  ]);
  if(hubSnap?.exists!==true||typeof hubSnap.data!=="function")denied();
  const hub=hubSnap.data();
  if(!plain(hub)||hub.active===false||!safeId(hub.ownerUid)||
     ![undefined,null,"internal","direct"].includes(hub.companyKind))denied();
  const t=hubSnap.readTime;
  if(!t||!Number.isSafeInteger(t.seconds)||
     !Number.isSafeInteger(t.nanoseconds)||
     typeof t.toDate!=="function")denied();
  const time=t.toDate()?.toISOString?.();
  if(typeof time!=="string"||!TIME.test(time))denied();
  if(configSnap?.exists===true&&
     (configSnap.readTime?.seconds!==t.seconds||
      configSnap.readTime?.nanoseconds!==t.nanoseconds))denied();
  const value=configSnap?.exists===true&&typeof configSnap.data==="function"?
   configSnap.data():null;
  if(value!==null&&(!plain(value)||value.schema!==SCHEMA||
      value.hubCompanyId!==context.hubCompanyId||
      value.ownerUid!==hub.ownerUid||
      !Number.isSafeInteger(value.version)||value.version<1||
      value.version>999999||typeof value.published!=="boolean"))denied();
  const selected=value===null?[]:checkedTabs(value.tabs);
  return Object.freeze({
   serverVerified:true,ownerUidVerified:true,
   hubCompanyId:context.hubCompanyId,
   viewerCompanyId:context.viewerCompanyId,
   snapshotReadTime:time,
   revision:value?.version??0,published:value?.published===true,
   tabs:Object.freeze(value?.published===true?selected:[])
  });
 };
}
/**
 * Only the requested authorized tab is returned. A normal response never
 * carries the other seven tab bodies (including another company's roster).
 * Report/daily/history/goal will require their OWN separately protected
 * data sources. They intentionally cannot be served by the ranking endpoint.
 */
export function projectPublishedPartnerCountTab({
 verifiedContext:context,policy,requestedTab,response
}={}){
 verifiedContext(context);
 if(!COUNT_TABS.has(requestedTab)||!plain(policy)||
    policy.serverVerified!==true||policy.ownerUidVerified!==true||
    policy.hubCompanyId!==context.hubCompanyId||
    policy.viewerCompanyId!==context.viewerCompanyId||
    typeof policy.snapshotReadTime!=="string"||
    policy.published!==true||!Array.isArray(policy.tabs)||
    !policy.tabs.includes(requestedTab)||
    checkedTabs(policy.tabs).length!==policy.tabs.length)denied();
 if(!plain(response)||response.schema!=="nico-verified-dual-count-v1"||
    response.role!=="partner_owner"||response.unit!=="件"||
    response.readTime!==policy.snapshotReadTime||
    !plain(response.own)||!plain(response.publicRanking)||
    typeof response.own.company!=="string"||
    !safeCount(response.own.count))denied();
 // Check the complete canonical payload BEFORE discarding unused data.
 try{auditNoFinancialKeys(response);}catch{denied();}
 inspectMoneyText(response);
 const publicRows=response.publicRanking;
 let rows;
 if(requestedTab==="product")rows=publicRows.products;
 else if(requestedTab==="team")rows=publicRows.teams;
 else if(requestedTab==="individual")rows=publicRows.members;
 else rows=response.own.teamDetails;
 if(!Array.isArray(rows)||rows.length>10000)denied();
 // Shallow-copy + deep serialization of the already verified count-only
 // builder, so a later mutation of canonical input cannot leak into output.
 const output=JSON.parse(JSON.stringify({
  schema:OUTPUT,role:"partner_owner",tab:requestedTab,
  period:response.period,range:response.range,unit:"件",
  readTime:response.readTime,rows
 }));
 if(Object.keys(output).sort().join("|")!==
    "period|range|readTime|role|rows|schema|tab|unit"||
    output.rows.some(row=>!plain(row)||!safeCount(row.count)))denied();
 try{auditNoFinancialKeys(output);}catch{denied();}
 inspectMoneyText(output);
 return Object.freeze(output);
}
