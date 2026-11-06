"use strict";
// Money-free, saved additional-product month projection. No historical writes.
// The same verified source powers joint rankings and saved-at-time team detail.
const crypto=require("node:crypto");
const {normalizeExtraCounts}=require("./additional-counts.cjs");
const {validId,nameOnly}=require("./catalog-publication.cjs");
const MONTH=/^\d{4}-(?:0[1-9]|1[0-2])$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const SAFE=n=>Number.isSafeInteger(n)&&n>=0;
const fail=()=>{throw Error("COMBINED_EXTRA_MONTH_UNVERIFIED");};
const hash=(...args)=>crypto.createHash("sha256").update(args.join("\n")).digest("hex");
function projectPublishedPartnerExtras({
 hubId,cid,month,docs,visibleProducts=[],blockedIds=[],
 teamNames={},role="owner",actorUid=""
}={}){
 if(!validId(hubId)||!validId(cid)||!MONTH.test(month||"")||
    !Array.isArray(docs)||docs.length>1000||
    !Array.isArray(visibleProducts)||visibleProducts.length>1000||
    !Array.isArray(blockedIds)||blockedIds.length>1000||
    blockedIds.some(x=>!validId(x))||
    !teamNames||typeof teamNames!=="object"||Array.isArray(teamNames)||
    !["owner","leader","member","hub"].includes(role)||
    (role==="member"&&!validId(actorUid)))fail();
 const blocked=new Set(blockedIds),visible=new Map();
 for(const p of visibleProducts){
  if(!validId(p?.id)||blocked.has(p.id)||visible.has(p.id))fail();
  let name;try{name=nameOnly(p.name);}catch{fail();}
  visible.set(p.id,name);
 }
 const freshProducts=()=>new Map([...visible].map(([id,name])=>
  [id,{id,name,totalCount:0}]));
 const nonzero=map=>[...map.values()].filter(p=>p.totalCount>0);
 const add=(map,id,n)=>{
  const p=map.get(id);
  if(!p||!SAFE(p.totalCount+n))fail();
  p.totalCount+=n;
 };
 const counts=freshProducts(),people=new Map(),teams=new Map(),seen=new Set();
 const unattributed=freshProducts();
 let totalCount=0,containsUnpublished=false,unattributedCount=0,unattributedRows=0;
 for(const doc of docs){
  const x=doc?.data?.();
  if(!x||!validId(x.staffId)||!DATE.test(x.date||"")||
     !x.date.startsWith(month+"-")||
     x.date+"__"+x.staffId!==doc.id||seen.has(doc.id)||
     x.companyId!==cid||x.hubCompanyId!==hubId||
     (role==="member"&&x.staffId!==actorUid)||
     !Number.isSafeInteger(x.version)||x.version<1||
     !SAFE(x.totalCount))fail();
  seen.add(doc.id);
  let normalized;try{normalized=normalizeExtraCounts(x.counts);}
  catch{fail();}
  if(normalized.total!==x.totalCount)fail();
  let visibleDay=0;
  const dayProducts=[];
  for(const [id,n] of Object.entries(normalized.counts)){
   if(blocked.has(id)&&n>0)fail();
   if(!visible.has(id)){
    if(n>0)containsUnpublished=true;
    continue;
   }
   add(counts,id,n);
   visibleDay+=n;
   dayProducts.push([id,n]);
  }
  if(!SAFE(visibleDay))fail();
  if(visibleDay===0)continue;
  if(typeof x.staffNameSnapshot!=="string")fail();
  let name;try{name=nameOnly(x.staffNameSnapshot);}catch{fail();}
  const key=hash(cid,"staff",x.staffId);
  let person=people.get(key);
  if(!person){
   person={key,name,totalCount:0,productMap:freshProducts()};
   people.set(key,person);
  }
  person.totalCount+=visibleDay;totalCount+=visibleDay;
  if(!SAFE(person.totalCount)||!SAFE(totalCount))fail();
  for(const [id,n] of dayProducts)add(person.productMap,id,n);
  // The saved historical team is authoritative. Never use current team.
  const teamId=validId(x.teamIdSnapshot)?x.teamIdSnapshot:null;
  if(!teamId){
   unattributedRows++;unattributedCount+=visibleDay;
   if(!SAFE(unattributedCount))fail();
   for(const [id,n] of dayProducts)add(unattributed,id,n);
   continue;
  }
  const teamKey=hash(cid,"team",teamId);
  let team=teams.get(teamKey);
  if(!team){
   let teamName="当時の班名未確認";
   if(Object.hasOwn(teamNames,teamId)){
    try{teamName=nameOnly(teamNames[teamId]);}catch{}
   }
   team={key:teamKey,name:teamName,totalCount:0,
    productMap:freshProducts(),memberMap:new Map()};
   teams.set(teamKey,team);
  }
  team.totalCount+=visibleDay;
  if(!SAFE(team.totalCount))fail();
  let member=team.memberMap.get(key);
  if(!member){
   member={key,name,totalCount:0,productMap:freshProducts()};
   team.memberMap.set(key,member);
  }
  member.totalCount+=visibleDay;
  if(!SAFE(member.totalCount))fail();
  for(const [id,n] of dayProducts){
   add(team.productMap,id,n);add(member.productMap,id,n);
  }
 }
 const products=nonzero(counts);
 if(products.reduce((n,p)=>n+p.totalCount,0)!==totalCount||
    [...people.values()].reduce((n,p)=>n+p.totalCount,0)!==totalCount||
    [...teams.values()].reduce((n,t)=>n+t.totalCount,0)+unattributedCount!==totalCount)fail();
 for(const team of teams.values()){
  if([...team.memberMap.values()].reduce((n,p)=>n+p.totalCount,0)!==team.totalCount||
     nonzero(team.productMap).reduce((n,p)=>n+p.totalCount,0)!==team.totalCount)fail();
 }
 const sort=(a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja")||
  a.key.localeCompare(b.key);
 const toPerson=x=>({key:x.key,name:x.name,totalCount:x.totalCount,
  products:nonzero(x.productMap)});
 const teamDetails=[...teams.values()].map(x=>({
  key:x.key,name:x.name,totalCount:x.totalCount,
  products:nonzero(x.productMap),
  members:[...x.memberMap.values()].map(toPerson).sort(sort)
 })).sort(sort);
 return {
  scope:"partner_published_extra_month_only",month,complete:false,
  containsUnpublished,verifiedExtraRows:docs.length,totalCount,
  products,people:[...people.values()].map(toPerson).sort(sort),
  teams:teamDetails,unattributedCount,unattributedRows,
  unattributedProducts:nonzero(unattributed),
  productionDocumentWrites:0
 };
}
module.exports={projectPublishedPartnerExtras};
