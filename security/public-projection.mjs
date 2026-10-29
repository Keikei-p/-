/**
 * Pure count-only projections for a staged finance/private-data split.
 * NEVER copy a Firestore source object into these outputs via ...spread.
 * This module does not read, write or delete production data.
 */
const MAX_RESULT_ROWS=200;
function text(value,max=120){return typeof value==="string"?value.slice(0,max):"";}
function count(value){
 const n=Number(value);
 if(value==null||value===""||!Number.isSafeInteger(n)||n<0||n>1000000)throw Error("Invalid count");
 return n;
}
function safeProductName(value){
 const original=text(value,80);
 // Legacy product labels can embed financial tiers (CB or Yen amounts).
 // Fail closed instead of trying to guess and inadvertently exposing a tier.
 return /(?:CB|キャッシュバック|単価|売上|[¥￥]|[0-9０-９]+\s*(?:万|千)?円)/i.test(original)
  ? "商材名はオーナー確認中" : original;
}
function id(value){
 // Silent truncation can collapse two original IDs into one public record.
 if(typeof value!=="string"||value.length<1||value.length>200)
   throw Error("Missing or oversized required ID");
 return value;
}
function date(value){
 if(typeof value!=="string"||!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value))
   throw Error("Invalid date");
 const [year,month,day]=value.split("-").map(Number);
 const d=new Date(0);d.setUTCHours(0,0,0,0);d.setUTCFullYear(year,month-1,day);
 if(d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||
    d.getUTCDate()!==day)throw Error("Invalid date");
 return value;
}
function safeResult(productId,r){
 if(!r||typeof r!=="object")throw Error("Invalid result");
 if(r.productId!=null&&r.productId!==productId)
   throw Error("Product ID mismatch in saved result");
 return {
  productId:id(r.productId||productId),
  productName:safeProductName(r.productName||r.productNameSnapshot),
  count:count(r.count)
 };
}
export function projectCountRecord(record){
 if(!record||typeof record!=="object")throw Error("Invalid record");
 const entries=Array.isArray(record.results)
  ?record.results.map(x=>[x?.productId,x])
  :record.results&&typeof record.results==="object"
   ?Object.entries(record.results)
   :record.productId?[[record.productId,record]]:[];
 if(entries.length>MAX_RESULT_ROWS)throw Error("Too many result rows");
 const results=entries.map(([key,r])=>safeResult(key,r));
 const totalCount=results.reduce((n,r)=>n+r.count,0);
 if(!Number.isSafeInteger(totalCount))throw Error("Invalid total");
 if(record.totalCount==null||record.totalCount===""||!Number.isSafeInteger(Number(record.totalCount))||Number(record.totalCount)!==totalCount)throw Error("Saved total count missing or mismatch");
 return {
  companyId:id(record.companyId),sourceId:id(record.id),
  uid:id(record.uid),date:date(record.date),
  memberNameSnapshot:text(record.memberNameSnapshot,80),
  teamId:text(record.teamId,200),teamNameSnapshot:text(record.teamNameSnapshot,80),
  workLocation:text(record.workLocation,120),
  results,totalCount,
  reportStatus:record.reportStatus==="no_result"?"no_result":"submitted"
 };
}
export function projectPublicProduct(product){
 if(!product||typeof product!=="object")throw Error("Invalid product");
 return {
  companyId:id(product.companyId),sourceId:id(product.id),
  name:safePublicLabel(product.name),active:product.active!==false,
  sortOrder:Number.isSafeInteger(Number(product.sortOrder))&&Number(product.sortOrder)>=0?Number(product.sortOrder):0
 };
}
export function projectCountCorrection(correction){
 if(!correction||typeof correction!=="object")throw Error("Invalid correction");
 const before=correction.before||{},after=correction.after||{};
 return {
  companyId:id(correction.companyId),sourceId:id(correction.id),
  recordId:id(correction.recordId),
  recordDate:date(correction.recordDate),
  changedByUid:id(correction.changedByUid),
  before:{teamId:text(before.teamId,200),totalCount:count(before.totalCount)},
  after:{teamId:text(after.teamId,200),totalCount:count(after.totalCount)}
 };
}
export function auditNoFinancialKeys(output){
 const forbidden=/^(totalRevenue|revenue|revenuePerUnit|unitPrice|price|pricingOptions|cashbackOptions|cashback|amount|beforeRevenue|afterRevenue)$/i;
 const visit=(v,path)=>{
  if(v==null||typeof v!=="object")return;
  for(const [k,x] of Object.entries(v)){
   if(forbidden.test(k))throw Error("Private financial key leaked at "+path+"."+k);
   visit(x,path+"."+k);
  }
 };
 visit(output,"projection");return true;
}

/**
 * Compute a rank-only view in a trusted owner/server context.
 * Monetary scores are used for sorting in memory but NEVER serialized.
 */
