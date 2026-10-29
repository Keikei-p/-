/**
 * OFFLINE / SERVER-SIDE STAGING ONLY. Pure read-only monthly aggregation.
 * No Firebase, database write, deployment, or network code.
 * This does not certify a complete server snapshot or authorize publication.
 * Count-only and private financial summaries require physically separated
 * collections and server-side, per-team / per-role access checks.
 */
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const DAY=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const fail=code=>{throw Error('monthly_aggregate_'+code);};
const validId=x=>typeof x==='string'&&ID.test(x);
function number(x,label){
  if(!Number.isSafeInteger(x)||x<0)fail(label);
  return x;
}
function add(a,b,label){
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<0||!Number.isSafeInteger(a+b))fail(label);
  return a+b;
}
function multiply(a,b,label){
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<0||!Number.isSafeInteger(a*b))fail(label);
  return a*b;
}
function validDay(x,month){
  if(typeof x!=='string'||!DAY.test(x)||!x.startsWith(month+'-'))fail('date');
  const [y,m,d]=x.split('-').map(Number),check=new Date(0);
  check.setUTCHours(0,0,0,0);check.setUTCFullYear(y,m-1,d);
  if(check.getUTCFullYear()!==y||check.getUTCMonth()+1!==m||check.getUTCDate()!==d)fail('date');
}
function accumulate(map,id,count,revenue){
  const item=map.get(id)||{id,count:0,revenue:0};
  item.count=add(item.count,count,'count_overflow');
  item.revenue=add(item.revenue,revenue,'revenue_overflow');
  map.set(id,item);
}
function sorted(map){return [...map.values()].sort((a,b)=>a.id.localeCompare(b.id));}
/**
 * Input must be supplied by a trusted server from one verified snapshot.
 * Still returns PREVIEW_ONLY_NOT_PUBLISHABLE: no completeness attestation here.
 */
export function previewMonthlyAggregates({companyId,month,records}={}){
  if(!validId(companyId))fail('company');
  if(typeof month!=='string'||!MONTH.test(month))fail('month');
  if(!Array.isArray(records)||records.length>250000)fail('source');
  const seen=new Set(),teams=new Map(),people=new Map(),products=new Map();
  let totalCount=0,totalRevenue=0;
  for(const row of records){
    if(!row||typeof row!=='object'||!validId(row.id)||seen.has(row.id))fail('record_id');
    seen.add(row.id);
    if(row.companyId!==companyId)fail('foreign_company');
    validDay(row.date,month);
    if(!validId(row.uid)||!validId(row.teamId))fail('identity');
    if(!row.results||typeof row.results!=='object'||Array.isArray(row.results))fail('results');
    let count=0,revenue=0;
    for(const [key,line] of Object.entries(row.results)){
      if(!validId(key)||!line||typeof line!=='object'||Array.isArray(line))fail('line');
      // Result keys can contain CB plan details. Never serialize those keys.
      if(!validId(line.productId))fail('product_id');
      const n=number(line.count,'line_count'),unit=number(line.revenuePerUnit,'unverified_unit_price');
      const money=multiply(n,unit,'amount_overflow');
      count=add(count,n,'count_overflow');
      revenue=add(revenue,money,'revenue_overflow');
      accumulate(products,line.productId,n,money);
    }
    if(number(row.totalCount,'saved_count')!==count)fail('count_mismatch');
    if(number(row.totalRevenue,'saved_revenue')!==revenue)fail('revenue_mismatch');
    totalCount=add(totalCount,count,'count_overflow');
    totalRevenue=add(totalRevenue,revenue,'revenue_overflow');
    accumulate(teams,row.teamId,count,revenue);
    accumulate(people,row.uid,count,revenue);
  }
  return {
    status:'PREVIEW_ONLY_NOT_PUBLISHABLE',verifiedComplete:false,
    // Server must store each per-team result in a separately authorized
    // count-only document, never give all-team results to any partner by default.
    countOnly:{companyId,month,recordCount:seen.size,totalCount,
      byTeam:sorted(teams).map(x=>({teamId:x.id,totalCount:x.count}))},
    // Owner-only; do not return to a client via a count-only endpoint.
    privateFinance:{companyId,month,recordCount:seen.size,totalCount,
      totalRevenue,byTeam:sorted(teams).map(x=>({...x})),
      byMember:sorted(people).map(x=>({...x})),
      byProduct:sorted(products).map(x=>({...x}))}
  };
}
