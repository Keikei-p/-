"use strict";
// Bounded count-only projection. Partner daily ledgers are read by range, but
// never modify legacy sales, products, prices, Firestore Rules or historical data.
const crypto=require("node:crypto");
const {projectExtraRankDocs}=require("./extra-rank-projection.cjs");
const {normalizeExtraCounts}=require("./additional-counts.cjs");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const forbidden=/\b(?:revenue|price|commission)\b|(?:売上|単価|利益|原価|収益|報酬|[¥￥$€]|\d[\d,]*円)/i;
const fail=()=>{throw Error("PARTNER_MONTHLY_COUNTS_UNVERIFIED");};
const blank=keys=>Object.fromEntries(keys.map(x=>[x,0]));
const hash=x=>crypto.createHash("sha256").update(x).digest("hex");
const safe=x=>typeof x==="string"&&x.trim().length>0&&x.trim().length<=80&&!forbidden.test(x)&&!/@/.test(x);
function projectPartnerMonth({hubId,cid,companyName,from,to,legacyDocs,extraDocs,keys,
 publishedIds=[],linkedIds=[],teamNames={}}={}){
 if(!ID.test(hubId||"")||!ID.test(cid||"")||!safe(companyName)||
   !DAY.test(from||"")||!DAY.test(to||"")||from>to||
   !Array.isArray(keys)||!keys.length||new Set(keys).size!==keys.length||
   !teamNames||typeof teamNames!=="object"||Array.isArray(teamNames)||
   !Array.isArray(legacyDocs)||!Array.isArray(extraDocs)||
   legacyDocs.length>2000||extraDocs.length>2000)fail();
 const people=new Map(),teams=new Map(),seenLegacy=new Set(),legacyByDocId=new Map(),extraByDate=new Map();
 const zero=()=>blank(keys);
 const person=(staffId,name,teamId)=>{
  const key=hash(cid+"\n"+staffId),teamKey=hash(cid+"\nteam\n"+teamId);
  let p=people.get(staffId);
  if(!p){
   p={key,name,companyName,companyId:cid,teamKey,teamName:Object.hasOwn(teamNames,teamId)&&
    safe(teamNames[teamId])?teamNames[teamId].trim():"当時の班名未確認",totalCount:0,
    counts:zero(),extraCounts:{}};
   people.set(staffId,p);
  }else if(p.teamKey!==teamKey){
   p.teamKey=null; // Never reassign historic work to the current team.
   p.teamName="複数班（当時の所属班ごとに集計）";
  }
  return p;
 };
 const team=teamId=>{
  const key=hash(cid+"\nteam\n"+teamId);
  const savedName=Object.hasOwn(teamNames,teamId)&&safe(teamNames[teamId])?
   teamNames[teamId].trim():"当時の班名未確認";
  if(!teams.has(key))teams.set(key,{key,name:savedName,companyName,companyId:cid,
   totalCount:0,counts:zero(),extraTotalCount:0,extraCounts:{}});
  return teams.get(key);
 };
 const counts=zero();let totalCount=0,additionalTotalCount=0;
 for(const doc of legacyDocs){
  const x=doc?.data?.()||{},id=x.staffId,date=x.date,tid=x.teamIdSnapshot;
  if(!ID.test(id||"")||!ID.test(tid||"")||!DAY.test(date||"")||
   date<from||date>to||doc.id!==date+"__"+id||
   x.companyId!==cid||x.hubCompanyId!==hubId||
   seenLegacy.has(doc.id)||!Number.isSafeInteger(x.totalCount)||x.totalCount<0||
   !safe(x.staffNameSnapshot))fail();
  seenLegacy.add(doc.id);legacyByDocId.set(doc.id,x);
  if(!x.counts||typeof x.counts!=="object"||Array.isArray(x.counts)||
   Object.keys(x.counts).length!==keys.length)fail();
  let subtotal=0;
  for(const key of keys){
   if(!Number.isSafeInteger(x.counts[key])||x.counts[key]<0||x.counts[key]>9999)fail();
   subtotal+=x.counts[key];
  }
  if(subtotal!==x.totalCount)fail();
  // Private partner products are visible only in the partner's own
  // monthly product view. Validate their saved totals, but do not add their
  // quantities to shared HQ/partner rankings or disclose private totals.
  let privateCount;
  try{privateCount=normalizeExtraCounts(x.privateCounts??{}).total;}
  catch{fail();}
  if((x.privateTotalCount??0)!==privateCount)fail();
  const p=person(id,x.staffNameSnapshot,tid),t=team(tid);
  p.totalCount+=subtotal;t.totalCount+=subtotal;
  totalCount+=subtotal;
  for(const key of keys){
   counts[key]+=x.counts[key];p.counts[key]+=x.counts[key];
   t.counts[key]+=x.counts[key];
  }
 }
 for(const doc of extraDocs){
  const x=doc?.data?.()||{};
  if(!DAY.test(x.date||"")||x.date<from||x.date>to)fail();
  if(!extraByDate.has(x.date))extraByDate.set(x.date,[]);
  extraByDate.get(x.date).push(doc);
 }
 for(const [date,docs] of extraByDate){
  const rows=projectExtraRankDocs(docs,{hubId,cid,date,publishedIds,linkedIds});
  for(const x of rows){
   const p=person(x.staffId,x.staffNameSnapshot,x.teamIdSnapshot),
    t=team(x.teamIdSnapshot);
   const legacyDocId=date+"__"+x.staffId;
   const existing=legacyByDocId.get(legacyDocId);
   if(existing&&existing.teamIdSnapshot!==x.teamIdSnapshot)fail();
   p.totalCount+=x.totalCount;t.totalCount+=x.totalCount;
   t.extraTotalCount+=x.totalCount;
   totalCount+=x.totalCount;additionalTotalCount+=x.totalCount;
   for(const [productId,count] of Object.entries(x.extraCounts)){
    p.extraCounts[productId]=(p.extraCounts[productId]||0)+count;
    t.extraCounts[productId]=(t.extraCounts[productId]||0)+count;
   }
  }
 }
 if(!Number.isSafeInteger(totalCount)||!Number.isSafeInteger(additionalTotalCount))
  fail();
 return {id:cid,name:companyName,totalCount,additionalTotalCount,counts,
  people:[...people.values()],teams:[...teams.values()],
  verifiedEntryCount:legacyDocs.length+extraDocs.length};
}
module.exports={projectPartnerMonth};
