"use strict";
// Shared ranking accepts ONLY validated count summaries; originals never leave
// the server. A malformed ledger must NEVER become "0", a tie, or a rank.
const crypto=require("node:crypto");
const OPAQUE=/^[a-f0-9]{64}$/;
const MONEY=/(?:単価|売上|利益|収益|報酬|[¥￥$€]|\d[\d,]*円)/;
const NAME=/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u;
const fail=()=>{throw Error("COMBINED_MONTH_UNVERIFIED");};
const hash=(...x)=>crypto.createHash("sha256").update(x.join("\n")).digest("hex");
const checkName=x=>typeof x==="string"&&x.length>0&&x.length<=60&&
 NAME.test(x)&&!MONEY.test(x)&&!x.includes("@");
const validCount=n=>Number.isSafeInteger(n)&&n>=0;
const summed=(values,keys)=>keys.reduce((sum,k)=>sum+values[k],0);
const validateCounts=(value,keys)=>{
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).length!==keys.length||
    !keys.every(key=>Object.hasOwn(value,key)&&validCount(value[key])))
   fail();
};
function projectCombinedMonth({month,hubId,keys,direct,partners=[]}={}){
 if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month||"")||
    !/^[A-Za-z0-9_-]{1,128}$/.test(hubId||"")||
    !Array.isArray(keys)||keys.length!==9||
    new Set(keys).size!==keys.length||
    keys.some(x=>typeof x!=="string"||!x)||
    !Array.isArray(partners)||partners.length>20||
    !direct||!validCount(direct.totalCount)||!validCount(direct.otherCount)||
    !validCount(direct.recordsVerified)||
    !Array.isArray(direct.people)||!Array.isArray(direct.teams)||
    direct.people.length>10000||direct.peopleVerified!==true)
   fail();
 validateCounts(direct.counts,keys);
 if(summed(direct.counts,keys)+direct.otherCount!==direct.totalCount)fail();
 const people=[],companies=[],totals={...direct.counts};
 const usedPersonIds=new Set(),partnerIds=new Set(),publishedExtras=new Map();
 let grandTotal=direct.totalCount,partnerTotal=0,partnerRows=0,extraRows=0;
 let unpublishedExtraExcluded=false;
 const append=(person,companyId,companyName,kind)=>{
  if(!person||!OPAQUE.test(person.key||"")||!checkName(person.name)||
     !validCount(person.totalCount))fail();
  validateCounts(person.counts,keys);
  if(summed(person.counts,keys)!==person.totalCount&&kind==="partner")fail();
  // A direct record may include a verified but unmapped product; the
  // person's 9 known categories can therefore sum BELOW their total.
  if(summed(person.counts,keys)>person.totalCount)fail();
  const key=hash("joint_person",companyId,person.key);
  if(usedPersonIds.has(key))fail();
  usedPersonIds.add(key);
  people.push({key,name:person.name,companyName,kind,
   totalCount:person.totalCount,counts:{...person.counts}});
 };
 for(const p of direct.people)append(p,hubId,"直営","direct");
 // If the DIRECT total contains unattributed original records, do not
 // claim that a combined individual ranking covers all staff.
 const directPeopleSum=direct.people.reduce((n,p)=>n+p.totalCount,0);
 if(directPeopleSum!==direct.totalCount)fail();
 for(const company of partners){
  const {id,name,data,extra}=company||{};
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id||"")||
     partnerIds.has(id)||id===hubId||!checkName(name)||!data||
     data.scope!=="partner_saved_month_counts_only"||
     data.month!==month||data.complete!==false||
     !validCount(data.totalCount)||!validCount(data.verifiedEntryRows)||
     !Array.isArray(data.people)||data.people.length>1000)fail();
  partnerIds.add(id);
  validateCounts(data.counts,keys);
  if(summed(data.counts,keys)!==data.totalCount)fail();
  if(data.people.reduce((n,p)=>n+p.totalCount,0)!==data.totalCount)fail();
  const before=people.length;
  for(const p of data.people)append(p,id,name,"partner");
  if(people.length-before!==data.people.length)fail();
  let extraTotal=0,extraCountRows=0;
  if(extra!==undefined){
   if(extra?.scope!=="partner_published_extra_month_only"||
      extra.month!==month||extra.complete!==false||
      extra.productionDocumentWrites!==0||
      typeof extra.containsUnpublished!=="boolean"||
      !validCount(extra.totalCount)||!validCount(extra.verifiedExtraRows)||
      !Array.isArray(extra.people)||extra.people.length>1000||
      !Array.isArray(extra.products)||extra.products.length>1000)fail();
   const originalPeople=new Map(people.slice(before).map(p=>[p.key,p]));
   let peopleExtra=0,productsExtra=0;
   for(const x of extra.people){
    if(!OPAQUE.test(x?.key||"")||!checkName(x.name)||
       !validCount(x.totalCount))fail();
    const key=hash("joint_person",id,x.key);
    let combined=originalPeople.get(key);
    if(!combined){
     if(usedPersonIds.has(key))fail();
     usedPersonIds.add(key);
     combined={key,name:x.name,companyName:name,kind:"partner",
      totalCount:0,counts:Object.fromEntries(keys.map(k=>[k,0]))};
     originalPeople.set(key,combined);people.push(combined);
    }
    combined.totalCount+=x.totalCount;
    if(!validCount(combined.totalCount))fail();
    peopleExtra+=x.totalCount;
   }
   const extraIds=new Set();
   for(const product of extra.products){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(product?.id||"")||
       extraIds.has(product.id)||!checkName(product.name)||
       !validCount(product.totalCount))fail();
    extraIds.add(product.id);
    const prior=publishedExtras.get(product.id);
    if(prior&&prior.name!==product.name)fail();
    publishedExtras.set(product.id,{id:product.id,name:product.name,
     totalCount:(prior?.totalCount??0)+product.totalCount});
    productsExtra+=product.totalCount;
   }
   if(peopleExtra!==extra.totalCount||productsExtra!==extra.totalCount)fail();
   extraTotal=extra.totalCount;
   extraCountRows=extra.verifiedExtraRows;
   extraRows+=extraCountRows;
   unpublishedExtraExcluded ||= extra.containsUnpublished;
  }
  companies.push({key:hash("joint_company",id),name,
   totalCount:data.totalCount+extraTotal,
   verifiedEntryRows:data.verifiedEntryRows+extraCountRows,
   reported:data.verifiedEntryRows+extraCountRows>0});
  partnerRows+=data.verifiedEntryRows;
  partnerTotal+=data.totalCount+extraTotal;grandTotal+=data.totalCount+extraTotal;
  if(!validCount(grandTotal)||!validCount(partnerRows))fail();
  for(const k of keys)totals[k]+=data.counts[k];
 }
 companies.sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
 // Only verified SAVED entries can rank. Never claim full monthly coverage.
 people.sort((a,b)=>b.totalCount-a.totalCount||
  a.name.localeCompare(b.name,"ja")||a.key.localeCompare(b.key));
 let previous=null,rank=0;
 const standing=people.map((p,index)=>{
  if(previous!==p.totalCount){rank=index+1;previous=p.totalCount;}
  return {...p,rank};
 });
 const haveSavedRows=direct.recordsVerified+partnerRows+extraRows>0;
 const products=haveSavedRows?keys.map(name=>({name,totalCount:totals[name]})):[];
 products.push(...publishedExtras.values());
 if(direct.otherCount>0)products.push({name:"その他（直営）",totalCount:direct.otherCount});
 products.sort((a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja"));
 let prev=null,productRank=0;
 const productStanding=products.map((p,i)=>{
  if(prev!==p.totalCount){productRank=i+1;prev=p.totalCount;}
  return {...p,rank:productRank};
 });
 if(products.reduce((s,p)=>s+p.totalCount,0)!==grandTotal||
    people.reduce((s,p)=>s+p.totalCount,0)!==grandTotal)fail();
 return Object.freeze({
  scope:"joint_saved_month_counts_only",month,complete:false,provisional:true,
  provisionalReason:unpublishedExtraExcluded?
   "保存済み件数のみ。非公開商材・未報告日はランキング対象外":
   "保存済み件数のみ。未報告日・未報告者は未照合",
  includesDirect:true,partnerCount:partners.length,
  verifiedPartnerRows:partnerRows+extraRows,hasSavedRows:haveSavedRows,
  unpublishedExtraExcluded,grandTotal,partnerTotal,
  directTotal:direct.totalCount,otherDirectCount:direct.otherCount,
  companies,people:standing,products:productStanding,
  productionDocumentWrites:0
 });
}
module.exports={projectCombinedMonth};
