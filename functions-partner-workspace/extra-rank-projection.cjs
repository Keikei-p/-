"use strict";
// Count-only read projection for the separate, immutable-audit additional ledger.
// No price/revenue fields, Firebase writes, original nine buckets or user emails.
const {normalizeExtraCounts}=require("./additional-counts.cjs");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const NAME=/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u;
const MONEY=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const fail=()=>{throw Error("PARTNER_EXTRA_RANK_UNVERIFIED");};
function projectExtraRankDocs(docs,{hubId,cid,date,publishedIds=[],linkedIds=[]}={}){
 if(!Array.isArray(docs)||docs.length>200||!ID.test(hubId||"")||
   !ID.test(cid||"")||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||
   !Array.isArray(publishedIds)||!Array.isArray(linkedIds)||
   publishedIds.some(id=>!ID.test(id))||linkedIds.some(id=>!ID.test(id))||
   new Set(publishedIds).size!==publishedIds.length||
   new Set(linkedIds).size!==linkedIds.length)fail();
 const visible=new Set(publishedIds),blocked=new Set(linkedIds),seen=new Set(),rows=[];
 for(const doc of docs){
  const row=doc?.data?.()||{},id=row.staffId;
  if(!ID.test(id||"")||seen.has(id)||doc.id!==date+"__"+id||
    row.companyId!==cid||row.hubCompanyId!==hubId||row.date!==date||
    !Number.isSafeInteger(row.version)||row.version<1||
    !Number.isSafeInteger(row.totalCount)||row.totalCount<0||
    !ID.test(row.teamIdSnapshot||"")||
    typeof row.staffNameSnapshot!=="string"||!NAME.test(row.staffNameSnapshot)||
    MONEY.test(row.staffNameSnapshot))fail();
  seen.add(id);
  let normalized;
  try{normalized=normalizeExtraCounts(row.counts);}
  catch{fail();}
  if(normalized.total!==row.totalCount)fail();
  const publicCounts={},archivedCount=Object.entries(normalized.counts)
   .reduce((total,[productId,quantity])=>{
    // A product linked to one original category cannot also have extra
    // quantities. This is a fatal double-counting inconsistency.
    if(blocked.has(productId)&&quantity>0)fail();
    if(visible.has(productId)&&!blocked.has(productId))
     publicCounts[productId]=quantity;
    else total+=quantity;
    return total;
   },0);
  rows.push({staffId:id,staffNameSnapshot:row.staffNameSnapshot,
   teamIdSnapshot:row.teamIdSnapshot,totalCount:row.totalCount,
   extraCounts:publicCounts,archivedCount});
 }
 return rows;
}
module.exports={projectExtraRankDocs};
