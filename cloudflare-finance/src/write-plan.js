/**
 * Safely build future server-side record writes from COUNT-ONLY client input.
 * Deliberately pure: never talks to Firestore or mutates any saved record.
 * The actual write endpoint is not available until transaction and UI tests pass.
 */
export class ValidationError extends Error {
  constructor(message){super(message);this.name="ValidationError";}
}
function validId(value){
  return typeof value==="string" && /^[a-zA-Z0-9_-]{1,150}$/.test(value);
}
function validDate(value){
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const dt=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0,10)===value;
}
function stripValue(x){
  return String(x||"").replace(/[０-９]/g,n=>String(n.charCodeAt(0)-65296)).replace(/[，]/g,",");
}
function legacyPricingName(name){
  const original=String(name||"").trim();
  const m=original.match(/^(.*?)[\s　]*(?:CB|ＣＢ)[\s　]*([0-9０-９,，]+)[\s　]*(万円|万|円)?[\s　]*$/i);
  if(!m)return null;
  const cashback=Number(stripValue(m[2]).replace(/,/g,"")) * (m[3]==="万"||m[3]==="万円"?10000:1);
  if(!Number.isSafeInteger(cashback)||cashback<0)throw new ValidationError("Invalid legacy cashback");
  return {cashback,revenuePerUnit:null};
}
export function securePricing(product){
  if(!product || !validId(product.id))throw new ValidationError("Unknown product");
  const explicit=Array.isArray(product.pricingOptions)&&product.pricingOptions.length?
    product.pricingOptions.slice(0,15).map(o=>({cashback:Number(o.cashback||0),revenuePerUnit:Number(o.revenuePerUnit)}))
      .sort((a,b)=>a.cashback-b.cashback) : null;
  const fromLegacy=legacyPricingName(product.name);
  const raw=explicit??(fromLegacy?[{cashback:fromLegacy.cashback,revenuePerUnit:Number(product.revenue)}]:
    [{cashback:0,revenuePerUnit:Number(product.revenue)}]);
  const seen=new Set();
  return raw.map((x,i)=>{
    if(!Number.isSafeInteger(x.cashback)||x.cashback<0||!Number.isSafeInteger(x.revenuePerUnit)||x.revenuePerUnit<0 ||
      x.revenuePerUnit>999999999 || seen.has(x.cashback)){
      throw new ValidationError("Invalid product pricing. Requires manual review.");
    }
    seen.add(x.cashback);
    return {planId:"plan_"+i,cashback:x.cashback,revenuePerUnit:x.revenuePerUnit};
  });
}
export function validateCountIntent(input,policy){
  if(!input || typeof input!=="object" || Array.isArray(input))throw new ValidationError("Missing input");
  const whitelist=new Set(["uid","date","teamId","workLocation","entries","reportStatus","expectedRecordUpdateTime","recordId"]);
  if(Object.keys(input).some(k=>!whitelist.has(k)))throw new ValidationError("Unexpected fields (no monetary data may be supplied)");
  if(!validId(input.uid)||!validId(input.teamId)||!validDate(input.date))throw new ValidationError("Invalid person/team/date");
  if(typeof input.workLocation!=="string"||input.workLocation.length>150)throw new ValidationError("Invalid work location");
  if(input.reportStatus!=="submitted" && input.reportStatus!=="no_result")throw new ValidationError("Invalid report status");
  if(!Array.isArray(input.entries)||input.entries.length>80)throw new ValidationError("Invalid entries");
  if(input.entries.some(x=>!x||Object.keys(x).some(k=>!["productId","planId","count"].includes(k))||
    !validId(x.productId)||!/^plan_(0|[1-9]\d{0,2})$/.test(x.planId)||!Number.isSafeInteger(x.count)||x.count<0||x.count>9999)){
    throw new ValidationError("Invalid count-only entries");
  }
  const duplicates=new Set();
  for(const x of input.entries){
    const key=x.productId+"/"+x.planId;
    if(duplicates.has(key))throw new ValidationError("Duplicate product plan");
    duplicates.add(key);
  }
  if(input.recordId!=null&&!validId(input.recordId))throw new ValidationError("Invalid record ID");
  if(input.expectedRecordUpdateTime!=null&&(typeof input.expectedRecordUpdateTime!=="string"||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(input.expectedRecordUpdateTime))){
    throw new ValidationError("Invalid expected record version");
  }
  if(!policy || !policy.uid || !policy.companyId || !policy.teamId && !policy.isOwner){
    throw new ValidationError("Invalid caller context");
  }
  if(!policy.isOwner && (
      input.teamId!==policy.teamId ||
      (policy.role==="leader" ? false : input.uid!==policy.uid)
    ))throw new ValidationError("Team/identity not authorized");
  const newRecordId=policy.companyId+"_"+input.uid+"_"+input.date;
  if(input.recordId && input.recordId!==newRecordId && !input.expectedRecordUpdateTime){
    throw new ValidationError("Legacy record edit must include expected version");
  }
  return { ...input, reportStatus:input.reportStatus,recordId:input.recordId||newRecordId};
}
export function buildRecordFromCounts(intent,policy,products,targetMember,existing=null,nowISO="2026-10-22T00:00:00.000Z"){
  const data=validateCountIntent(intent,policy);
  if(!targetMember || targetMember.uid!==data.uid||targetMember.active===false||
    targetMember.companyId && targetMember.companyId!==policy.companyId)throw new ValidationError("Target member is not active in company");
  if(existing && (existing.companyId!==policy.companyId||existing.uid!==data.uid||existing.date!==data.date)){
    throw new ValidationError("Existing record identity cannot change");
  }
  if(!existing && data.expectedRecordUpdateTime)throw new ValidationError("Stale edit: record missing");
  if(existing && (!data.expectedRecordUpdateTime || data.expectedRecordUpdateTime!==existing.updatedAt)){
    throw new ValidationError("Stale edit: record has changed");
  }
  if(!Number.isFinite(Date.parse(nowISO)))throw new ValidationError("Invalid server clock");
  const byId=new Map(products.map(p=>[p.id,p]));
  const results={};
  let totalCount=0,totalRevenue=0;
  for(const entry of data.entries){
    const product=byId.get(entry.productId);
    if(!product || product.active===false || product.companyId!==policy.companyId){
      throw new ValidationError("Invalid or inactive product");
    }
    const selected=securePricing(product).find(plan=>plan.planId===entry.planId);
    if(!selected)throw new ValidationError("Unknown plan ID");
    const key=entry.productId+"__cb_"+selected.cashback;
    if(Object.hasOwn(results,key))throw new ValidationError("Duplicate result key");
    results[key]={productId:product.id,productName:product.name,
      cashback:selected.cashback,count:entry.count,revenuePerUnit:selected.revenuePerUnit};
    totalCount+=entry.count;
    totalRevenue+=entry.count*selected.revenuePerUnit;
  }
  if(!Number.isSafeInteger(totalCount)||!Number.isSafeInteger(totalRevenue))throw new ValidationError("Unsafe financial sum");
  if(data.reportStatus==="no_result" && totalCount!==0)throw new ValidationError("No-result report has positive counts");
  const output={companyId:policy.companyId,uid:data.uid,date:data.date,teamId:data.teamId,
    teamNameSnapshot:"",memberNameSnapshot:targetMember.name||"名前未設定",
    workLocation:data.workLocation,results,totalCount,totalRevenue,reportStatus:data.reportStatus,
    updatedByUid:policy.uid,updatedAt:nowISO,reportedAt:nowISO};
  if(existing){
    output.createdAt=existing.createdAt;
    output.createdByUid=existing.createdByUid;
    output.teamNameSnapshot=existing.teamId===data.teamId?existing.teamNameSnapshot:"";
  }else{
    output.createdAt=nowISO;
    output.createdByUid=policy.uid;
  }
  return {recordId:data.recordId,document:output,requiresTeamName:true};
}
