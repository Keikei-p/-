/** Private employee leaderboard: financial numbers never cross the response boundary.
 * Based on CURRENT approved product tariffs like the existing dashboard. If
 * legacy/snapshot pricing cannot be proved, fail instead of inventing ranks.
 */
import {securePricing} from "./write-plan.js";
const idOk=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,150}$/.test(v);
export function rankingAccess(policy,grant){
 if(!policy?.companyId||!policy.uid||policy.isPartner)return false;
 if(policy.isOwner)return true;
 return !!grant&&grant.companyId===policy.companyId&&grant.uid===policy.uid&&grant.allowed===true;
}
export function validateViewerChange(policy,viewer,uid,allowed){
 if(!policy?.isOwner || policy.isPartner || !idOk(policy.companyId) ||
    !idOk(uid) || typeof allowed!=="boolean" || !viewer ||
    viewer.uid!==uid || (viewer.companyId && viewer.companyId!==policy.companyId) ||
    viewer.active===false || viewer.accessKind==="partner" ||
    viewer.companyRole!=="member" || viewer.hasAccount===false ||
    viewer.memberType==="managed")throw Error("ranking_viewer_forbidden");
 return {companyId:policy.companyId,uid,allowed};
}
export function buildPrivateRevenueRanking(records,products,members,companyId,month){
 if(!idOk(companyId)||typeof month!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||
    !Array.isArray(records)||!Array.isArray(products)||!Array.isArray(members))
    throw Error("invalid_ranking_request");
 const directory=new Map(members.filter(m=>m && (!m.companyId || m.companyId===companyId) && m.active!==false &&
     m.accessKind!=="partner" && idOk(m.uid) && m.name).map(m=>[m.uid,m]));
 const catalog=new Map(products.filter(p=>p.companyId===companyId).map(p=>[p.id,p]));
 const values=new Map(), seenDaily=new Set();
 for(const record of records){
  if(record.companyId!==companyId || typeof record.date!=="string" ||
     !record.date.startsWith(month+"-") || !directory.has(record.uid))continue;
  const dayKey=record.uid+"|"+record.date;
  if(seenDaily.has(dayKey))throw Error("duplicate_daily_records");
  seenDaily.add(dayKey);
  const entries=record.results;
  if(!entries || typeof entries!=="object" || Array.isArray(entries))
    throw Error("invalid_record_lines");
  let total=0,count=0;
  for(const [key,line] of Object.entries(entries)){
    if(!line || !Number.isSafeInteger(line.count) || line.count<0)
      throw Error("invalid_record_count");
    const productId=line.productId||key;
    const p=catalog.get(productId);
    const snapshot=line.revenuePerUnit;
    let unit=null;
    if(p){
      const plans=securePricing(p);
      const cb=line.cashback;
      const validCb=Number.isSafeInteger(cb)&&cb>=0;
      const matched=validCb?plans.filter(x=>x.cashback===cb):
        plans.length===1?plans:[];
      if(matched.length===1 && Number.isSafeInteger(matched[0].revenuePerUnit))
        unit=matched[0].revenuePerUnit;
    }
    if(unit===null){
      if(!Number.isSafeInteger(snapshot)||snapshot<0)
        throw Error("price_unverified_review_required");
      unit=snapshot;
    }
    const amount=line.count*unit;
    if(!Number.isSafeInteger(amount))throw Error("revenue_overflow");
    total+=amount;count+=line.count;
    if(!Number.isSafeInteger(total)||!Number.isSafeInteger(count))
      throw Error("revenue_overflow");
  }
  if(Number.isSafeInteger(record.totalCount)&&count!==record.totalCount)
    throw Error("record_count_mismatch");
  const before=values.get(record.uid)||{uid:record.uid,total:0,count:0};
  before.total+=total;before.count+=count;
  if(!Number.isSafeInteger(before.total)||!Number.isSafeInteger(before.count))
    throw Error("revenue_overflow");
  values.set(record.uid,before);
 }
 // Ranks depend ONLY on total sales. Equal sales share the same rank;
 // UID is a stable display order, never a count-based tie-breaker.
 const ranked=[...values.values()].sort((a,b)=>b.total-a.total||
      a.uid.localeCompare(b.uid));
 let last=null,rank=0;
 // The API returns ONLY rank, uid and name. Never serialize sales, unit prices OR counts.
 return ranked.map((v,i)=>{
   if(v.total!==last){rank=i+1;last=v.total;}
   const member=directory.get(v.uid);
   return {rank,uid:v.uid,name:String(member.name).slice(0,30)};
 });
}
