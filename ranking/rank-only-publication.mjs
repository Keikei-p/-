/**
 * STAGING: publish ranks and labels ONLY from a fully reconciled, trusted
 * public-count source. No Firestore/HTTP access, no original revenue records.
 * This is the sole response contract for a partner-facing combined leaderboard.
 */
import {buildCombinedCountLeaderboard} from "./combined-count-leaderboard.mjs";

const NAME=/^(?!.*(?:[￥¥$€]|(?:売上|単価|CB\s*\d|cashback\s*\d|revenue\s*\d)))/i;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const refuse=()=>{throw Error("Rank-only publication is incomplete or unauthorized");};
function publicName(x){
 if(typeof x!=="string"||x.length<1||x.length>100||!NAME.test(x)||\n    /[0-9０-９][0-9０-９,，]*\\s*件/.test(x))refuse();
 return x;
}
function rows(items,groupLabel=false){
 if(!Array.isArray(items)||items.length>10000)refuse();
 return items.map(item=>{
  if(!item||!Number.isSafeInteger(item.rank)||item.rank<1||
      typeof item.champion!=="boolean")refuse();
  const label=publicName(item.name);
  const company=publicName(item.companyLabel||"自社");
  const entry={rank:item.rank,name:label,company,champion:item.champion};
  if(groupLabel)entry.group=publicName(groupLabel);
  return Object.freeze(entry);
 });
}
export function createRankOnlyPublication(trusted){
 const computed=buildCombinedCountLeaderboard(trusted);
 if(!MONTH.test(computed.period)||!TIME.test(computed.readTime))refuse();
 const productRanking=[];
 for(const product of computed.productCountRanking){
  if(!Number.isSafeInteger(product.rank)||product.rank<1||
      typeof product.champion!=="boolean")refuse();
  productRanking.push(Object.freeze({
   rank:product.rank,name:publicName(product.name),
   champion:product.champion,
   // Product-specific individual ranks never include a score.
   members:Object.freeze(rows(product.individual||[]))
  }));
 }
 const payload={
  schema:"nico-combined-rank-only-v1",
  period:computed.period,
  readTime:computed.readTime,
  teamRanks:Object.freeze(rows(computed.teamCountRanking)),
  progressRanks:Object.freeze(rows(computed.teamProgressRanking)),
  memberRanks:Object.freeze(rows(computed.individualRankOnly)),
  productRanks:Object.freeze(productRanking)
 };
 const json=JSON.stringify(payload);
 // Both keys AND serialized values are checked. All count / monetary metrics
 // must remain server-private even for the winning person or product.
 if(/"(?:count|goalCount|score|revenue|amount|price|cashback|unitPrice|totalRevenue|progressPercent|combinedCount|unmappedProducts|companyCount)"\s*:/i.test(json)||
    /(?:売上金額|単価|キャッシュバック|[￥¥$€]|\d\s*円)/i.test(json))
  refuse();
 return Object.freeze(payload);
}
