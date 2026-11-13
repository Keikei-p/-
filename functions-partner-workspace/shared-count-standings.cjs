"use strict";
// Read-only ranking projection. Never returns raw entries, finance, user IDs,
// cashback tiers, private products, email or writer/audit metadata.
const crypto=require("node:crypto");
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/,DAY=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONEY=/(?:単価|売上|収益|利益|報酬|原価|価格|キャッシュバック|cash\s*back|revenue|unit\s*price|commission|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9][0-9,.]*\s*(?:万|千)?円|[\r\n\t@])/i;
const fail=()=>{throw Error("PARTNER_RANK_SNAPSHOT_UNVERIFIED")};
const id=x=>typeof x==="string"&&ID.test(x)&&!["__proto__","constructor","prototype"].includes(x);
const name=x=>typeof x==="string"&&x.trim()&&x.length<=80&&!MONEY.test(x.normalize("NFKC"))?x.trim():fail();
const n=x=>Number.isSafeInteger(x)&&x>=0?x:fail();
const sum=(a,b)=>n(n(a)+n(b));
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const key=(kind,cid,s)=>crypto.createHash("sha256").update(kind+"\n"+cid+"\n"+s).digest("hex");
function date(x){
 if(typeof x!=="string"||!DAY.test(x))return false;
 const [y,m,d]=x.split("-").map(Number),v=new Date(0);
 v.setUTCHours(0,0,0,0);v.setUTCFullYear(y,m-1,d);
 return v.getUTCFullYear()===y&&v.getUTCMonth()+1===m&&v.getUTCDate()===d;
}
function counts(x,limit=9999){
 if(!x||typeof x!=="object"||Array.isArray(x)||
    Object.keys(x).sort().join("|")!==[...KEYS].sort().join("|"))fail();
 let total=0;const out=zero();
 for(const k of KEYS){
  if(!Number.isSafeInteger(x[k])||x[k]<0||x[k]>limit)fail();
  out[k]=x[k];total=sum(total,x[k]);
 }
 return {counts:out,total};
}
function ranked(rows){
 let old=null,r=0;
 return rows.slice().sort((a,b)=>b.totalCount-a.totalCount||
  a.name.localeCompare(b.name,"ja")||a.key.localeCompare(b.key)).map((v,i)=>{
   if(i===0||v.totalCount!==old)r=i+1;
   old=v.totalCount;return {...v,rank:r};
  });
}
function buildApprovedPartnerCountStandings({hubId,start,end,sources}={}){
 // A calendar week can cross month boundaries. Never broaden the range
 // beyond the existing 31-day monthly ledger read/verification budget.
 const span=date(start)&&date(end)?
  (Date.parse(end+"T00:00:00Z")-Date.parse(start+"T00:00:00Z"))/86400000:NaN;
 if(!id(hubId)||!Number.isInteger(span)||span<0||span>30||
    !Array.isArray(sources)||!sources.length||sources.length>20)fail();
 const seen=new Set(),companies=[],teams=[],people=[],products=zero(),published=new Set(),unreportedCompanies=[];
 let totalCount=0,reportCount=0,unverifiedTeamCount=0,
  unverifiedPersonCount=0,historicalCompanyOnlyCount=0;
 // Missing attribution is still missing for a VERIFIED zero-count entry.
 let missingTeamIdentity=false,missingPersonIdentity=false;
 for(const s of sources){
  if(!s||!id(s.cid)||s.cid===hubId||seen.has(s.cid)||
     s.approved!==true||!Array.isArray(s.teams)||
     !Array.isArray(s.entries)||!Array.isArray(s.reports)||
      s.teams.length>150||s.entries.length>1000||s.reports.length>31||
     !Array.isArray(s.allowedCategories)||s.allowedCategories.length>KEYS.length||
     new Set(s.allowedCategories).size!==s.allowedCategories.length||
     s.allowedCategories.some(k=>!KEYS.includes(k)))fail();
  seen.add(s.cid);
  const allowed=new Set(s.allowedCategories);
  // OFF categories are private even in metadata. Retain all originals.
  if(!allowed.size)continue;
  for(const k of allowed)published.add(k);
  const visible=raw=>({counts:Object.fromEntries(KEYS.map(k=>[k,allowed.has(k)?raw.counts[k]:0])),
   total:KEYS.reduce((a,k)=>sum(a,allowed.has(k)?raw.counts[k]:0),0)});
  const companyName=name(s.name),companyKey=key("company",hubId,s.cid),teamNames=new Map(),pMap=new Map(),
   tMap=new Map(),entries=new Map(),reports=new Set();
  for(const t of s.teams){
   if(!t||!id(t.id)||teamNames.has(t.id))fail();
   teamNames.set(t.id,name(t.name));
  }
  for(const {id:docId,data:e} of s.entries){
   if(!id(docId)||!e||e.companyId!==s.cid||e.hubCompanyId!==hubId||
      !date(e.date)||e.date<start||e.date>end||
      !id(e.staffId)||docId!==e.date+"__"+e.staffId||
      !Number.isSafeInteger(e.version)||e.version<1||e.version>999)fail();
   const personDay=e.date+"__"+e.staffId;
   if(entries.has(personDay))fail();
   entries.set(personDay,e);
   const raw=counts(e.counts);
   if(raw.total!==e.totalCount)fail();
   const c=visible(raw);
   const tid=id(e.teamIdSnapshot)&&teamNames.has(e.teamIdSnapshot)?e.teamIdSnapshot:null;
   const personName=e.staffNameSnapshot==null?null:name(e.staffNameSnapshot);
   if(tid){
    const k=key("team",s.cid,tid);
    const t=tMap.get(k)||{key:k,name:teamNames.get(tid),companyName,companyKey,totalCount:0,
     counts:zero(),reportedStaffCount:0};
    t.reportedStaffCount++;
    t.totalCount=sum(t.totalCount,c.total);
    for(const p of KEYS)t.counts[p]=sum(t.counts[p],c.counts[p]);
    tMap.set(k,t);
   }else{
    missingTeamIdentity=true;
    unverifiedTeamCount=sum(unverifiedTeamCount,c.total);
   }
   if(personName){
    const k=key("person",s.cid,e.staffId),tk=tid?key("team",s.cid,tid):null;
    const p=pMap.get(k)||{key:k,name:personName,companyName,companyKey,totalCount:0,
     counts:zero(),teamKey:tk,teamName:tid?teamNames.get(tid):"所属班未確認"};
    if(p.teamKey!==tk){p.teamKey=null;p.teamName="複数班・所属未確認";}
    p.totalCount=sum(p.totalCount,c.total);
    for(const product of KEYS)p.counts[product]=sum(p.counts[product],c.counts[product]);
    pMap.set(k,p);
   }else{
    missingPersonIdentity=true;
    unverifiedPersonCount=sum(unverifiedPersonCount,c.total);
   }
  }
  let companyCount=0,reportedDays=0,verifiedPeople=!missingPersonIdentity;
  const companyProducts=zero();
  for(const r of s.reports){
   if(!r||!date(r.date)||r.date<start||r.date>end||reports.has(r.date))fail();
   reports.add(r.date);
   // A missing daily summary cannot authorize any staff row, even a zero-count row.
   // Otherwise orphan entries could appear in team/person ranks while company totals stay zero.
   if(r.data==null){
    if([...entries.values()].some(e=>e.date===r.date))fail();
    continue;
   }
   const x=r.data;
   if(!x||x.hubCompanyId!==hubId||x.partnerCompanyId!==s.cid||
      x.date!==r.date||!["staff-entries-v1","quick-counts-v1","quick-counts"].includes(x.source))fail();
   const raw=counts(x.counts,Number.MAX_SAFE_INTEGER);
   if(raw.total!==x.totalCount)fail();
   const c=visible(raw);
   const daily=zero();let recorded=0,rows=0;
   for(const e of entries.values())if(e.date===r.date){
    rows++;const v=counts(e.counts);recorded=sum(recorded,v.total);
    for(const product of KEYS)daily[product]=sum(daily[product],v.counts[product]);
   }
   if(x.source==="staff-entries-v1"){
    // A zero summary without a staff report is NOT evidence of a 0 report.
    if(rows===0||recorded!==raw.total||
       KEYS.some(k=>daily[k]!==raw.counts[k]))fail();
   }else{
    if(rows)fail();
    verifiedPeople=false;
    historicalCompanyOnlyCount=sum(historicalCompanyOnlyCount,c.total);
   }
   companyCount=sum(companyCount,c.total);reportedDays++;reportCount++;
   for(const k of KEYS)companyProducts[k]=sum(companyProducts[k],c.counts[k]);
  }
  if([...entries.values()].some(e=>!reports.has(e.date)))fail();
  totalCount=sum(totalCount,companyCount);
  if(!reportedDays)unreportedCompanies.push({key:key("company",hubId,s.cid),name:companyName,status:"not_reported"});
  const safeCounts=raw=>Object.fromEntries(s.allowedCategories.map(k=>[k,raw[k]]));
  if(reportedDays&&allowed.size){
   companies.push({key:companyKey,name:companyName,
    totalCount:companyCount,counts:safeCounts(companyProducts),reportedDays,
    peopleVerified:verifiedPeople,
    status:verifiedPeople?"submitted":"historical_company_only"});
   for(const k of KEYS)products[k]=sum(products[k],companyProducts[k]);
  }
  // An entirely OFF partner has no published products: do not expose
  // person/team names as zero-ranked rows. A genuinely submitted zero for
  // an ON category remains visible and distinct from an unreported day.
  if(allowed.size){
   teams.push(...[...tMap.values()].map(x=>({...x,counts:safeCounts(x.counts)})));
   people.push(...[...pMap.values()].map(x=>({...x,counts:safeCounts(x.counts)})));
  }
 }
 return {schema:"nico-approved-partner-count-rank-v1",unit:"件",
  scope:"approved_partner_counts_only",includesDirect:false,fullyJoint:false,
  start,end,companies:ranked(companies),teams:ranked(teams),people:ranked(people),
  // Stable product IDs must not shift when earlier categories turn OFF.
  products:ranked(KEYS.flatMap((k,i)=>published.has(k)?
   [{key:"product-"+(i+1),name:k,totalCount:products[k]}]:[])),
  totalCount,reportCount,unreportedCompanies,
  partnerCountsComplete:unreportedCompanies.length===0&&historicalCompanyOnlyCount===0,
  unverifiedTeamCount,unverifiedPersonCount,
  historicalCompanyOnlyCount,
  peopleComplete:unreportedCompanies.length===0&&
   historicalCompanyOnlyCount===0&&unverifiedPersonCount===0&&
   !missingPersonIdentity,
  teamComplete:unreportedCompanies.length===0&&
   historicalCompanyOnlyCount===0&&unverifiedTeamCount===0&&
   !missingTeamIdentity};
}
module.exports={buildApprovedPartnerCountStandings,KEYS};
