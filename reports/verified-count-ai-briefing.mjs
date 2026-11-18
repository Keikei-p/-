/**
 * OFFLINE ONLY. AI-ready count reporting from an ALREADY SERVER-VERIFIED
 * canonical partner-ranking response. No Firebase Admin, no line delivery, no
 * LLM/network calls, no raw sales documents, no new ledger. It can NEVER
 * authorize a browser payload: the future caller must run the existing
 * authenticated count-only ranking service first.
 *
 * Existing 9 categories (including old combined SB光・AIR) are used once.
 * Company-only historical reports contribute to company/product totals but
 * not to invented team/person attribution. Missing != submitted zero.
 */
const SCHEMA="nico-approved-partner-count-rank-v1";
const SCOPE="approved_partner_counts_only";
const ID=/^[a-zA-Z0-9_-]{1,128}$/;
const DAY=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
  "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const MONEY=/(?:売上|単価|原価|報酬|利益|価格|キャッシュバック|cash[\s_-]*back|revenue|unit[\s_-]*price|salary|commission|credit|iban|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円)|[\r\n\t@])/i;
const fail=()=>{throw Error("NICO_COUNT_AI_REPORT_SOURCE_UNVERIFIED");};
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const count=x=>{if(!Number.isSafeInteger(x)||x<0)fail();return x;};
const sum=(a,b)=>count(count(a)+count(b));
const label=x=>{
 if(typeof x!=="string"||!x.trim()||x.length>80||MONEY.test(x.normalize("NFKC")))fail();
 return x.trim();
};
const keys=(row,allowed,optional=[])=>{
 if(!isObject(row)||Object.keys(row).some(k=>!allowed.includes(k)&&!optional.includes(k)))fail();
 for(const k of allowed)if(!Object.hasOwn(row,k))fail();
};
const checkDate=x=>{
 if(typeof x!=="string"||!DAY.test(x))fail();
 const [y,m,d]=x.split("-").map(Number),t=new Date(Date.UTC(y,m-1,d));
 if(t.toISOString().slice(0,10)!==x)fail();
 return x;
};
function sameDayRange(start,end){
 checkDate(start);checkDate(end);
 const span=(Date.parse(end+"T00:00:00Z")-Date.parse(start+"T00:00:00Z"))/86400000;
 if(!Number.isInteger(span)||span<0||span>30)fail();
}
const array=(rows,max)=>{
 if(!Array.isArray(rows)||rows.length>max)fail();
 return rows;
};
const COUNT_ROW=(["key","name","totalCount","rank"]);
const COMPANY_KEYS=[...COUNT_ROW,"counts","reportedDays","peopleVerified","status"];
const TEAM_KEYS=[...COUNT_ROW,"counts","companyName","companyKey","reportedStaffCount"];
const PERSON_KEYS=[...COUNT_ROW,"counts","companyName","companyKey","teamKey","teamName"];
const PRODUCT_KEYS=[...COUNT_ROW];
const safeCounts=(obj,total)=>{
 if(!isObject(obj)||Object.keys(obj).some(k=>!KEYS.includes(k)))fail();
 let s=0;
 for(const [k,v] of Object.entries(obj)){if(!KEYS.includes(k))fail();s=sum(s,count(v));}
 if(s!==count(total))fail();
 return Object.freeze({...obj});
};
function rankedRows(rows,type){
 const permitted=type==="company"?COMPANY_KEYS:type==="team"?TEAM_KEYS:
  type==="person"?PERSON_KEYS:PRODUCT_KEYS;
 const entries=array(rows,type==="person"?500:type==="product"?9:150);
 let previous=null,previousRank=0;const seen=new Set();
 return Object.freeze(entries.map((v,i)=>{
  keys(v,permitted);
  if(!ID.test(v.key)||seen.has(v.key))fail();
  seen.add(v.key);
  const name=label(v.name),total=count(v.totalCount),rank=count(v.rank);
  const expectedRank=i===0||total!==previous?i+1:previousRank;
  if(rank!==expectedRank||(previous!==null&&total>previous))fail();
  previous=total;previousRank=rank;
  const row={name,totalCount:total,rank};
  if(type!=="product"){
   if(type==="company"){
    count(v.reportedDays);
    if(typeof v.peopleVerified!=="boolean"||
       !["submitted","historical_company_only"].includes(v.status))fail();
    row.reportedDays=v.reportedDays;
    row.status=v.status;
   }else{
    label(v.companyName);
    if(!ID.test(v.companyKey))fail();
    if(type==="team")row.reportedStaffCount=count(v.reportedStaffCount);
    if(type==="person"){
     if(v.teamKey!==null&&(typeof v.teamKey!=="string"||!ID.test(v.teamKey)))fail();
     label(v.teamName);
    }
   }
   safeCounts(v.counts,total);
  }
  return Object.freeze(row);
 }));
}
function validateUnreported(items){
 const seen=new Set();
 return Object.freeze(array(items,30).map(v=>{
  keys(v,["key","name","status"]);
  if(!ID.test(v.key)||seen.has(v.key)||v.status!=="not_reported")fail();
  seen.add(v.key);
  return Object.freeze({name:label(v.name),status:"not_reported"});
 }));
}
function verified(source){
 const required=["schema","scope","unit","includesDirect","fullyJoint",
  "start","end","companies","teams","people","products","totalCount",
  "reportCount","unreportedCompanies","partnerCountsComplete",
  "unverifiedTeamCount","unverifiedPersonCount","historicalCompanyOnlyCount",
  "peopleComplete","teamComplete"];
 keys(source,required,["role","period","date"]);
 if(source.schema!==SCHEMA||source.scope!==SCOPE||source.unit!=="件"||
   source.includesDirect!==false||source.fullyJoint!==false)fail();
 sameDayRange(source.start,source.end);
 if(source.role!==undefined&&!["hub","partner"].includes(source.role))fail();
 if(source.period!==undefined&&!["day","week","month"].includes(source.period))fail();
 if(source.date!==undefined)checkDate(source.date);
 const total=count(source.totalCount),reports=count(source.reportCount);
 const companies=rankedRows(source.companies,"company");
 const teams=rankedRows(source.teams,"team");
 const people=rankedRows(source.people,"person");
 const products=rankedRows(source.products,"product");
 const unreported=validateUnreported(source.unreportedCompanies);
 for(const property of ["partnerCountsComplete","peopleComplete","teamComplete"])
  if(typeof source[property]!=="boolean")fail();
 const incomplete={
  team:count(source.unverifiedTeamCount),
  person:count(source.unverifiedPersonCount),
  historical:count(source.historicalCompanyOnlyCount)
 };
 if(companies.reduce((n,r)=>sum(n,r.totalCount),0)!==total ||
    products.reduce((n,r)=>sum(n,r.totalCount),0)!==total ||
    teams.reduce((n,r)=>sum(n,r.totalCount),0)>total ||
    people.reduce((n,r)=>sum(n,r.totalCount),0)>total ||
    Object.values(incomplete).some(n=>n>total)||
    reports===0&&total!==0||
    source.partnerCountsComplete&&
     (unreported.length!==0||incomplete.historical!==0)||
    source.teamComplete&&(unreported.length!==0||
      incomplete.team!==0||incomplete.historical!==0)||
    source.peopleComplete&&(unreported.length!==0||
      incomplete.person!==0||incomplete.historical!==0))fail();
 return Object.freeze({start:source.start,end:source.end,total,reports,
  companies,teams,people,products,unreported,incomplete,
  complete:source.partnerCountsComplete===true,
  teamComplete:source.teamComplete===true,
  peopleComplete:source.peopleComplete===true,
  role:source.role??null});
}

