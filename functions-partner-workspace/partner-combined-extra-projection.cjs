"use strict";
// Extra published product totals for a single partner/month.
// Read-only: NEVER rewrite original 9-category counts, sales, CB, or history.
const crypto=require("node:crypto");
const {normalizeExtraCounts}=require("./additional-counts.cjs");
const {validId,nameOnly}=require("./catalog-publication.cjs");
const MONTH=/^\d{4}-(?:0[1-9]|1[0-2])$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const SAFE=n=>Number.isSafeInteger(n)&&n>=0;
const fail=()=>{throw Error("COMBINED_EXTRA_MONTH_UNVERIFIED");};
const hash=(...args)=>crypto.createHash("sha256").update(args.join("\n")).digest("hex");
function projectPublishedPartnerExtras({hubId,cid,month,docs,visibleProducts=[],blockedIds=[]}={}){
 if(!validId(hubId)||!validId(cid)||!MONTH.test(month||"")||
    !Array.isArray(docs)||docs.length>1000||
    !Array.isArray(visibleProducts)||visibleProducts.length>1000||
    !Array.isArray(blockedIds)||blockedIds.length>1000||
    blockedIds.some(x=>!validId(x)))fail();
 const blocked=new Set(blockedIds),visible=new Map();
 for(const p of visibleProducts){
  if(!validId(p?.id)||blocked.has(p.id)||visible.has(p.id))fail();
  let name;try{name=nameOnly(p.name);}catch{fail();}
  visible.set(p.id,name);
 }
 const counts=new Map([...visible].map(([id,name])=>[id,{id,name,totalCount:0}]));
 const people=new Map(),seen=new Set();
 let totalCount=0,containsUnpublished=false;
 for(const doc of docs){
  const x=doc?.data?.();
  if(!x||!validId(x.staffId)||!DATE.test(x.date||"")||
     !x.date.startsWith(month+"-")||
     x.date+"__"+x.staffId!==doc.id||seen.has(doc.id)||
     x.companyId!==cid||x.hubCompanyId!==hubId||
     !Number.isSafeInteger(x.version)||x.version<1||
     !SAFE(x.totalCount))fail();
  seen.add(doc.id);
  let normalized;try{normalized=normalizeExtraCounts(x.counts);}
  catch{fail();}
  if(normalized.total!==x.totalCount)fail();
  let visibleDay=0;
  for(const [id,n] of Object.entries(normalized.counts)){
   if(blocked.has(id)&&n>0)fail();
   if(!visible.has(id)){
    if(n>0)containsUnpublished=true;
    continue;
   }
   const sum=counts.get(id).totalCount+n;
   if(!SAFE(sum))fail();
   counts.get(id).totalCount=sum;
   visibleDay+=n;
  }
  if(!SAFE(visibleDay))fail();
  if(visibleDay===0)continue;
  if(typeof x.staffNameSnapshot!=="string")fail();
  let name;try{name=nameOnly(x.staffNameSnapshot);}catch{fail();}
  const key=hash(cid,"staff",x.staffId);
  let person=people.get(key);
  if(!person){
   person={key,name,totalCount:0};
   people.set(key,person);
  }
  person.totalCount+=visibleDay;totalCount+=visibleDay;
  if(!SAFE(person.totalCount)||!SAFE(totalCount))fail();
 }
 const products=[...counts.values()].filter(p=>p.totalCount>0);
 if(products.reduce((n,p)=>n+p.totalCount,0)!==totalCount||
    [...people.values()].reduce((n,p)=>n+p.totalCount,0)!==totalCount)fail();
 return {
  scope:"partner_published_extra_month_only",month,complete:false,
  containsUnpublished,verifiedExtraRows:docs.length,totalCount,
  products,people:[...people.values()],
  productionDocumentWrites:0
 };
}
module.exports={projectPublishedPartnerExtras};
