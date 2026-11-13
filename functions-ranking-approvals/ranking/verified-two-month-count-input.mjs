/**
 * Staging / NO DEPLOY. Merge two independently complete canonical MONTH inputs
 * created by the SAME read-only Firestore transaction. This is not a sum of
 * monthly leaderboard totals: only original count-only record/line headers
 * may be joined. Any ambiguous identity, schema, mapping or timestamp fails.
 */
import {auditNoFinancialKeys} from "../security/public-projection.mjs";

const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DATE=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const reject=()=>{throw Error("VERIFIED_TWO_MONTH_COUNTS_UNVERIFIED");};
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// A syntactically shaped date such as 2026-11-31 is not an actual calendar day.
const validDay=x=>{
 if(typeof x!=="string"||!DATE.test(x))return false;
 const [y,m,d]=x.split("-").map(Number),day=new Date(0);
 day.setUTCHours(0,0,0,0);day.setUTCFullYear(y,m-1,d);
 return day.getUTCFullYear()===y&&day.getUTCMonth()+1===m&&day.getUTCDate()===d;
};
const validReadTime=x=>typeof x==="string"&&TIME.test(x)&&
 validDay(x.slice(0,10))&&Number.isFinite(Date.parse(x));
function monthDistance(a,b){
 if(!MONTH.test(a)||!MONTH.test(b)||a===b)reject();
 const [ay,am]=a.split("-").map(Number),[by,bm]=b.split("-").map(Number);
 if(Math.abs((ay*12+am)-(by*12+bm))!==1)reject();
}
function sorted(rows,field){
 if(!Array.isArray(rows))reject();
 const values=new Map();
 for(const row of rows){
  const id=row?.[field];
  if(typeof id!=="string"||!id||values.has(id))reject();
  values.set(id,row);
 }
 return values;
}
function mergeRows(left,right,field,monthA,monthB,identity=false){
 const prior=sorted(left,field),next=sorted(right,field);
 for(const [id,row] of next){
  if(!prior.has(id)){prior.set(id,row);continue;}
  // Canonical roster, team, product and SKU metadata must be read from
  // one consistent snapshot. Never guess which renamed member is correct.
  if(!identity||!same(prior.get(id),row))reject();
 }
 if(!identity){
  for(const r of left)if(!validDay(r.date)||
   r.date.slice(0,7)!==monthA)reject();
  for(const r of right)if(!validDay(r.date)||
   r.date.slice(0,7)!==monthB)reject();
 }
 return [...prior.values()];
}
function sameInputBase(a,b){
 if(!plain(a)||!plain(b)||!plain(a.period)||!plain(b.period)||
    a.period.kind!=="month"||b.period.kind!=="month"||
    !MONTH.test(a.period.day?.slice(0,7)??"")||
    !MONTH.test(b.period.day?.slice(0,7)??"")||
    a.period.day!==a.period.day.slice(0,7)+"-01"||
    b.period.day!==b.period.day.slice(0,7)+"-01"||
    !validDay(a.period.asOf)||!validDay(b.period.asOf)||
    a.period.asOf.slice(0,7)!==a.period.day.slice(0,7)||
    b.period.asOf.slice(0,7)!==b.period.day.slice(0,7)||
    a.hubCompanyId!==b.hubCompanyId||
    a.mappingsReviewed!==true||b.mappingsReviewed!==true||
    !validReadTime(a.snapshotReadTime)||
    a.snapshotReadTime!==b.snapshotReadTime||
    !Array.isArray(a.approvedCompanyIds)||!Array.isArray(b.approvedCompanyIds)||
    !same(a.approvedCompanyIds,b.approvedCompanyIds)||
    !same(a.productGroups,b.productGroups)||
    !same(a.unassigned,b.unassigned)||!same(a.personGoals,b.personGoals)||
    !same(a.historicalBest,b.historicalBest)||
    !Array.isArray(a.sources)||!Array.isArray(b.sources)||
    a.sources.length!==a.approvedCompanyIds.length||
    b.sources.length!==b.approvedCompanyIds.length)reject();
}
/**
 * Returns a canonical input (not a response) for further server-side owner
 * publication and mapping checks. Caller must verify that BOTH months were
 * loaded in exactly the same outer transaction, not two separate reads.
 */
export function mergeVerifiedTwoMonthInputs({primary,secondary}={}){
 sameInputBase(primary,secondary);
 const first=primary.period.day.slice(0,7),second=secondary.period.day.slice(0,7);
 monthDistance(first,second);
 const byCompany=sorted(secondary.sources,"companyId");
 const sources=primary.sources.map(a=>{
  const b=byCompany.get(a.companyId);
  if(!b||a.readTime!==primary.snapshotReadTime||
     b.readTime!==primary.snapshotReadTime||
     a.kind!==b.kind||a.companyLabel!==b.companyLabel||
     a.consentVerified!==true||b.consentVerified!==true||
     a.isComplete!==true||b.isComplete!==true||
     a.completeWindows?.current!==true||b.completeWindows?.current!==true)
   reject();
  // Teams and SKUs are trusted metadata; they must remain unchanged between
  // reads at the exact same snapshot. Roster may be empty in either month.
  if(!same(a.teams,b.teams)||!same(a.products,b.products))reject();
  // Never allow a foreign-company row to be attributed to this source.
  // A cross-company sourceId collision must not silently affect rankings.
  for(const row of [...(a.records??[]),...(b.records??[]),
                    ...(a.lines??[]),...(b.lines??[])]){
   if(row?.companyId!==a.companyId)reject();
  }
  const roster=mergeRows(a.roster,b.roster,"uid",first,second,true);
  return {...a,roster,
   records:mergeRows(a.records,b.records,"sourceId",first,second),
   lines:mergeRows(a.lines,b.lines,"sourceId",first,second),
   completeWindows:{current:true,previous:true}};
 });
 if(byCompany.size!==sources.length||
    sources.some(s=>!primary.approvedCompanyIds.includes(s.companyId)))reject();
 const result={...primary,sources,period:{...primary.period,
  asOf:primary.period.asOf>secondary.period.asOf?
   primary.period.asOf:secondary.period.asOf}};
 auditNoFinancialKeys(result);
 return result;
}