export function projectRankOnly({companyId,period,kind,participants}){
 const company=id(companyId),dateMonth=period,category=kind;
 if(typeof dateMonth!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(dateMonth))throw Error("Invalid month");
 if(!["member","team","product"].includes(category))throw Error("Invalid ranking type");
 if(!Array.isArray(participants)||participants.length>100000)throw Error("Invalid ranking source");
 const seen=new Set();
 const sorted=participants.map(p=>{
  const key=id(p.id),name=safePublicLabel(p.name),score=Number(p.score);
  if(seen.has(key))throw Error("Duplicate rank ID");
  seen.add(key);
  if(p.score==null||p.score===""||!Number.isSafeInteger(score)||score<0)throw Error("Invalid rank score");
  return {id:key,name,score};
 }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const ranks=sorted.map((p,i)=>({
  id:p.id,name:p.name,rank:i===0||p.score!==sorted[i-1].score?i+1:0
 }));
 let rank=0;
 for(const p of ranks){if(p.rank!==0)rank=p.rank;else p.rank=rank;}
 const published={companyId:company,period:dateMonth,kind:category,ranks};
 auditNoFinancialKeys(published);
 for(const rank of ranks)assertNoMoneyEmbeddedInStrings(rank);
 return published;
}


/**
 * Strict, flat, Firestore-rules-verifiable public documents.
 * Records do not contain nested 'results'. Each per-product count is a
 * separate publicRecordLines document. No arbitrary maps/lists are exposed.
 * Only a trusted backend should publish these after verifying source data.
 */
const safePublicLabel=(value,max=80)=>{
 const candidate=text(value,max);
 if(/(?:売上|単価|キャッシュバック|CB|税込|税抜|報酬|[¥￥$€]|[0-9０-９]+\s*(?:万|千)?円)/i.test(candidate))return "名称は管理者確認中";
 return candidate.replace(/[\r\n\t]/g," ").trim();
};
export function projectPublicRecordHeader(record){
 const internal=projectCountRecord(record);
 const {companyId,sourceId,uid,date,teamId,totalCount,reportStatus}=internal;
 return {companyId,sourceId,uid,date,teamId,totalCount,reportStatus,
  memberNameSnapshot:safePublicLabel(internal.memberNameSnapshot),
  teamNameSnapshot:safePublicLabel(internal.teamNameSnapshot),
  workLocation:safePublicLabel(internal.workLocation,120)};
}
export function projectPublicRecordLines(record){
 const internal=projectCountRecord(record);
 return internal.results.map((r,index)=>({
  companyId:internal.companyId,recordId:internal.sourceId,
  sourceId:internal.sourceId+"__"+String(index).padStart(4,"0"),
  date:internal.date,uid:internal.uid,teamId:internal.teamId,
  productId:id(r.productId),count:r.count
 }));
}
export function projectPublicCorrectionFlat(correction){
 const projected=projectCountCorrection(correction);
 return {companyId:projected.companyId,sourceId:projected.sourceId,
  recordId:projected.recordId,recordDate:projected.recordDate,
  changedByUid:projected.changedByUid,
  beforeTeamId:projected.before.teamId,beforeTotalCount:projected.before.totalCount,
  afterTeamId:projected.after.teamId,afterTotalCount:projected.after.totalCount};
}
export function projectPublicRankEntries(params){
 const ranked=projectRankOnly(params);
 return ranked.ranks.map(item=>({
  companyId:ranked.companyId,period:ranked.period,kind:ranked.kind,
  sourceId:item.id,displayName:safePublicLabel(item.name),rank:item.rank
 }));
}
/**
 * Stored free-text and legacy IDs may themselves embed financial information
 * (e.g. a product ID "NURO_CB20000", not only the visible product label).
 * Source IDs must never be silently rewritten: that would break record links.
 * Instead stop publication and require an owner-reviewed safe ID mapping.
 */
const moneyLikeText=/(?:[¥￥$€]|(?:\d|[０-９])[\d０-９,.，]*\s*(?:万円|千円|円)|(?:\d|[０-９])[\d０-９,.，]*\s*万(?:\D|$)|(?:CB|cashback|キャッシュバック|売上|単価|報酬|利益|commission|unitprice|revenue)[\s:_=－-]*(?:\d|[０-９]))/i;
function assertNoMoneyEmbeddedInStrings(item){
  for(const value of Object.values(item)){
    if(typeof value==="string" && moneyLikeText.test(value))
      throw Error("Public document may embed monetary details in text or IDs");
  }
}

export function assertPublicSchema(collection,items){
 const fields={
  publicRecords:["companyId","sourceId","uid","date","teamId","totalCount","reportStatus","memberNameSnapshot","teamNameSnapshot","workLocation"],
  publicRecordLines:["companyId","recordId","sourceId","date","uid","teamId","productId","count"],
  publicProducts:["companyId","sourceId","name","active","sortOrder"],
  publicRecordCorrections:["companyId","sourceId","recordId","recordDate","changedByUid","beforeTeamId","beforeTotalCount","afterTeamId","afterTotalCount"],
  publicRankEntries:["companyId","period","kind","sourceId","displayName","rank"]
 };
 if(!fields[collection])throw Error("Unknown public collection: "+collection);
 for(const item of items){
  if(!item||typeof item!=="object"||Array.isArray(item))throw Error("Invalid public document");
  const actual=Object.keys(item).sort().join(",");
  const expected=[...fields[collection]].sort().join(",");
  if(actual!==expected)throw Error("Public document schema mismatch: "+collection);
  if(Object.values(item).some(value=>value!==null&&typeof value==="object"))throw Error("Nested public fields are forbidden");
  auditNoFinancialKeys(item);
  assertNoMoneyEmbeddedInStrings(item);
 }
 return true;
}
