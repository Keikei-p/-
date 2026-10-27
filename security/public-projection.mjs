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
function id(value){const s=text(value,200);if(!s)throw Error("Missing required ID");return s;}
function date(value){const s=text(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error("Invalid date");return s;}
function safeResult(productId,r){
 if(!r||typeof r!=="object")throw Error("Invalid result");
 return {
  productId:id(r.productId||productId),
  productName:text(r.productName||r.productNameSnapshot,80),
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
 if(record.totalCount!=null&&Number(record.totalCount)!==totalCount)throw Error("Saved total count mismatch");
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
  name:text(product.name,80),active:product.active!==false,
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
  before:{teamId:text(before.teamId,200),totalCount:count(before.totalCount||0)},
  after:{teamId:text(after.teamId,200),totalCount:count(after.totalCount||0)}
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
 const company=id(companyId),dateMonth=text(period,7),category=text(kind,30);
 if(!/^\d{4}-\d{2}$/.test(dateMonth))throw Error("Invalid month");
 if(!["member","team","product"].includes(category))throw Error("Invalid ranking type");
 if(!Array.isArray(participants)||participants.length>2000)throw Error("Invalid ranking source");
 const seen=new Set();
 const sorted=participants.map(p=>{
  const key=id(p.id),name=text(p.name,80),score=Number(p.score);
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
 auditNoFinancialKeys(published);return published;
}
