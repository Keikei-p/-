"use strict";
// Server-side redaction boundary for shared DIRECT counts. This module alone
// may read legacy sales records. It never returns original documents, prices,
// revenue, email addresses, or arbitrary product names to partner clients.
const crypto=require("node:crypto");
const MAX_DIRECT_RECORDS_PER_DAY=3000;
const OTHER="その他（直営）";
const money=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const safeName=(value,defaultValue)=>{
 const name=typeof value==="string"?value.trim():"";
 return name&&name.length<=80&&!money.test(name)&&!/@/.test(name)&&!/[\r\n\x00-\x1f]/.test(name)?name:defaultValue;
};
const cleanProductName=value=>String(value||"").normalize("NFKC").toUpperCase()
 .replace(/[\s　・、，,./／+＋_\-]/g,"");
function mapCategory(value,keys){
 const name=cleanProductName(value);
 const aliases={
  NURO:["NURO","NURO光","ニューロ","ニューロ光"],
  SBMNP:["SBMNP"],YMMNP:["YMMNP"],
  "YM純新規":["YM純新規"],
  "SB光・AIR":["SB光・AIR","SB光AIR","SB光","ソフトバンク光","ソフトバンクAIR"],
  "ウォーター":["ウォーター","ウォーターサーバー","フレシャス"],
  "つばさ・HTB":["つばさ・HTB","つばさ電気","HTBエナジー"],
  "太陽光・蓄電池AP":["太陽光・蓄電池AP"],
  "U-NEXT":["U-NEXT","UNEXT"]
 };
 for(const key of keys){
  if((aliases[key]||[key]).some(alias=>cleanProductName(alias)===name))
   return key;
 }
 return OTHER;
}
function safeIdentifier(value){return typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);}
function redactedKey(kind,hubId,id){
 return crypto.createHash("sha256").update(kind+"\n"+hubId+"\n"+id).digest("hex");
}
function readCountRows(entry){
 if(Array.isArray(entry.results))return entry.results;
 if(entry.results&&typeof entry.results==="object")
  return Object.entries(entry.results).map(([productId,r])=>({productId,...r}));
 if(entry.productId)return [{productId:entry.productId,
  productName:entry.productNameSnapshot||entry.productName,
  count:entry.count??0}];
 if(entry.results==null&&(!Number.isSafeInteger(entry.totalCount)||entry.totalCount===0))
  return [];
 throw Error("DIRECT_RECORD_SHAPE_UNVERIFIED");
}
async function readDirectRangeCounts(db,hubId,fromDate,toDate,keys,{
 maxRecords=MAX_DIRECT_RECORDS_PER_DAY,approvedExtraProductIds=[]
}={}){
 if(!safeIdentifier(hubId)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fromDate)||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(toDate)||fromDate>toDate||
    !Array.isArray(keys)||!keys.length||maxRecords<1||maxRecords>10000||
    !Array.isArray(approvedExtraProductIds)||approvedExtraProductIds.length>1000||
    approvedExtraProductIds.some(id=>!safeIdentifier(id))||
    new Set(approvedExtraProductIds).size!==approvedExtraProductIds.length)
  throw Error("DIRECT_SCOPE_INVALID");
 // Use existing company/date composite query. One bounded read, no writes.
 // Month mode uses the SAME redactor, with an explicit hard cap of 10k rows.
 const query=db.collection("records").where("companyId","==",hubId);
 const bounded=fromDate===toDate?query.where("date","==",fromDate):
  query.where("date",">=",fromDate).where("date","<=",toDate);
 const [snap,catalog]=await Promise.all([
  bounded.limit(maxRecords+1).get(),
  db.collection("products").where("companyId","==",hubId).limit(301).get()
 ]);
 if(snap.size>maxRecords)throw Error("DIRECT_READ_BUDGET_EXCEEDED");
 if(catalog.size>300)throw Error("DIRECT_CATALOG_BUDGET_EXCEEDED");
 const productNames=new Map();
 for(const product of catalog.docs){
  const value=product.data()||{};
  if(value.companyId!==hubId)throw Error("DIRECT_CATALOG_SCOPE_MISMATCH");
  if(safeIdentifier(product.id))
   productNames.set(product.id,safeName(value.name,""));
 }
 const people=new Map(),teams=new Map(),counts=Object.fromEntries(keys.map(k=>[k,0]));
 const approvedExtras=new Set(approvedExtraProductIds);
 let totalCount=0,otherCount=0,unverifiedPersonRecords=0;
 for(const doc of snap.docs){
  const row=doc.data()||{};
  if(row.companyId!==hubId||typeof row.date!=="string"||
    row.date<fromDate||row.date>toDate)throw Error("DIRECT_SCOPE_MISMATCH");
  // Missing persisted totals must never be guessed from visible line items.
  // A legacy mismatch or incomplete report is not a legitimate zero-count day.
  if(!Number.isSafeInteger(row.totalCount)||row.totalCount<0)
   throw Error("DIRECT_TOTAL_UNVERIFIED");
  const results=readCountRows(row);
  let n=0;
  const daily=Object.fromEntries(keys.map(k=>[k,0]));
  const dailyExtra={},dailyExtraCategoryCounts={};
  for(const result of results){
   const raw=result?.count;
   // A missing value, blank string or boolean must not be coerced into 0/1.
   // Preserve the legacy digit-string format without inferring quantities.
   const validType=(typeof raw==="number"&&Number.isSafeInteger(raw))||
    (typeof raw==="string"&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw)));
   if(!validType)throw Error("DIRECT_INVALID_QUANTITY");
   const number=Number(raw);
   if(number<0||number>9999)
    throw Error("DIRECT_INVALID_QUANTITY");
   const productName=result.productNameSnapshot||result.productName||
    productNames.get(result.productId)||row.productNameSnapshot||"";
   const label=mapCategory(productName,keys);
   if(label===OTHER)otherCount+=number;else{daily[label]+=number;counts[label]+=number;}
   // Preserve existing classification. Extra ID counters are a second
   // redacted attribution of the SAME record, not additional sales.
   const id=result.productId;
   if(approvedExtras.has(id)){
    dailyExtra[id]=(dailyExtra[id]||0)+number;
    if(label!==OTHER){
     if(!dailyExtraCategoryCounts[id])dailyExtraCategoryCounts[id]={};
     dailyExtraCategoryCounts[id][label]=
      (dailyExtraCategoryCounts[id][label]||0)+number;
    }
   }
   n+=number;
  }
  if(!Number.isSafeInteger(n)||n<0||row.totalCount!==n)
   throw Error("DIRECT_TOTAL_MISMATCH");
  totalCount+=n;
  // A record ID is NOT a verified staff identity: never invent people in
  // a cross-company individual ranking when a legacy entry lacks a UID.
  const personId=safeIdentifier(row.uid)?row.uid:null;
  if(!personId)unverifiedPersonRecords++;
  const name=safeName(row.memberNameSnapshot,"担当者未確認");
  const teamId=safeIdentifier(row.teamId)?row.teamId:"unknown";
  const teamName=safeName(row.teamNameSnapshot,"当時の班未確認");
  const teamKey=redactedKey("team",hubId,teamId);
  if(personId){
   const personKey=redactedKey("person",hubId,personId);
   let person=people.get(personKey);
   if(!person){person={key:personKey,name,teamKey,totalCount:0,
     counts:Object.fromEntries(keys.map(k=>[k,0]))};people.set(personKey,person);}
   if(person.teamKey!==teamKey)person.teamKey=null; // cross-team entries are not re-attributed
   person.totalCount+=n;
   for(const key of keys)person.counts[key]+=daily[key];
   if(approvedExtras.size){
    person.extraCounts ||= {};
    person.extraCategoryCounts ||= {};
    for(const [id,value] of Object.entries(dailyExtra))
     person.extraCounts[id]=(person.extraCounts[id]||0)+value;
    for(const [id,categories] of Object.entries(dailyExtraCategoryCounts)){
     const source=person.extraCategoryCounts[id] ||= {};
     for(const [category,value] of Object.entries(categories))
      source[category]=(source[category]||0)+value;
    }
   }
  }
  const team=teams.get(teamKey)||{key:teamKey,name:teamName,totalCount:0,
    counts:Object.fromEntries(keys.map(k=>[k,0]))};
  team.totalCount+=n;
  for(const key of keys)team.counts[key]+=daily[key];
  teams.set(teamKey,team);
 }
 if(!Number.isSafeInteger(totalCount)||!Number.isSafeInteger(otherCount))
  throw Error("DIRECT_TOTAL_OVERFLOW");
 const sum=Object.values(counts).reduce((a,b)=>a+b,otherCount);
 if(sum!==totalCount)throw Error("DIRECT_CATEGORY_MISMATCH");
 return {companyName:"直営",totalCount,counts,otherCount,
  people:[...people.values()],teams:[...teams.values()],
  peopleVerified:unverifiedPersonRecords===0,unverifiedPersonRecords,
  recordsVerified:snap.size};
}
async function readDirectDayCounts(db,hubId,date,keys,opts={}){
 return readDirectRangeCounts(db,hubId,date,date,keys,opts);
}
module.exports={readDirectDayCounts,readDirectRangeCounts,MAX_DIRECT_RECORDS_PER_DAY};
