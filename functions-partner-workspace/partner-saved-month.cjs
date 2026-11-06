"use strict";
/**
 * MAIN-based, read-only first step toward partner month navigation.
 * Project only SAVED legacy nine-category per-staff counts, never raw sales,
 * prices, partner private products, CB tiers, or current-team reattribution.
 * No missing report is invented as 0 and no daily documents are changed.
 */
const crypto=require("node:crypto");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const MONTH=/^\d{4}-(?:0[1-9]|1[0-2])$/;
const NAME=/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u;
const FINANCE=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const fail=()=>{throw Error("PARTNER_SAVED_MONTH_UNVERIFIED");};
const hash=(...parts)=>crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
const validName=x=>typeof x==="string"&&NAME.test(x)&&!FINANCE.test(x);
const zero=keys=>Object.fromEntries(keys.map(key=>[key,0]));
function monthBounds(month,jstDay){
 if(!MONTH.test(month||"")||!DAY.test(jstDay||""))fail();
 const first=month+"-01";
 const startMs=Date.parse(first+"T00:00:00Z");
 const nowMs=Date.parse(jstDay+"T00:00:00Z");
 if(!Number.isFinite(startMs)||!Number.isFinite(nowMs)||
    first>jstDay||nowMs-startMs>366*86400000)fail();
 const last=new Date(Date.UTC(Number(month.slice(0,4)),
  Number(month.slice(5,7)),0)).toISOString().slice(0,10);
 return Object.freeze({month,first,last:last<jstDay?last:jstDay});
}
function projectSavedPartnerMonth({hubId,partnerId,month,rows,categoryKeys,
 teamNames={},role="owner",actorUid=""}={}){
 if(!ID.test(hubId||"")||!ID.test(partnerId||"")||
    !MONTH.test(month||"")||!Array.isArray(rows)||rows.length>1000||
    !Array.isArray(categoryKeys)||categoryKeys.length!==9||
    categoryKeys.some(k=>typeof k!=="string"||!k)||
    new Set(categoryKeys).size!==categoryKeys.length||
    !["owner","leader","member","hub"].includes(role)||
    (role==="member"&&!ID.test(actorUid||""))||
    !teamNames||typeof teamNames!=="object"||Array.isArray(teamNames))fail();
 const totals=zero(categoryKeys),people=new Map(),teams=new Map(),seen=new Set();
 let totalCount=0,unattributedCount=0,unattributedRows=0;
 for(const doc of rows){
  const x=doc?.data?.();
  if(!x||!ID.test(x.staffId||"")||
     (role==="member"&&x.staffId!==actorUid)||
     x.companyId!==partnerId||x.hubCompanyId!==hubId||
     typeof x.date!=="string"||!DAY.test(x.date)||
     !x.date.startsWith(month+"-")||
     doc.id!==x.date+"__"+x.staffId||seen.has(doc.id))fail();
  seen.add(doc.id);
  if(!x.counts||typeof x.counts!=="object"||Array.isArray(x.counts)||
     Object.keys(x.counts).length!==categoryKeys.length)fail();
  let count=0;
  for(const k of categoryKeys){
   if(!Object.hasOwn(x.counts,k)||!Number.isSafeInteger(x.counts[k])||
      x.counts[k]<0||x.counts[k]>9999)fail();
   count+=x.counts[k];
  }
  if(!Number.isSafeInteger(count)||x.totalCount!==count)fail();
  totalCount+=count;
  if(!Number.isSafeInteger(totalCount))fail();
  for(const k of categoryKeys)totals[k]+=x.counts[k];
  const personKey=hash(partnerId,"staff",x.staffId);
  const teamId=ID.test(x.teamIdSnapshot||"")?x.teamIdSnapshot:null;
  const teamKey=teamId?hash(partnerId,"team",teamId):null;
  const personName=validName(x.staffNameSnapshot) ? x.staffNameSnapshot : "当時の氏名未確認";
  let p=people.get(personKey);
  if(!p){
   p={key:personKey,name:personName,teamKey,
    totalCount:0,counts:zero(categoryKeys),teamHistoryMixed:false};
   people.set(personKey,p);
  }else if(p.teamKey!==teamKey){
   p.teamHistoryMixed=true;p.teamKey=null;
  }
  p.totalCount+=count;
  for(const k of categoryKeys)p.counts[k]+=x.counts[k];
  if(!teamKey){unattributedRows++;unattributedCount+=count;continue;}
  let t=teams.get(teamKey);
  if(!t){
   const name=Object.hasOwn(teamNames,teamId)&&validName(teamNames[teamId])?
    teamNames[teamId]:"当時の班名未確認";
   t={key:teamKey,name,totalCount:0,counts:zero(categoryKeys),reportedRows:0};
   teams.set(teamKey,t);
  }
  t.totalCount+=count;t.reportedRows++;
  for(const k of categoryKeys)t.counts[k]+=x.counts[k];
 }
 const sorted=(a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja")||
   a.key.localeCompare(b.key);
 return Object.freeze({
  scope:"partner_saved_month_counts_only",month,partnerKey:hash("partner",partnerId),
  complete:false,provisional:true,verifiedEntryRows:rows.length,
  missingHistoricalTeamAttribution:unattributedRows>0,
  unattributedRows,unattributedCount,totalCount,counts:totals,
  people:[...people.values()].sort(sorted),teams:[...teams.values()].sort(sorted),
  // Intentionally no historical private counts / money / identifier paths.
  financialFieldsIncluded:false,productionDocumentWrites:0
 });
}
module.exports={monthBounds,projectSavedPartnerMonth};
