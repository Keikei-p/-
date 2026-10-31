/**
 * Offline, finance-free dashboard projection for the verified monthly count
 * bridge. NOT imported by the production owner/sales index.
 *
 * Only canonical product IDs and saved team snapshots are aggregated.
 * Company/member records never carry money into this public UI model.
 * Personal rankings expose rank + display name ONLY, never a person's score.
 */
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY=/(?:[¥￥$€]|(?:[0-9０-９][0-9０-９,.，]*\s*(?:万|千)?円)|売上|単価|キャッシュバック|収益|報酬|利益|(?:CB|cashback|revenue|unitprice|commission)[\s:_=-]*(?:[0-9０-９]))/i;
const forbid=reason=>{throw Error("secure_count_dashboard_"+reason);};
const validId=v=>typeof v==="string"&&ID.test(v);
const safeNumber=n=>Number.isSafeInteger(n)&&n>=0;
function add(a,b){if(!safeNumber(a)||!safeNumber(b)||!safeNumber(a+b))forbid("overflow");return a+b;}
function safeLabel(value){
 if(typeof value!=="string"||value.length>100||MONEY.test(value)||
    /[\x00-\x1f\x7f]/.test(value))forbid("unsafe_label");
 return value.trim();
}
const obj=x=>x&&typeof x==="object"&&!Array.isArray(x);
const keys=x=>Object.keys(x).sort().join(",");
const RECORD="companyId,date,memberNameSnapshot,reportStatus,sourceId,teamId,teamNameSnapshot,totalCount,uid,workLocation".split(",").sort().join(",");
const LINE="companyId,count,date,productId,recordId,sourceId,teamId,uid".split(",").sort().join(",");
const PRODUCT="active,companyId,name,sortOrder,sourceId".split(",").sort().join(",");
function ranks(scores){
 const ordered=[...scores].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,"ja")||a.id.localeCompare(b.id));
 let rank=0;
 return ordered.map((item,i)=>{
  if(i===0||item.score!==ordered[i-1].score)rank=i+1;
  return Object.freeze({name:item.name,rank,champion:rank===1&&item.score>0});
 });
}
export function buildVerifiedInternalCountDashboard(monthData){
 if(!obj(monthData)||monthData.complete!==true||
    monthData.snapshotScope!=="per_day"||!MONTH.test(monthData.month||"")||
    !validId(monthData.companyId)||!safeNumber(monthData.totalCount)||
    !safeNumber(monthData.daysVerified)||monthData.daysVerified<28||
    monthData.daysVerified>31||
    !Array.isArray(monthData.records)||!Array.isArray(monthData.lines)||
    !Array.isArray(monthData.products))forbid("incomplete_month");
 const [year,month]=monthData.month.split("-").map(Number);
 const calendarDays=new Date(Date.UTC(year,month,0)).getUTCDate();
 if(monthData.daysVerified!==calendarDays||
    !obj(monthData.dailyReadTimes)||
    Object.keys(monthData.dailyReadTimes).length!==calendarDays)forbid("incomplete_days");
 for(let i=1;i<=calendarDays;i++){
  const date=monthData.month+"-"+String(i).padStart(2,"0");
  if(typeof monthData.dailyReadTimes[date]!=="string"||
     !/^\d{4}-\d\d-\d\dT/.test(monthData.dailyReadTimes[date]))
   forbid("day_snapshot_missing");
 }
 const catalog=new Map(),teams=new Map(),members=new Map(),products=new Map();
 let total=0,linesTotal=0;
 for(const p of monthData.products){
  if(!obj(p)||keys(p)!==PRODUCT||!validId(p.sourceId)||
     p.companyId!==monthData.companyId||
     typeof p.active!=="boolean"||!Number.isSafeInteger(p.sortOrder)||
     catalog.has(p.sourceId))forbid("catalog");
  const name=safeLabel(p.name);
  catalog.set(p.sourceId,name);
  products.set(p.sourceId,{id:p.sourceId,name,count:0});
 }
 const records=new Map();
 for(const r of monthData.records){
  if(!obj(r)||keys(r)!==RECORD||!validId(r.sourceId)||
     records.has(r.sourceId)||r.companyId!==monthData.companyId||
     !validId(r.uid)||!validId(r.teamId)||
     typeof r.date!=="string"||!r.date.startsWith(monthData.month+"-")||
     !Object.hasOwn(monthData.dailyReadTimes,r.date)||
     !safeNumber(r.totalCount)||!["submitted","no_result"].includes(r.reportStatus)||
     r.reportStatus==="no_result"&&r.totalCount!==0)
   forbid("record");
  const person=safeLabel(r.memberNameSnapshot||"担当者");
  const team=safeLabel(r.teamNameSnapshot||"過去所属班");
  safeLabel(r.workLocation||"");
  if(!person||!team)forbid("empty_label");
  const stored=members.get(r.uid);
  if(stored&&stored.name!==person)forbid("identity_snapshot_changed");
  if(!stored)members.set(r.uid,{id:r.uid,name:person,score:0});
  const byTeam=teams.get(r.teamId);
  if(byTeam&&byTeam.name!==team)forbid("team_name_conflict");
  if(!byTeam)teams.set(r.teamId,{id:r.teamId,name:team,count:0});
  const teamValue=teams.get(r.teamId);
  teamValue.count=add(teamValue.count,r.totalCount);
  members.get(r.uid).score=add(members.get(r.uid).score,r.totalCount);
  total=add(total,r.totalCount);
  records.set(r.sourceId,{row:r,lineSum:0});
 }
 const lineIDs=new Set();
 for(const l of monthData.lines){
  if(!obj(l)||keys(l)!==LINE||!validId(l.sourceId)||
     lineIDs.has(l.sourceId)||!validId(l.recordId)||
     !catalog.has(l.productId)||!safeNumber(l.count)||
     l.companyId!==monthData.companyId)forbid("line");
  const parent=records.get(l.recordId);
  if(!parent||l.uid!==parent.row.uid||
     l.teamId!==parent.row.teamId||l.date!==parent.row.date)forbid("line_scope");
  lineIDs.add(l.sourceId);
  parent.lineSum=add(parent.lineSum,l.count);
  const product=products.get(l.productId);
  product.count=add(product.count,l.count);
  linesTotal=add(linesTotal,l.count);
 }
 for(const parent of records.values())
  if(parent.lineSum!==parent.row.totalCount)forbid("record_total_mismatch");
 if(total!==monthData.totalCount||total!==linesTotal)forbid("month_total_mismatch");
 const teamRows=[...teams.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja"))
   .map(({id,name,count})=>Object.freeze({name,count}));
 const productRows=[...products.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja"))
   .map(({id,name,count})=>Object.freeze({name,count}));
 // Intentionally no UID or per-person counts/revenue in this result.
 const result=Object.freeze({
  month:monthData.month,companyCount:total,dayCount:calendarDays,
  teamCounts:Object.freeze(teamRows),productCounts:Object.freeze(productRows),
  individualRanks:Object.freeze(ranks([...members.values()]))
 });
 if(MONEY.test(JSON.stringify(result)))forbid("money_payload");
 return result;
}