const compact=rows=>rows.slice(0,3).map(r=>r.name+" "+r.totalCount+"件").join("、");
export function buildVerifiedPartnerCountBriefing(snapshot,{title="協力店 件数レポート"}={}){
 const src=verified(snapshot);
 const headline=label(title);
 const partial=!src.complete||!src.peopleComplete||!src.teamComplete;
 const notes=[];
 if(src.reports===0)notes.push("この期間は報告済みデータがありません。0件報告とは区別してください。");
 else notes.push("集計期間内の確認済み件数："+src.total+"件、報告済み日報："+src.reports+"件。");
 if(src.products.length)notes.push("商材別（上位）："+compact(src.products)+"。");
 if(src.companies.length)notes.push("会社別（上位）："+compact(src.companies)+"。");
 if(src.teamComplete&&src.teams.length)
  notes.push("班別（上位）："+compact(src.teams)+"。");
 else if(!src.teamComplete)
  notes.push("班の特定ができない旧実績があるため、班別順位は確定扱いしません。");
 if(src.peopleComplete&&src.people.length)
  notes.push("個人別（上位）："+compact(src.people)+"。");
 else if(!src.peopleComplete)
  notes.push("担当者が不明な旧実績があるため、個人順位は確定扱いしません。");
 if(src.unreported.length)
  notes.push("未報告の会社："+src.unreported.map(x=>x.name).join("、")+"。");
 if(src.incomplete.historical)
  notes.push("過去の会社単位実績："+src.incomplete.historical+
   "件は元のまま保持しています。班・個人へ推定配分しません。");
 if(partial)notes.push("【一部未確定】報告未提出や旧実績の未割当を含むため、全社確定順位と誤認しないでください。");
 const text=[headline,src.start===src.end?src.start:src.start+"〜"+src.end,
  "対象：協力店の公開許可された件数のみ","",...notes].join("\n");
 if(text.length>4200||MONEY.test(text))fail();
 return Object.freeze({schema:"nico-reviewed-count-briefing-v1",
  periodStart:src.start,periodEnd:src.end,scope:"partner-counts-only",
  reportStatus:partial?"incomplete":"verified",
  reportCount:src.reports,totalCount:src.total,
  historicalCompanyOnlyCount:src.incomplete.historical,
  unknownTeamCount:src.incomplete.team,
  unknownPersonCount:src.incomplete.person,
  unreportedCompanyCount:src.unreported.length,
  content:text,
  deliveryEnabled:false,aiModelInvoked:false,rawSourceWrites:0});
}
/**
 * Data minimization ahead of a future OPTIONAL language model. This is the
 * only object allowed to leave a trusted server; it contains no names, raw
 * entries, company IDs, staff IDs, prices, contacts or record metadata.
 */
