"use strict";
/**
 * SB光 / SB AIR are distinct NEW count inputs beginning 2026-11-18 JST.
 * The existing nine-key partner count schema and product/ranking identity
 * "SB光・AIR" remain unchanged. Old combined counts stay "旧未分類"; no guessed
 * split and no rewrite of historical count, money, team, date or staff.
 * This module performs ZERO I/O and is opt-in behind a server flag.
 */
const START="2026-11-18";
const CATEGORY="SB光・AIR";
const PARTS=Object.freeze(["SB光","SB AIR","旧未分類"]);
const validInt=n=>Number.isSafeInteger(n)&&n>=0&&n<=9999;
const stop=()=>{throw Error("SB_LIGHT_AIR_SPLIT_CONTRACT_INVALID");};
const equalKeys=x=>x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).sort().join("|")===PARTS.slice().sort().join("|");
const newObject=(light,air,unknown)=>Object.freeze({
  "SB光":light,"SB AIR":air,"旧未分類":unknown
});
function checkDay(day){
 if(typeof day!=="string"||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day))
  stop();
 const t=Date.parse(day+"T00:00:00Z");
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==day)
  stop();
 return day;
}
function validateBreakdown(b,combined,day){
 checkDay(day);
 if(!validInt(combined))stop();
 if(b===undefined){
  return newObject(0,0,combined); // immutable legacy allocation
 }
 if(day<START||!equalKeys(b)||PARTS.some(k=>!validInt(b[k]))||
    b["SB光"]+b["SB AIR"]+b["旧未分類"]!==combined)
  stop();
 return newObject(b["SB光"],b["SB AIR"],b["旧未分類"]);
}
function planSplitWrite({
 date,splitEnabled=false,priorCount=0,priorBreakdown,
 combinedCount,requestedBreakdown,categoryEnabled=true
}={}){
 checkDay(date);
 if(!validInt(combinedCount)||!validInt(priorCount))stop();
 const previous=validateBreakdown(priorBreakdown,priorCount,date);
 if(splitEnabled!==true||date<START){
  if(requestedBreakdown!==undefined)stop();
  // The old count update path is handled by the original service;
  // this feature must not invent or update old breakdown metadata.
  return Object.freeze({useSplit:false,breakdown:previous});
 }
 if(categoryEnabled!==true){
  if(requestedBreakdown!==undefined||combinedCount!==priorCount)stop();
  return Object.freeze({useSplit:true,breakdown:previous});
 }
 const next=validateBreakdown(requestedBreakdown,combinedCount,date);
 // If a legacy row was already saved on the cutover date, its count is
 // permanently old/unclassified; only *new* 光/AIR numbers are editable.
 if(next["旧未分類"]!==previous["旧未分類"])stop();
 return Object.freeze({useSplit:true,breakdown:next});
}
function aggregateForRanking({date,combinedCount,breakdown}={}){
 const b=validateBreakdown(breakdown,combinedCount,date);
 return Object.freeze({name:CATEGORY,totalCount:combinedCount,
   inputBreakdown:b}); // never add b to combinedCount a second time
}
function productSwitchDisplay(products){
 if(!Array.isArray(products)||products.length>1000)stop();
 const active=[],history=[],ids=new Set();
 for(const p of products){
  if(!p||typeof p.id!=="string"||!p.id||
     ids.has(p.id)||typeof p.name!=="string"||
     typeof p.active!=="boolean")stop();
  ids.add(p.id);
  (p.active?active:history).push(p);
 }
 return Object.freeze({active:Object.freeze(active),
   history:Object.freeze(history)});
}
module.exports=Object.freeze({
 START,CATEGORY,PARTS,checkDay,validateBreakdown,planSplitWrite,
 aggregateForRanking,productSwitchDisplay
});
