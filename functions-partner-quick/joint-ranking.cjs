"use strict";
/**
 * Read-only combined DAILY count ranks. No Firestore client receives sales
 * records or prices. Quick company-only reports NEVER fabricate staff ranks.
 * This function is restricted to a verified hub Owner / quick partner Owner
 * by makeQuickCounts.caller + identity before this module is called.
 */
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONEY=/(?:[¥￥$€]|単価|売上|収益|報酬|利益|\d[\d,]*円)/;
const clean=x=>typeof x==="string"?x.trim():"";
const label=(x,fallback)=>{
 const t=clean(x);
 return t&&t.length<=80&&!MONEY.test(t)?t:fallback;
};
const normalize=x=>String(x||"").normalize("NFKC").toUpperCase().replace(/[\s　・、，,./／+＋_\-]/g,"");
function mapCategory(name) {
 const n=normalize(name);
 if(["NURO","NURO光","ニューロ","ニューロ光"].map(normalize).includes(n))return "NURO";
 if(n==="SBMNP")return "SBMNP";
 if(n==="YMMNP")return "YMMNP";
 if(["YM純新規","YMPURE","YMSHINKI"].map(normalize).includes(n))return "YM純新規";
 if(["SB光・AIR","SB光AIR","SB光","SOFTBANKAIR","SBAIR"].map(normalize).includes(n))return "SB光・AIR";
 if(["ウォーター","ウォーターサーバー","フレシャス"].map(normalize).includes(n))return "ウォーター";
 if(["つばさ・HTB","つばさ","HTB","HTBエナジー","エバーグリーン","とくするでんき","新電力"].map(normalize).includes(n))return "つばさ・HTB";
 if(["太陽光・蓄電池AP","太陽光","蓄電池AP"].map(normalize).includes(n))return "太陽光・蓄電池AP";
 if(["U-NEXT","UNEXT"].map(normalize).includes(n))return "U-NEXT";
 return null;
}
function internalCounts(record,fail){
 const results=record?.results;
 if(!results||typeof results!=="object"||Array.isArray(results)&&results.length>100||
    !Array.isArray(results)&&Object.keys(results).length>100)fail("data-loss");
 const entries=Array.isArray(results)?results:Object.entries(results).map(([productId,row])=>({
   ...(row&&typeof row==="object"?row:{}),productId
 }));
 const out=Object.fromEntries(KEYS.map(k=>[k,0]));
 let total=0,excluded=0;
 for(const item of entries){
  if(!item||typeof item!=="object"||!Number.isSafeInteger(item.count)||
     item.count<0||item.count>9999)fail("data-loss");
  const k=mapCategory(item.productName);
  if(k)out[k]+=item.count;
  else excluded+=item.count;
  total+=item.count;
 }
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(excluded)||
    (record.totalCount!=null&&record.totalCount!==total))fail("data-loss");
 return {counts:out,total:total-excluded,excluded};
}
function partnerCounts(obj,fail){
 if(!obj||typeof obj!=="object"||Array.isArray(obj)||
   Object.keys(obj).sort().join("|")!==[...KEYS].sort().join("|"))fail("data-loss");
 const out={},values=KEYS.map(k=>{
  const n=obj[k];if(!Number.isSafeInteger(n)||n<0||n>9999)fail("data-loss");
  out[k]=n;return n;
 });
 const total=values.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(total))fail("data-loss");
 return {counts:out,total};
}
function assignRanks(rows,publicNames=false){
 const ordered=[...rows].sort((a,b)=>b.count-a.count||
  a.company.localeCompare(b.company,"ja")||a.name.localeCompare(b.name,"ja")||
  a.id.localeCompare(b.id));
 let rank=0,previous=null;
 return ordered.map((r,i)=>{
  if(previous!==r.count)rank=i+1;
  previous=r.count;
  // No person's count, revenue or price is included in any personal rank.
  return {rank,company:r.company,name:publicNames?r.name:
    r.visibility==="own"?r.name:r.company+" メンバー",source:r.source};
 });
}
function buildPublicRanking({date,scope,internal,partners,hideNames=false,fail}){
 if(!scope?.hubId||!Array.isArray(internal)||!Array.isArray(partners))fail("data-loss");
 const people=[],teams=new Map(),products=Object.fromEntries(KEYS.map(k=>[k,0]));
 let excludedProducts=0;
 const add=(cid,name,person,team,counts,source)=>{
  const total=Object.values(counts).reduce((n,v)=>n+v,0);
  if(!Number.isSafeInteger(total))fail("data-loss");
  const key=cid+"|"+team.key;
  if(!teams.has(key))teams.set(key,{name:team.name,company:name,count:0});
  teams.get(key).count+=total;
  for(const k of KEYS)products[k]+=counts[k];
  if(person&&total>0){
   let row=people.find(r=>r.id===cid+"|"+person.id);
   if(!row){row={id:cid+"|"+person.id,name:person.name,company:name,
     count:0,source,visibility:scope.kind==="hub"||scope.cid===cid?"own":"other"};people.push(row);}
   row.count+=total;
  }
 };
 for(const item of internal){
  const c=internalCounts(item,fail);
  excludedProducts+=c.excluded;
  const id=clean(item.uid);
  if(!ID.test(id)||item.date!==date||item.companyId!==scope.hubId)fail("data-loss");
  add(scope.hubId,"自社",{id,name:label(item.memberNameSnapshot,"自社スタッフ")},
   {key:ID.test(item.teamId||"")?item.teamId:"unknown",
    name:label(item.teamNameSnapshot,"自社｜班未照合")},c.counts,"internal");
 }
 for(const p of partners){
  if(!ID.test(p.id)||!clean(p.name)||MONEY.test(p.name))fail("data-loss");
  if(p.source==="staff"){
   if(!Array.isArray(p.entries))fail("data-loss");
   for(const e of p.entries){
    if(!ID.test(e.staffId||"")||e.companyId!==p.id||e.date!==date)fail("data-loss");
    const normalized=partnerCounts(e.counts,fail);
    if(e.totalCount!==normalized.total)fail("data-loss");
    const team=ID.test(e.teamIdSnapshot||"")?e.teamIdSnapshot:"unknown";
    add(p.id,p.name,{id:e.staffId,name:label(e.staffNameSnapshot,"協力店スタッフ")},
      {key:team,name:label(p.teamNames?.[team],p.name+"｜班未照合")},
      normalized.counts,"partner");
   }
  }else if(p.source==="quick"){
   const normalized=partnerCounts(p.counts,fail);
   if(p.totalCount!==normalized.total)fail("data-loss");
   // Company-only quick reports never introduce fictitious persons.
   add(p.id,p.name,null,{key:"quick-company",name:p.name+"｜会社報告"},
     normalized.counts,"quick");
  }else fail("data-loss");
 }
 const teamsSorted=[...teams.values()].sort((a,b)=>b.count-a.count||
   a.company.localeCompare(b.company,"ja")||a.name.localeCompare(b.name,"ja"));
 const productsSorted=Object.entries(products).map(([name,count])=>({name,count}))
  .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja"));
 return {date,period:"day",individual:assignRanks(people,!hideNames),
  products:productsSorted,teams:teamsSorted,excludedProducts,
  complete:excludedProducts===0,
  // Quick-only rows have no person attribution: we must never fabricate ranks.
  companyOnlyPartnerReports:partners.filter(p=>p.source==="quick").length};
}
async function readCombinedDailyRanking({db,scope,date,fail,grantRef,quickAllowed}){
 const hubId=scope.hubId;
 const hub=await db.collection("companies").doc(hubId).get();
 if(!hub.exists||hub.data()?.active!==true||hub.data()?.ownerUid==null||
    ![undefined,"internal","direct"].includes(hub.data()?.companyKind))fail();
 // Never return raw sales records; read only on the trusted server.
 const internalSnap=await db.collection("records")
  .where("companyId","==",hubId).where("date","==",date).limit(2001).get();
 if(internalSnap.size>2000)fail("resource-exhausted");
 const relations=await db.collection("partnerRelations").where("hubCompanyId","==",hubId)
  .limit(101).get();
 if(relations.size>100)fail("resource-exhausted");
 const partners=[];
 for(const r of relations.docs){
  if(!ID.test(r.id))fail("data-loss");
  const rel=r.data()||{};
  if(rel.partnerCompanyId!==r.id||rel.hubCompanyId!==hubId)fail("data-loss");
  const [cSnap,gSnap]=await Promise.all([
   db.collection("companies").doc(r.id).get(),grantRef(r.id).get()
  ]);
  const c=cSnap.data()||{};
  if(!cSnap.exists||c.companyKind!=="partner"||c.hubCompanyId!==hubId||
     c.active!==true||!ID.test(c.ownerUid||"")||!clean(c.name)||MONEY.test(c.name))
   continue;
  if(!quickAllowed(rel,gSnap.data()||{},r.id,hubId,hub.data().ownerUid,c.ownerUid))continue;
  const shared=await db.collection("companies").doc(hubId).collection("partnerWorkCountDays")
   .doc(date).collection("reports").doc(r.id).get();
  const sharedData=shared.data()||{};
  if(shared.exists&&sharedData.source==="staff-entries-v1"){
   if(sharedData.hubCompanyId!==hubId||sharedData.partnerCompanyId!==r.id||
     sharedData.date!==date)fail("data-loss");
   const col=db.collection("companies").doc(r.id);
   const [entriesSnap,teamsSnap]=await Promise.all([
    col.collection("partnerWorkEntries").where("date","==",date).limit(201).get(),
    col.collection("partnerWorkTeams").limit(151).get()
   ]);
   if(entriesSnap.size>200||teamsSnap.size>150)fail("resource-exhausted");
   const names={};
   for(const t of teamsSnap.docs){
    if(!ID.test(t.id)||t.data()?.companyId!==r.id)fail("data-loss");
    names[t.id]=label(t.data()?.name,c.name+"｜班");
   }
   const entries=entriesSnap.docs.map(sn=>sn.data()||{});
   const summed=Object.fromEntries(KEYS.map(k=>[k,0]));
   for(const e of entries){
    if(e.companyId!==r.id||e.hubCompanyId!==hubId)fail("data-loss");
    const checked=partnerCounts(e.counts,fail);
    for(const k of KEYS)summed[k]+=checked.counts[k];
   }
   const expected=partnerCounts(sharedData.counts,fail);
   if(expected.total!==sharedData.totalCount||
      KEYS.some(k=>expected.counts[k]!==summed[k]))fail("data-loss");
   partners.push({id:r.id,name:c.name,source:"staff",entries,teamNames:names});
  }else{
   // Do NOT add a quick-company report atop a staff-ledger report.
   const quick=await db.collection("companies").doc(hubId).collection("partnerQuickCountDays")
    .doc(date).collection("reports").doc(r.id).get();
   const d=quick.data()||{};
   if(!quick.exists)continue;
   if(d.hubCompanyId!==hubId||d.partnerCompanyId!==r.id||d.date!==date||
      !Number.isInteger(d.version)||d.version<1)fail("data-loss");
   const checked=partnerCounts(d.counts,fail);
   if(d.totalCount!==checked.total)fail("data-loss");
   partners.push({id:r.id,name:c.name,source:"quick",counts:checked.counts,
     totalCount:checked.total});
  }
 }
 return buildPublicRanking({date,scope,internal:internalSnap.docs.map(x=>x.data()||{}),
  partners,hideNames:scope.kind!=="hub",fail});
}
module.exports={KEYS,mapCategory,internalCounts,partnerCounts,assignRanks,
 buildPublicRanking,readCombinedDailyRanking};
