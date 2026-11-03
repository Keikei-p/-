"use strict";
// Only approved, unlinked NEW product counts appear in HQ partner team detail.
// Partner-private, retired and unpublished quantities are never serialized.
// One original category is NEVER added into the new-product totals.
const {projectExtraRankDocs}=require("./extra-rank-projection.cjs");
const {validId,nameOnly}=require("./catalog-publication.cjs");
const fail=()=>{throw Error("OWNER_EXTRA_BREAKDOWN_UNVERIFIED");};
const safe=n=>Number.isSafeInteger(n)&&n>=0;
function ownerPublishedExtraBreakdown(docs,{
 hubId,cid,date,teamIds=[],publishedProducts=[],linkedIds=[]
}={}){
 if(!Array.isArray(teamIds)||teamIds.length>150||
    teamIds.some(id=>!validId(id))||new Set(teamIds).size!==teamIds.length||
    !Array.isArray(publishedProducts)||publishedProducts.length>1000)fail();
 const ids=new Set(),names=new Map(),counts=new Map();
 for(const p of publishedProducts){
  if(!validId(p?.id)||ids.has(p.id))fail();
  ids.add(p.id);
  // A product with a price-like name must never bypass the existing catalog
  // safety validator or accidentally display prices on a partner count screen.
  let name;try{name=nameOnly(p.name);}catch{fail();}
  names.set(p.id,name);
 }
 let projected;
 try{projected=projectExtraRankDocs(docs,{
  hubId,cid,date,publishedIds:[...ids],linkedIds
 });}catch{fail();}
 const active=new Set(teamIds),byTeam=new Map(),others=[];
 let verifiedPublishedCount=0,unattributedPublishedCount=0;
 for(const item of projected){
  const productRows=[];
  let visible=0;
  for(const [id,value] of Object.entries(item.extraCounts)){
   if(!names.has(id)||!safe(value))fail();
   if(value)productRows.push({id,name:names.get(id),count:value});
   visible+=value;
  }
  if(!safe(visible))fail();
  if(!visible)continue;
  verifiedPublishedCount+=visible;
  if(!safe(verifiedPublishedCount))fail();
  if(!active.has(item.teamIdSnapshot)){
   unattributedPublishedCount+=visible;
   continue;
  }
  const row=byTeam.get(item.teamIdSnapshot)||{
   teamId:item.teamIdSnapshot,totalCount:0,products:new Map(),people:[]
  };
  row.totalCount+=visible;
  if(!safe(row.totalCount))fail();
  for(const p of productRows){
   row.products.set(p.id,(row.products.get(p.id)||0)+p.count);
   if(!safe(row.products.get(p.id)))fail();
  }
  row.people.push({name:item.staffNameSnapshot,totalCount:visible,
   products:productRows});
  byTeam.set(item.teamIdSnapshot,row);
 }
 const teams=[...byTeam.values()].map(x=>({
  teamId:x.teamId,totalCount:x.totalCount,
  products:[...x.products].map(([id,count])=>({id,name:names.get(id),count})),
  people:x.people
 }));
 if(teams.reduce((n,t)=>n+t.totalCount,unattributedPublishedCount)!==
    verifiedPublishedCount)fail();
 return {scope:"published_extra_count_only",complete:true,
  verifiedPublishedCount,unattributedPublishedCount,teams};
}
module.exports={ownerPublishedExtraBreakdown};