export function prepareCountOnlyAiModelInput(snapshot){
 const src=verified(snapshot);
 return Object.freeze({schema:"nico-ai-safe-count-brief-v1",
  start:src.start,end:src.end,totalCount:src.total,
  reportedDays:src.reports,completeness:src.complete&&src.teamComplete&&src.peopleComplete,
  missingCompanyCount:src.unreported.length,
  historicalUnassignedCount:src.incomplete.historical,
  categoryTotals:Object.freeze(src.products.map(p=>Object.freeze({
   category:p.name,count:p.totalCount
  }))),
  instruction:"数字の事実のみ。金額・単価・個人情報・推定・未確認の比較・架空の順位を含めない。"
 });
}
/** Preview-only schedules. No cron dispatch, LINE send, Firestore write. */
export function createCountAutoReportPlan({enabled=false,channels=[]}={}){
 if(enabled!==false||!Array.isArray(channels)||channels.length!==0)fail();
 return Object.freeze({
  status:"DESIGN_ONLY_DISABLED",timeZone:"Asia/Tokyo",
  notifications:Object.freeze([
   {kind:"morning",hour:"09:30",source:"count-only"},
   {kind:"missing",hour:"19:05",source:"verified missing status only"},
   {kind:"final",hour:"21:00",source:"count-only"},
   {kind:"weekly",day:"Sunday",hour:"20:00",source:"count-only"}
  ]),
  sendEnabled:false,firestoreWrites:0,modelCalls:0,paidServicesEnabled:false
 });
}
