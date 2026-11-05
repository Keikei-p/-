"use strict";
/**
 * NO DEPLOY: final cross-company arithmetic gate before a provisional
 * month ranking is composed. Read-only and count-only, never modifies
 * Firestore originals, historical prices, teams or authenticated accounts.
 * One corrupted company/person/team/product total vetoes the WHOLE response,
 * not just the affected row or a guessed zero.
 */
const deny=()=>{throw Error("SHARED_MONTHLY_RECONCILIATION_FAILED");};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const number=x=>Number.isSafeInteger(x)&&x>=0;
function sum(values){
 let result=0;
 for(const x of values){
  if(!number(x)||!Number.isSafeInteger(result+x))deny();
  result+=x;
 }
 return result;
}
function categorySum(counts,categories){
 if(!obj(counts)||Object.keys(counts).length!==categories.length||
    Object.keys(counts).some(k=>!categories.includes(k)))deny();
 return sum(categories.map(k=>counts[k]));
}
function extraSum(counts){
 if(!obj(counts)||Object.keys(counts).length>1000||
    Object.keys(counts).some(k=>!/^[A-Za-z0-9_-]{1,128}$/.test(k)||
      ["__proto__","constructor","prototype"].includes(k)))deny();
 return sum(Object.values(counts));
}
function reconcileSharedMonthlyCounts({
 companies,people,teams,productCounts,additionalTotalCount,direct,categories
}={}){
 if(!Array.isArray(categories)||!categories.length||categories.length>30||
    new Set(categories).size!==categories.length||
    categories.some(k=>typeof k!=="string"||k.length<1||k.length>80)||
    !Array.isArray(companies)||companies.length>20||
    !Array.isArray(people)||people.length>10000||
    !Array.isArray(teams)||teams.length>4000||
    !obj(direct)||!Array.isArray(direct.people)||!Array.isArray(direct.teams))
  deny();
 const companyIds=new Set();
 const totals=Object.fromEntries(categories.map(c=>[c,0]));
 const companyTotal=sum(companies.map(company=>{
  if(!obj(company)||typeof company.id!=="string"||
     !/^[A-Za-z0-9_-]{1,128}$/.test(company.id)||
     companyIds.has(company.id)||company.peopleVerified!==true||
     !number(company.extraTotalCount))deny();
  companyIds.add(company.id);
  const normal=categorySum(company.counts,categories);
  if(!number(company.totalCount)||company.totalCount!==normal+company.extraTotalCount)
   deny();
  for(const key of categories)totals[key]+=company.counts[key];
  return company.totalCount;
 }));
 if(categorySum(productCounts,categories)!==sum(Object.values(totals))||
    categories.some(key=>productCounts[key]!==totals[key]))
  deny();
 const extras=sum(companies.map(c=>c.extraTotalCount));
 if(!number(additionalTotalCount)||additionalTotalCount!==extras)deny();
 const personTotal=sum(people.map(p=>{
  if(!obj(p)||typeof p.name!=="string"||typeof p.companyName!=="string"||
     !number(p.totalCount))deny();
  if(categorySum(p.counts,categories)+extraSum(p.extraCounts??{})!==p.totalCount)
   deny();
  return p.totalCount;
 }));
 const teamTotal=sum(teams.map(t=>{
  if(!obj(t)||typeof t.name!=="string"||typeof t.companyName!=="string"||
     !number(t.totalCount)||!number(t.extraTotalCount))deny();
  if(categorySum(t.counts,categories)+t.extraTotalCount!==t.totalCount)
   deny();
  return t.totalCount;
 }));
 if(personTotal!==companyTotal||teamTotal!==companyTotal||
    sum(teams.map(t=>t.extraTotalCount))!==extras||
    sum(people.map(p=>extraSum(p.extraCounts??{})))!==extras)deny();
 const originalTotal=categorySum(direct.counts,categories);
 if(!number(direct.totalCount)||!number(direct.otherCount)||
    originalTotal+direct.otherCount!==direct.totalCount||!number(direct.recordsVerified)||
    typeof direct.peopleVerified!=="boolean")deny();
 if(sum(direct.teams.map(t=>t?.totalCount))!==direct.totalCount)deny();
 const verifiedPeopleTotal=sum(direct.people.map(p=>p?.totalCount));
 if(direct.peopleVerified===true?verifiedPeopleTotal!==direct.totalCount:
    verifiedPeopleTotal>direct.totalCount)deny();
 const combinedTotal=sum([companyTotal,direct.totalCount]);
 // Never infer month completeness from arithmetic; missing days remain
 // unverified and the caller must keep its provisional-only status.
 return Object.freeze({combinedTotalCount:combinedTotal,
  partnerTotalCount:companyTotal,reconciled:true,complete:false});
}
module.exports={reconcileSharedMonthlyCounts};
