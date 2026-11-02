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
 return name&&name.length<=80&&!money.test(name)?name:defaultValue;
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
async function readDirectDayCounts(db,hubId,date,keys,{maxRecords=MAX_DIRECT_RECORDS_PER_DAY}={}){
 if(!safeIdentifier(hubId)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||
    !Array.isArray(keys)||!keys.length||maxRecords<1||maxRecords>MAX_DIRECT_RECORDS_PER_DAY)
  throw Error("DIRECT_SCOPE_INVALID");
 // Use existing company/date composite query. One bounded read, no writes.
 const [snap,catalog]=await Promise.all([
  db.collection("records").where("companyId","==",hubId)
   .where("date","==",date).limit(maxRecords+1).get(),
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
 let totalCount=0,otherCount=0;
 for(const doc of snap.docs){
  const row=doc.data()||{};
  if(row.companyId!==hubId||row.date!==date)throw Error("DIRECT_SCOPE_MISMATCH");
  const results=readCountRows(row);
  let n=0;
  const daily=Object.fromEntries(keys.map(k=>[k,0]));
  for(const result of results){
   const number=Number(result?.count??0);
   if(!Number.isSafeInteger(number)||number<0||number>9999)
    throw Error("DIRECT_INVALID_QUANTITY");
   const productName=result.productNameSnapshot||result.productName||
    productNames.get(result.productId)||row.productNameSnapshot||"";
   const label=mapCategory(productName,keys);
   if(label===OTHER)otherCount+=number;else{daily[label]+=number;counts[label]+=number;}
   n+=number;
  }
  if(!Number.isSafeInteger(n)||n<0||
     (row.totalCount!=null&&(!Number.isSafeInteger(row.totalCount)||row.totalCount!==n)))
   throw Error("DIRECT_TOTAL_MISMATCH");
  totalCount+=n;
  const personId=safeIdentifier(row.uid)?row.uid:"record_"+doc.id;
  if(!safeIdentifier(personId))throw Error("DIRECT_PERSON_UNVERIFIED");
  const name=safeName(row.memberNameSnapshot,"担当者未確認");
  const teamId=safeIdentifier(row.teamId)?row.teamId:"unknown";
  const teamName=safeName(row.teamNameSnapshot,"当時の班未確認");
  const personKey=redactedKey("person",hubId,personId);
  const teamKey=redactedKey("team",hubId,teamId);
  let person=people.get(personKey);
  if(!person){person={key:personKey,name,teamKey,totalCount:0,
    counts:Object.fromEntries(keys.map(k=>[k,0]))};people.set(personKey,person);}
  if(person.teamKey!==teamKey)person.teamKey=null; // cross-team entries are not re-attributed
  person.totalCount+=n;
  for(const key of keys)person.counts[key]+=daily[key];
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
  recordsVerified:snap.size};
}
module.exports={readDirectDayCounts,MAX_DIRECT_RECORDS_PER_DAY};
