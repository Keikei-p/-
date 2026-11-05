"use strict";
// Read-only OWN-PARTNER monthly team/person/product breakdown.
// Historical team IDs are immutable, including departed staff and team moves.
// Money/UID/email/financial sales originals never appear in this response.
const {projectPartnerProductMonth}=require("./partner-product-monthly.cjs");
const {normalizeExtraCounts}=require("./additional-counts.cjs");
const {validId,nameOnly}=require("./catalog-publication.cjs");
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const DAY=/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const CB=["0","20000","40000","60000","80000","unclassified"];
const fail=()=>{throw Error("PARTNER_MONTH_TEAM_UNVERIFIED");};
const check=n=>Number.isSafeInteger(n)&&n>=0&&n<=99999999;
const initial=keys=>Object.fromEntries(keys.map(key=>[key,0]));
const total=x=>Object.values(x).reduce((a,b)=>a+b,0);
function projectPartnerMonthTeamDetails({hubId,cid,companyName,month,keys,
 workDocs=[],extraDocs=[],teamNames={},publishedProducts=[],linkedIds=[],
 privateProducts=[]}={}){
 if(!validId(hubId)||!validId(cid)||!MONTH.test(month||"")||
  !Array.isArray(keys)||keys.length!==9||new Set(keys).size!==keys.length||
  !Array.isArray(workDocs)||!Array.isArray(extraDocs)||
  !teamNames||typeof teamNames!=="object"||Array.isArray(teamNames)||
  !Array.isArray(publishedProducts)||publishedProducts.length>1000||
  !Array.isArray(privateProducts)||privateProducts.length>100||
  !Array.isArray(linkedIds)||linkedIds.some(x=>!validId(x))||
  new Set(linkedIds).size!==linkedIds.length)fail();
 let company;
 try{company=nameOnly(companyName);}catch{fail();}
 let source;
 try{source=projectPartnerProductMonth({hubId,cid,month,keys,
  workDocs,extraDocs,linkedIds});}catch{fail();}
 const names=new Map(),privateNames=new Map(),blocked=new Set(linkedIds);
 const visibleKeys=[...keys],previousNames=new Set(keys);
 function addName(prefix,product,map){
  if(!validId(product?.id)||map.has(product.id))fail();
  let n;
  try{n=nameOnly(product.name);}catch{fail();}
  // Distinct IDs may share the same display name; keep their input buckets
  // separate without disclosing opaque product or price attributes.
  let label=prefix+n,number=2;
  while(previousNames.has(label)){label=prefix+n+"（"+number+++"）";}
  previousNames.add(label);visibleKeys.push(label);map.set(product.id,label);
 }
 for(const product of publishedProducts){
  if(blocked.has(product.id))fail();
  addName("追加：",product,names);
 }
 for(const product of privateProducts)addName("協力店専用：",product,privateNames);
 const archivedKey="過去・非公開の追加商材";
 const privateOtherKey="過去の協力店専用商材";
 visibleKeys.push(archivedKey,privateOtherKey);
 const totals=initial(visibleKeys),teamMap=new Map(),seenWork=new Set(),seenExtra=new Set();
 const peopleIds=new Set(),reportedDates=new Set();
 const cleanName=(value,def)=>{
  try{return nameOnly(value);}catch{return def;}
 };
 const team=(id)=>{
  const actual=validId(id)?id:"";
  const mapKey=actual||"__unknown__";
  let t=teamMap.get(mapKey);
  if(!t){
   const raw=Object.hasOwn(teamNames,actual)?teamNames[actual]:null;
   t={key:mapKey,name:cleanName(raw,"登録当時の班未確認"),
    totalCount:0,counts:initial(visibleKeys),cbCounts:{NURO:initial(CB)},
    people:new Map(),reportedDates:new Set()};
   teamMap.set(mapKey,t);
  }
  return t;
 };
 const person=(t,id,name)=>{
  if(!validId(id))fail();
  let p=t.people.get(id);
  if(!p){
   p={name:cleanName(name,"担当者未確認"),totalCount:0,
    counts:initial(visibleKeys),cbCounts:{NURO:initial(CB)},reported:true};
   t.people.set(id,p);
  }
  return p;
 };
 const save=(t,p,label,n)=>{
  if(!check(n)||!Object.hasOwn(t.counts,label))fail();
  t.counts[label]+=n;p.counts[label]+=n;totals[label]+=n;
  t.totalCount+=n;p.totalCount+=n;
  if(!check(t.counts[label])||!check(p.counts[label])||!check(totals[label])||
    !check(t.totalCount)||!check(p.totalCount))fail();
 };
 const inspect=(doc,seen)=>{
  const x=doc?.data?.();
  if(!x||!DAY.test(x.date||"")||!x.date.startsWith(month+"-")||
   !validId(x.staffId)||doc.id!==x.date+"__"+x.staffId||
   x.companyId!==cid||x.hubCompanyId!==hubId||
   !Number.isSafeInteger(x.version)||x.version<1||seen.has(doc.id))fail();
  seen.add(doc.id);reportedDates.add(x.date);peopleIds.add(x.staffId);
  return x;
 };
 for(const doc of workDocs){
  const x=inspect(doc,seenWork),t=team(x.teamIdSnapshot),
   p=person(t,x.staffId,x.staffNameSnapshot);
  t.reportedDates.add(x.date);
  const n=initial(CB);
  if(x.cbCounts!=null){
   const c=x.cbCounts?.NURO;
   if(!c||typeof c!=="object"||Array.isArray(c)||
    Object.keys(x.cbCounts).length!==1||
    Object.keys(c).some(k=>!CB.includes(k)))fail();
   for(const [k,v] of Object.entries(c)){if(!check(v)||v>9999)fail();n[k]=v;}
   if(total(n)!==x.counts.NURO)fail();
  }else n.unclassified=x.counts.NURO;
  for(const key of CB){t.cbCounts.NURO[key]+=n[key];p.cbCounts.NURO[key]+=n[key];}
  for(const key of keys)save(t,p,key,x.counts[key]);
  let priv;
  try{priv=normalizeExtraCounts(x.privateCounts??{});}catch{fail();}
  if((x.privateTotalCount??0)!==priv.total)fail();
  for(const [id,value] of Object.entries(priv.counts))
   save(t,p,privateNames.get(id)||privateOtherKey,value);
 }
 for(const doc of extraDocs){
  const x=inspect(doc,seenExtra),t=team(x.teamIdSnapshot),
   p=person(t,x.staffId,x.staffNameSnapshot);
  t.reportedDates.add(x.date);
  let ext;
  try{ext=normalizeExtraCounts(x.counts);}catch{fail();}
  if(ext.total!==x.totalCount)fail();
  for(const [id,value] of Object.entries(ext.counts)){
   if(blocked.has(id)&&value>0)fail();
   save(t,p,names.get(id)||archivedKey,value);
  }
 }
 if(total(totals)!==source.totalCount)fail();
 const teams=[...teamMap.values()].map(t=>{
  const people=[...t.people.values()].sort((a,b)=>b.totalCount-a.totalCount||
   a.name.localeCompare(b.name,"ja"));
  if(people.reduce((n,p)=>n+p.totalCount,0)!==t.totalCount||
   total(t.counts)!==t.totalCount||t.cbCounts.NURO.unclassified+
   CB.filter(x=>x!=="unclassified").reduce((n,k)=>n+t.cbCounts.NURO[k],0)!==t.counts.NURO)fail();
  return {name:t.name,totalCount:t.totalCount,counts:t.counts,
   cbCounts:t.cbCounts,people,reportedDayCount:t.reportedDates.size};
 }).sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
 if(teams.reduce((n,t)=>n+t.totalCount,0)!==source.totalCount)fail();
 return {scope:"partner_monthly_team_counts_only",companyName:company,
  month,categories:visibleKeys,totalCount:source.totalCount,
  primaryTotalCount:source.primaryTotalCount,
  privateTotalCount:source.privateTotalCount,
  additionalTotalCount:source.additionalTotalCount,
  reportedStaffCount:peopleIds.size,reportedTeamCount:teams.length,
  savedWorkRows:source.verifiedWorkRows,savedExtraRows:source.verifiedExtraRows,
  reportedDayCount:reportedDates.size,complete:false,teams};
}
module.exports={projectPartnerMonthTeamDetails};
