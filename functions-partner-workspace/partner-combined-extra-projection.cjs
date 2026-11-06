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
function projectPublishedPartnerExtras({hubId,cid,month,docs,visibleProducts=[],blockedIds=[],
 teamNames={},role="hub",actorUid=""}={}){
 if(!validId(hubId)||!validId(cid)||!MONTH.test(month||"")||
    !Array.isArray(docs)||docs.length>1000||
    !Array.isArray(visibleProducts)||visibleProducts.length>1000||
    !Array.isArray(blockedIds)||blockedIds.length>1000||
    blockedIds.some(x=>!validId(x))||
    !teamNames||typeof teamNames!=="object"||Array.isArray(teamNames)||
    !["hub","owner","leader","member"].includes(role)||
    (role==="member"&&!validId(actorUid)))fail();
 const blocked=new Set(blockedIds),visible=new Map();
 for(const p of visibleProducts){
  if(!validId(p?.id)||blocked.has(p.id)||visible.has(p.id))fail();
  let name;try{name=nameOnly(p.name);}catch{fail();}
  visible.set(p.id,name);
 }
 const counts=new Map([...visible].map(([id,name])=>[id,{id,name,totalCount:0}]));
 const people=new Map(),teams=new Map(),teamMembers=new Map(),seen=new Set();
 let totalCount=0,containsUnpublished=false,unattributedCount=0,unattributedRows=0;
 const add=(target,day)=>{
  for(const [id,n] of Object.entries(day)){
   target.counts[id]=(target.counts[id]||0)+n;
   if(!SAFE(target.counts[id]))fail();
  }
 };
 const sorted=(a,b)=>b.totalCount-a.totalCount||a.name.localeCompare(b.name,"ja")||a.key.localeCompare(b.key);
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
  let visibleDay=0;const visibleDayCounts={};
  for(const [id,n] of Object.entries(normalized.counts)){
   if(blocked.has(id)&&n>0)fail();
   if(!visible.has(id)){
    if(n>0)containsUnpublished=true;
    continue;
   }
   const sum=counts.get(id).totalCount+n;
   if(!SAFE(sum))fail();
   counts.get(id).totalCount=sum;
   if(n>0)visibleDayCounts[id]=n;
   visibleDay+=n;
  }
  if(!SAFE(visibleDay))fail();
  if(visibleDay===0)continue;
  if(typeof x.staffNameSnapshot!=="string")fail();
  let name;try{name=nameOnly(x.staffNameSnapshot);}catch{fail();}
  const key=hash(cid,"staff",x.staffId);
  let person=people.get(key);
  if(!person){
   person={key,name,totalCount:0,counts:{}};
   people.set(key,person);
  }
  person.totalCount+=visibleDay;totalCount+=visibleDay;
  if(!SAFE(person.totalCount)||!SAFE(totalCount))fail();
  add(person,visibleDayCounts);
  const teamId=validId(x.teamIdSnapshot)?x.teamIdSnapshot:null;
  if(!teamId){unattributedCount+=visibleDay;unattributedRows++;continue;}
  const teamKey=hash(cid,"team",teamId);
  let team=teams.get(teamKey);
  if(!team){
   let teamName="当時の班名未確認";
   if(Object.hasOwn(teamNames,teamId)){
    try{teamName=nameOnly(teamNames[teamId]);}catch{ /* legacy team name unavailable */ }
   }
   team={key:teamKey,name:teamName,totalCount:0,counts:{}};
   teams.set(teamKey,team);teamMembers.set(teamKey,new Map());
  }
  team.totalCount+=visibleDay;
  if(!SAFE(team.totalCount))fail();
  add(team,visibleDayCounts);
  const roster=teamMembers.get(teamKey);
  let member=roster.get(key);
  if(!member){member={key,name,totalCount:0,counts:{}};roster.set(key,member);}
  member.totalCount+=visibleDay;
  if(!SAFE(member.totalCount))fail();
  add(member,visibleDayCounts);
 }
 const products=[...counts.values()].filter(p=>p.totalCount>0);
 if(products.reduce((n,p)=>n+p.totalCount,0)!==totalCount||
    [...people.values()].reduce((n,p)=>n+p.totalCount,0)!==totalCount||
    [...teams.values()].reduce((n,t)=>n+t.totalCount,0)+unattributedCount!==totalCount)fail();
 const expandedTeams=[...teams.values()].map(team=>({
  ...team,members:[...teamMembers.get(team.key).values()].sort(sorted)
 })).sort(sorted);
 return {
  scope:"partner_published_extra_month_only",month,complete:false,
  containsUnpublished,verifiedExtraRows:docs.length,totalCount,
  products,people:[...people.values()].sort(sorted),teams:expandedTeams,
  unattributedCount,unattributedRows,
  productionDocumentWrites:0
 };
}
module.exports={projectPublishedPartnerExtras};
