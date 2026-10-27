/**
 * Company-wide monthly COUNT ranking, from one canonical records collection.
 * Never include unit prices, sales, or financial totals in the response.
 * All valid teams (direct and partner) are treated identically.
 */
export function buildCompanyCountRanking(records,companyId,month){
  if(!Array.isArray(records)||typeof companyId!=="string"||
      !/^\\d{4}-\\d{2}$/.test(month))throw Error("invalid_count_ranking_request");
  const teams=new Map(),daily=new Set();
  for(const record of records){
    if(record.companyId!==companyId || !String(record.date||"").startsWith(month+"-"))continue;
    if(!record.uid || !record.teamId || !Number.isSafeInteger(record.totalCount) || record.totalCount<0)
      throw Error("invalid_count_ranking_record");
    const unique=record.uid+"/"+record.date;
    if(daily.has(unique))throw Error("duplicate_daily_record_requires_owner_review");
    daily.add(unique);
    const current=teams.get(record.teamId)||{teamId:record.teamId,totalCount:0,reportedMembers:0};
    current.totalCount+=record.totalCount;
    current.reportedMembers++;
    if(!Number.isSafeInteger(current.totalCount))throw Error("invalid_count_ranking_sum");
    teams.set(record.teamId,current);
  }
  const ranking=[...teams.values()].sort((a,b)=>b.totalCount-a.totalCount || a.teamId.localeCompare(b.teamId,"ja"))
    .map((r,i)=>({...r,rank:i+1}));
  return {month,totalCount:ranking.reduce((sum,r)=>sum+r.totalCount,0),ranking};
}
