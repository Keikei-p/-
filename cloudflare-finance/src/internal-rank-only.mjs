/**
 * Server-side rank-only projection for current internal company members.
 * The trusted caller MUST verify Firebase ID token, current Firestore
 * user/member/company, company scope, and complete snapshot-pinned pagination.
 * Ranks are computed from the immutable saved totalRevenue; the amount is\n * NEVER transmitted. There are NO individual counts, UID or price in response.
 *
 * This module is OFF and not wired to production until full safe cutover.
 */
const ID=/^[A-Za-z0-9_:-]{1,150}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY=/(?:[￥¥$€]|[0-9０-９][0-9０-９,.，]*\s*(?:万|千)?円|売上|単価|報酬|利益|キャッシュバック|(?:CB|cashback|revenue|unitprice|commission)[\s:_=-]*[0-9０-９])/i;
const reject=()=>{throw Error("internal_rank_only_incomplete_or_unauthorized");};
export function buildInternalRankOnly({companyId,month,records,complete=false}={}){
 if(!ID.test(companyId||"")||!MONTH.test(month||"")||complete!==true||
    !Array.isArray(records)||records.length>100000)reject();
 const seen=new Set(),members=new Map();
 for(const r of records){
  if(!r||typeof r!=="object"||Array.isArray(r)||!ID.test(r.id||"")||
     r.companyId!==companyId||!ID.test(r.uid||"")||
     typeof r.date!=="string"||!r.date.startsWith(month+"-")||
     r.date.length!==10||Number.isNaN(Date.parse(r.date+"T00:00:00Z"))||
     new Date(r.date+"T00:00:00Z").toISOString().slice(0,10)!==r.date||
     !Number.isSafeInteger(r.totalCount)||r.totalCount<0||
     !Number.isSafeInteger(r.totalRevenue)||r.totalRevenue<0||
     seen.has(r.id))reject();
  seen.add(r.id);
  if(!r.results||typeof r.results!=="object"||Array.isArray(r.results)||
     Object.keys(r.results).length>200)reject();
  let summed=0;
  for(const line of Object.values(r.results)){
   if(!line||!Number.isSafeInteger(line.count)||line.count<0)reject();
   summed+=line.count;
   if(!Number.isSafeInteger(summed))reject();
  }
  if(summed!==r.totalCount)reject();
  const label=typeof r.memberNameSnapshot==="string"&&r.memberNameSnapshot.trim()
   ?r.memberNameSnapshot.trim():"担当者";
  if(label.length>70||MONEY.test(label)||/[\x00-\x1f\x7f]/.test(label))reject();
  const prev=members.get(r.uid);
  if(prev&&prev.name!==label)reject();
  if(!prev)members.set(r.uid,{name:label,score:0,uid:r.uid});
  const person=members.get(r.uid);
  person.score+=r.totalRevenue;
  if(!Number.isSafeInteger(person.score))reject();
 }
 const ordered=[...members.values()].sort((a,b)=>b.score-a.score||
    a.name.localeCompare(b.name,"ja")||a.uid.localeCompare(b.uid));
 let rank=0;
 const result=ordered.map((person,i)=>{
  if(i===0||person.score!==ordered[i-1].score)rank=i+1;
  return Object.freeze({rank,name:person.name,champion:rank===1&&person.score>0});
 });
 const reply=Object.freeze({schema:"nico-internal-person-rank-only-v1",month,
   individuals:Object.freeze(result)});
 const json=JSON.stringify(reply);
 if(MONEY.test(json)||/"(?:uid|recordId|count|totalRevenue|unitPrice|cashback|score)"\s*:/i.test(json))
  reject();
 return reply;
}
