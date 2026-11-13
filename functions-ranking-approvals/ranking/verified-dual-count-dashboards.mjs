/**
 * STAGING / NO PRODUCTION DEPLOY.
 * One authoritative count ledger -> internal management + dual ranking views.
 * Consume SERVER-verified, exhaustive and money-free public record headers
 * and record lines; DO NOT sum derived daily/team/company summaries again.
 * A Firestore server-side role/context gate is REQUIRED before calling.
 */
import {assertPublicSchema,auditNoFinancialKeys} from "../security/public-projection.mjs";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const MONEY=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|cashback|revenue|unitPrice|commission)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const stop=()=>{throw Error("VERIFIED_COUNT_DASHBOARD_INCOMPLETE_OR_UNAUTHORIZED");};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const count=n=>{if(!Number.isSafeInteger(n)||n<0)stop();return n;};
const add=(a,b)=>count(count(a)+count(b));
const label=x=>{
 if(typeof x!=="string"||!x.trim()||x.length>80||MONEY.test(x.normalize("NFKC")))stop();
 return x.replace(/[\r\n\t]/g," ").trim();
};
function date(x){
 if(typeof x!=="string"||!DATE.test(x))stop();
 const [y,m,d]=x.split("-").map(Number),v=new Date(0);
 v.setUTCHours(0,0,0,0);v.setUTCFullYear(y,m-1,d);
 if(v.getUTCFullYear()!==y||v.getUTCMonth()+1!==m||v.getUTCDate()!==d)stop();
 return x;
}
const utc=x=>new Date(date(x)+"T12:00:00Z");
const fmt=d=>d.toISOString().slice(0,10);
const shift=(x,days)=>{const d=utc(x);d.setUTCDate(d.getUTCDate()+days);return fmt(d);};
const monthStart=x=>x.slice(0,7)+"-01";
const prevMonth=x=>{const d=utc(monthStart(x));d.setUTCMonth(d.getUTCMonth()-1);return fmt(d);};
const monthEnd=x=>{const d=utc(monthStart(x));d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return fmt(d);};
function windowFor({kind,day,asOf}){
 date(day);date(asOf);
 if(!["day","week","month"].includes(kind)||day>asOf)stop();
 const start=kind==="day"?day:kind==="month"?monthStart(day):shift(day,-((utc(day).getUTCDay()+6)%7));
 const formalEnd=kind==="day"?day:kind==="month"?monthEnd(day):shift(start,6);
 const end=formalEnd<asOf?formalEnd:asOf;
 if(end<start)stop();
 const span=Math.round((utc(end)-utc(start))/86400000)+1;
 const previousStart=kind==="month"?prevMonth(start):shift(start,-span);
 const previousEnd=kind==="month"?
   (shift(previousStart,span-1)<monthEnd(previousStart)?
    shift(previousStart,span-1):monthEnd(previousStart)):
   shift(start,-1);
 return {start,end,previousStart,previousEnd,days:span};
}
const ordered=(rows,value)=>[...rows].sort((a,b)=>value(b)-value(a)||
 a.name.localeCompare(b.name,"ja")||a.id.localeCompare(b.id)).map((r,i,all)=>{
  // Calculate standard competition ranks: 1,1,3.
  let rank=i+1;
  for(let j=i-1;j>=0&&value(all[j])===value(r);j--)rank=j+1;
  return {...r,rank};
});
function ownerContext(ctx,hub,companyIds) {
 if(!ctx||ctx.serverVerified!==true||ctx.userActive!==true||
    ctx.memberActive!==true||ctx.companyActive!==true||
    ctx.reciprocalOwnersApproved!==true||
    ctx.completeSnapshotBudgetApproved!==true||
    !id(ctx.viewerUid)||!id(ctx.viewerCompanyId)||!id(ctx.hubCompanyId)||
    ctx.hubCompanyId!==hub||!["hub_owner","partner_owner"].includes(ctx.role)||
    (ctx.role==="hub_owner"&&ctx.viewerCompanyId!==hub)||
    (ctx.role==="partner_owner"&&ctx.viewerCompanyId===hub)||
    !Array.isArray(ctx.approvedCompanyIds)||
    ctx.approvedCompanyIds.length!==companyIds.length||
    ctx.approvedCompanyIds.length<1||ctx.approvedCompanyIds.length>30||
    ctx.approvedCompanyIds.some(x=>!id(x))||
    new Set(ctx.approvedCompanyIds).size!==companyIds.length||
    companyIds.some(x=>!ctx.approvedCompanyIds.includes(x))||
    !ctx.approvedCompanyIds.includes(ctx.viewerCompanyId)||
    ctx.individualNamesApproved!==true)stop();
}
function checkSources(sources,companyIds,hub){
 if(!Array.isArray(sources)||sources.length!==companyIds.length)stop();
 const seen=new Set(),recordKeys=new Set(),lineKeys=new Set();
 let readTime=null;
 const teamMetadata=new Map();
 const teamKey=(companyId,teamId)=>JSON.stringify([companyId,teamId]);
 const rows=[],sku=new Map(),names=new Map(),roster=new Map();
 const coverage=new Map();
 for(const s of sources){
  if(!s||!id(s.companyId)||!companyIds.includes(s.companyId)||
     seen.has(s.companyId)||s.isComplete!==true||
     s.consentVerified!==true||!TIME.test(s.readTime||"")||
     s.kind!==(s.companyId===hub?"own":"partner")||
     !Array.isArray(s.teams)||s.teams.length>10000||
     !Array.isArray(s.records)||s.records.length>100000||
     !Array.isArray(s.lines)||s.lines.length>100000||
     !Array.isArray(s.products)||s.products.length>10000||
     s.completeWindows===undefined||
     !s.completeWindows||s.completeWindows.current!==true||
     typeof s.completeWindows.previous!=="boolean"||
     !Array.isArray(s.roster)||s.roster.length>10000||
     Object.keys(s).sort().join("|")!==[
       "companyId","companyLabel","kind","consentVerified","isComplete",
       "readTime","teams","records","lines","products","completeWindows","roster"
     ].sort().join("|"))stop();
  if(readTime!==null&&readTime!==s.readTime)stop();
  readTime=s.readTime;seen.add(s.companyId);
  const company=label(s.companyLabel);names.set(s.companyId,company);
  coverage.set(s.companyId,{current:true,previous:s.completeWindows.previous});
  assertPublicSchema("publicRecords",s.records);
  assertPublicSchema("publicRecordLines",s.lines);
  assertPublicSchema("publicProducts",s.products);
  const teamNames=new Map();
  for(const t of s.teams){
   if(!t||!id(t.id)||teamNames.has(t.id)||
      (t.goalCount!=null&&count(t.goalCount)<0))stop();
   teamNames.set(t.id,label(t.name));
   teamMetadata.set(teamKey(s.companyId,t.id),{id:s.companyId+":"+t.id,sourceTeamId:t.id,
    companyId:s.companyId,companyName:company,name:label(t.name),
    goalCount:t.goalCount==null?null:count(t.goalCount),memberCount:0});
  }
  for(const p of s.products){
   if(p.companyId!==s.companyId||!id(p.sourceId))stop();
   const key=s.companyId+":"+p.sourceId;
   if(sku.has(key))stop();
   sku.set(key,{companyId:s.companyId,companyName:company,
    id:key,name:label(p.name)});
  }
  for(const p of s.roster){
   if(!p||!id(p.uid)||!id(p.teamId)||!teamNames.has(p.teamId))stop();
   const key=s.companyId+":"+p.uid;
   if(roster.has(key))stop();
   teamMetadata.get(teamKey(s.companyId,p.teamId)).memberCount++;
   roster.set(key,{id:key,companyId:s.companyId,companyName:company,
    uid:p.uid,teamId:p.teamId,teamName:teamNames.get(p.teamId),
    name:label(p.name)});
  }
  const headers=new Map(),totals=new Map();
  for(const r of s.records){
   if(r.companyId!==s.companyId||!id(r.sourceId)||!id(r.uid)||
      !id(r.teamId)||!teamNames.has(r.teamId)||!["submitted","no_result"].includes(r.reportStatus))stop();
   const key=s.companyId+":"+r.sourceId,memberKey=s.companyId+":"+r.uid;
   if(recordKeys.has(key))stop();
   recordKeys.add(key);
   date(r.date);count(r.totalCount);
   if(r.reportStatus==="no_result"&&r.totalCount!==0)stop();
   if(!roster.has(memberKey)){
    roster.set(memberKey,{id:memberKey,companyId:s.companyId,companyName:company,
     uid:r.uid,teamId:r.teamId,teamName:teamNames.get(r.teamId),
     name:label(r.memberNameSnapshot||"担当者")});
   }
   headers.set(r.sourceId,r);totals.set(r.sourceId,0);
  }
  for(const line of s.lines){
   if(line.companyId!==s.companyId||!id(line.sourceId)||
      !headers.has(line.recordId)||!sku.has(s.companyId+":"+line.productId))stop();
   const key=s.companyId+":"+line.sourceId;
   if(lineKeys.has(key))stop();
   lineKeys.add(key);
   const h=headers.get(line.recordId);
   if(line.uid!==h.uid||line.teamId!==h.teamId||line.date!==h.date)stop();
   const n=count(line.count);
   totals.set(h.sourceId,add(totals.get(h.sourceId),n));
   rows.push({key,companyId:s.companyId,companyName:company,
    uid:h.uid,teamId:h.teamId,teamName:teamNames.get(h.teamId),
    name:roster.get(s.companyId+":"+h.uid).name,
    date:date(line.date),productKey:s.companyId+":"+line.productId,count:n,
    unidentified:false,reported:true,reportStatus:h.reportStatus});
  }
  for(const h of headers.values()){
   if(totals.get(h.sourceId)!==h.totalCount)stop();
   // Explicitly reported zero is an authoritative input, not missing.
   rows.push({key:s.companyId+":report:"+h.sourceId,companyId:s.companyId,
    companyName:company,uid:h.uid,teamId:h.teamId,
    teamName:teamNames.get(h.teamId),name:roster.get(s.companyId+":"+h.uid).name,
    date:h.date,productKey:null,count:0,unidentified:false,
    reported:true,reportStatus:h.reportStatus});
  }
 }
 return {rows,sku,names,roster,coverage,readTime,teamMetadata};
}
function mappings(groups,sku) {
 if(!Array.isArray(groups)||groups.length>5000)stop();
 const lookup=new Map(),names=new Map();
 for(const r of groups){
  if(!r||!id(r.companyId)||!id(r.productId)||!id(r.groupId))stop();
  const key=r.companyId+":"+r.productId;
  if(!sku.has(key)||lookup.has(key))stop();
  const name=label(r.groupName);
  if(names.has(r.groupId)&&names.get(r.groupId)!==name)stop();
  names.set(r.groupId,name);lookup.set(key,r.groupId);
 }
 return {lookup,names};
}
function safeUnassigned(entries,sku,rows){
 if(entries==null)return [];
 if(!Array.isArray(entries)||entries.length>20000)stop();
 const seen=new Set(),staffDates=new Set(rows.filter(r=>r.reported)
  .map(r=>r.companyId+":"+r.date)),result=[];
 for(const x of entries){
  if(!x||Object.keys(x).sort().join("|")!==[
    "companyId","date","sourceId","productId","count",
    "kind","exclusiveVerified"
   ].sort().join("|")||
   !id(x.companyId)||!id(x.sourceId)||!id(x.productId)||
   x.kind!=="company-code-ledger"||x.exclusiveVerified!==true||
   !sku.has(x.companyId+":"+x.productId))stop();
  date(x.date);count(x.count);
  const key=x.companyId+":"+x.sourceId+":"+x.productId;
  if(seen.has(key)||staffDates.has(x.companyId+":"+x.date))stop();
  seen.add(key);
  result.push({key,companyId:x.companyId,
   companyName:sku.get(x.companyId+":"+x.productId).companyName,
   uid:null,teamId:null,teamName:null,name:"担当者未特定",
   date:x.date,productKey:x.companyId+":"+x.productId,
   count:x.count,unidentified:true});
 }
 return result;
}
function goalIndex(items,roster){
 if(items==null)return new Map();
 if(!Array.isArray(items)||items.length>10000)stop();
 const goals=new Map();
 for(const r of items){
  if(!r||!id(r.companyId)||!id(r.uid))stop();
  const key=r.companyId+":"+r.uid;
  if(!roster.has(key)||goals.has(key))stop();
  goals.set(key,count(r.goalCount));
 }
 return goals;
}
export function buildVerifiedCountDashboard({
 context,hubCompanyId,approvedCompanyIds,sources,
 period,filters={},productGroups=[],unassigned=[],personGoals=[],
 historicalBest=[]
}={}){
 if(!id(hubCompanyId)||!Array.isArray(approvedCompanyIds))stop();
 ownerContext(context,hubCompanyId,approvedCompanyIds);
 if(!period||Object.keys(period).sort().join("|")!==
    ["kind","day","asOf"].sort().join("|"))stop();
 const range=windowFor(period);
 const parsed=checkSources(sources,approvedCompanyIds,hubCompanyId);
 const rows=[...parsed.rows,...safeUnassigned(unassigned,parsed.sku,parsed.rows)];
 const map=mappings(productGroups,parsed.sku),goals=goalIndex(personGoals,parsed.roster);
 if(!filters||typeof filters!=="object"||Array.isArray(filters)||
    Object.keys(filters).some(k=>!["companyId","teamId","uid","productId"].includes(k)))stop();
 const allowed=(value,test)=>value==null||value===""||test(value);
 if(!allowed(filters.companyId,x=>approvedCompanyIds.includes(x))||
    !allowed(filters.teamId,id)||!allowed(filters.uid,id)||
    !allowed(filters.productId,x=>typeof x==="string"&&x.length<=300))stop();
 const productKey=k=>map.lookup.get(k)||"unmapped:"+k;
 const productName=k=>map.lookup.has(k)?map.names.get(map.lookup.get(k)):
   parsed.sku.get(k).companyName+"・"+parsed.sku.get(k).name+"（未統合）";
 const filtered=rows.filter(r=>
  (filters.companyId==null||filters.companyId===""||filters.companyId===r.companyId)&&
  (filters.teamId==null||filters.teamId===""||filters.teamId===r.teamId)&&
  (filters.uid==null||filters.uid===""||filters.uid===r.uid)&&
  (filters.productId==null||filters.productId===""||
    (r.productKey!==null&&
     (filters.productId===productKey(r.productKey)||filters.productId===r.productKey)))
 );
 const current=filtered.filter(r=>r.date>=range.start&&r.date<=range.end);
 const previous=filtered.filter(r=>r.date>=range.previousStart&&r.date<=range.previousEnd);
 const allCompany=new Map(),people=new Map(),products=new Map(),teams=new Map();
 const reportDays=new Map(),oldScores=new Map(),oldReported=new Set();
 const put=(m,key,make,score)=>{
  if(!m.has(key))m.set(key,make());
  m.get(key).count=add(m.get(key).count,score);
 };
 function ensurePerson(row){
  const key=row.companyId+":"+row.uid;
  if(!people.has(key)){
   const base=parsed.roster.get(key);
   if(!base)stop();
   people.set(key,{id:key,name:base.name,companyId:base.companyId,
    companyName:base.companyName,teamId:base.teamId,teamName:base.teamName,
    count:0,products:new Map()});
  }
  return people.get(key);
 }
 for(const base of parsed.roster.values()){
  if(filters.companyId&&filters.companyId!==base.companyId)continue;
  if(filters.teamId&&filters.teamId!==base.teamId)continue;
  if(filters.uid&&filters.uid!==base.uid)continue;
  const person={...base,count:0,products:new Map()};
  people.set(base.id,person);
 }
 for(const r of previous){
  if(r.uid!==null&&r.reported)oldReported.add(r.companyId+":"+r.uid);
  if(r.uid!==null&&r.productKey!==null){
   const key=r.companyId+":"+r.uid;
   oldScores.set(key,add(oldScores.get(key)||0,r.count));
  }
 }
 const statuses=new Map(),teamDetails=new Map();
 // Registered teams remain visible even before their first report. Metadata
 // is current membership; historical counts below keep saved team attribution.
 for(const team of parsed.teamMetadata.values()){
  if(filters.companyId&&filters.companyId!==team.companyId)continue;
  if(filters.teamId&&filters.teamId!==team.id.slice(team.companyId.length+1))continue;
  teams.set(JSON.stringify([team.companyId,team.sourceTeamId]),{id:team.id,companyId:team.companyId,
   companyName:team.companyName,name:team.name,count:0});
  teamDetails.set(JSON.stringify([team.companyId,team.sourceTeamId]),{people:new Map(),products:new Map()});
 }
 for(const r of current){
  const cid=r.companyId;
  put(allCompany,cid,()=>({id:cid,name:parsed.names.get(cid),
    kind:cid===hubCompanyId?"自社":"協力店",count:0,unidentifiedCount:0}),r.count);
  if(r.unidentified)allCompany.get(cid).unidentifiedCount=
    add(allCompany.get(cid).unidentifiedCount,r.count);
  if(r.uid!==null){
   const p=ensurePerson(r);
   p.count=add(p.count,r.count);
   if(r.reported){
    if(!reportDays.has(p.id))reportDays.set(p.id,new Set());
    reportDays.get(p.id).add(r.date);
    if(!statuses.has(p.id))statuses.set(p.id,new Set());
    statuses.get(p.id).add(r.reportStatus);
   }
  }
  if(r.teamId!==null)put(teams,JSON.stringify([r.companyId,r.teamId]),
   ()=>({id:r.companyId+":"+r.teamId,companyId:cid,
    companyName:r.companyName,name:r.teamName,count:0}),r.count);
  // Attribute details to the saved record team, never the current roster.
  // Reuse the same authorized, mapped, filtered rows as every total above.
  if(r.teamId!==null){
   const key=JSON.stringify([r.companyId,r.teamId]);
   if(!teamDetails.has(key))teamDetails.set(key,{people:new Map(),products:new Map()});
   const detail=teamDetails.get(key);
   if(r.uid!==null){
    const personKey=r.companyId+":"+r.uid;
    if(!detail.people.has(personKey))detail.people.set(personKey,
     {id:personKey,name:r.name,count:0,days:new Set()});
    const person=detail.people.get(personKey);
    person.count=add(person.count,r.count);
    if(r.reported)person.days.add(r.date);
   }
   if(r.productKey!==null){
    const productId=productKey(r.productKey);
    put(detail.products,productId,()=>({id:productId,
     name:productName(r.productKey),count:0}),r.count);
   }
  }
  if(r.productKey!==null){
   const key=productKey(r.productKey);
   put(products,key,()=>({id:key,name:productName(r.productKey),
    count:0,ownCount:0,partnerCount:0,companyCounts:new Map()}),r.count);
   const v=products.get(key);
   if(cid===hubCompanyId)v.ownCount=add(v.ownCount,r.count);
   else v.partnerCount=add(v.partnerCount,r.count);
   v.companyCounts.set(cid,add(v.companyCounts.get(cid)||0,r.count));
   if(r.uid!==null){
    const p=ensurePerson(r);
    p.products.set(key,add(p.products.get(key)||0,r.count));
   }
  }
 }
 // Zero-person and empty-company rows keep "unreported" distinct from zero.
 for(const cid of approvedCompanyIds)if(!allCompany.has(cid))
   allCompany.set(cid,{id:cid,name:parsed.names.get(cid),
    kind:cid===hubCompanyId?"自社":"協力店",count:0,unidentifiedCount:0});
 if(!Array.isArray(historicalBest)||historicalBest.length>10000)stop();
 const best=new Map();
 for(const x of historicalBest){
  if(!x||!id(x.companyId)||!id(x.uid)||
     !parsed.roster.has(x.companyId+":"+x.uid)||
     best.has(x.companyId+":"+x.uid))stop();
  best.set(x.companyId+":"+x.uid,count(x.count));
 }
 const personRows=[...people.values()].map(p=>{
  const report=reportDays.get(p.id);
  const total=report?.size||0;
  const state=total===0?"未報告":
    p.count===0?"確定0件":total<range.days?"一部未報告":"報告済";
  const previousComplete=parsed.coverage.get(p.companyId).previous;
  const old=oldScores.get(p.id)||0,wasReported=oldReported.has(p.id);
  const growth=!previousComplete?"比較不可":!wasReported?"初参加":
    p.count-old>0?"増加":p.count-old<0?"減少":"変化なし";
  const rankedProducts=[...p.products].map(([id,count])=>({id,
   name:products.get(id).name,count})).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));
  const target=goals.has(p.id)?goals.get(p.id):null;
  return {id:p.id,name:p.name,companyId:p.companyId,companyName:p.companyName,
   teamId:p.teamId,teamName:p.teamName,count:p.count,
   reportStatus:state,reportedDays:total,
   previousCount:previousComplete?old:null,
   change:previousComplete&&wasReported?p.count-old:null,
   growth,topProduct:rankedProducts[0]?.name??null,
   topProducts:rankedProducts,
   remainingToGoal:target==null?null:Math.max(0,target-p.count),
   personalBestStatus:best.has(p.id)?
      p.count>best.get(p.id)?"自己ベスト更新":"過去記録以下":"比較不可"
  };
 });
 // A roster member with NO submitted day is not a 0-case performer.
 // Preserve them for Owner missing-report views, but NEVER grant a rank.
 // Filter before ranking so a reported zero keeps the correct tie position.
 const rankedPeople=[
  ...ordered(personRows.filter(p=>p.reportStatus!=="未報告"),p=>p.count),
  ...personRows.filter(p=>p.reportStatus==="未報告")
   .sort((a,b)=>a.name.localeCompare(b.name,"ja")||a.id.localeCompare(b.id))
   .map(p=>({...p,rank:null}))
 ];
 const rankedProducts=ordered([...products.values()].map(p=>({
  id:p.id,name:p.name,count:p.count,ownCount:p.ownCount,
  partnerCount:p.partnerCount,
  companies:[...p.companyCounts].map(([cid,n])=>({
   companyId:cid,companyName:parsed.names.get(cid),count:n
  }))
 })),p=>p.count);
 const companyRows=[...allCompany.values()].sort((a,b)=>a.kind==="自社"?-1:
   b.kind==="自社"?1:a.name.localeCompare(b.name,"ja"));
 const self=companyRows.find(x=>x.id===hubCompanyId)?.count??0;
 const total=companyRows.reduce((a,b)=>add(a,b.count),0);
 if(total!==rankedProducts.reduce((a,p)=>add(a,p.count),0))stop();
 const unknown=companyRows.reduce((a,b)=>add(a,b.unidentifiedCount),0);
 const common={schema:"nico-verified-dual-count-v1",period:period.kind,
  range,readTime:parsed.readTime,unit:"件",
  summary:{own:self,partner:total-self,total,unidentified:unknown},
  memberRanking:rankedPeople.map(({topProducts,...p})=>p),
  productRanking:rankedProducts};
 if(context.role==="hub_owner"){
  const data={...common,role:"hub_owner",
   companyBreakdown:companyRows,teamBreakdown:[...teams.values()].map(team=>{
    const identity=JSON.stringify([team.companyId,team.id.slice(team.companyId.length+1)]);
    const detail=teamDetails.get(identity);
    const members=[...detail.people.values()].map(p=>({id:p.id,name:p.name,
     count:p.count,reportStatus:p.days.size===0?"未報告":p.count===0?"確定0件":
      p.days.size<range.days?"一部未報告":"報告済"}));
    const teamProducts=[...detail.products.values()];
    if(members.reduce((sum,p)=>add(sum,p.count),0)!==team.count||
       teamProducts.reduce((sum,p)=>add(sum,p.count),0)!==team.count)stop();
    const metadata=parsed.teamMetadata.get(identity);
    const reported=members.some(p=>p.reportStatus!=="未報告");
    return {...team,detail:{schema:"nico-team-count-detail-v1",members,products:teamProducts,
     goalCount:metadata.goalCount,memberCount:metadata.memberCount,
     reportStatus:!reported?"未報告":team.count===0?"確定0件":"報告済"}};
   }),
   filters:{...filters}};
  auditNoFinancialKeys(data);
  return data;
 }
 const ownCompany=context.viewerCompanyId;
 const ownPeople=common.memberRanking.filter(x=>x.companyId===ownCompany);
 const ownProducts=rankedProducts.filter(x=>x.companies.some(c=>c.companyId===ownCompany))
  .map(p=>({id:p.id,name:p.name,count:p.companies.find(c=>c.companyId===ownCompany).count}));
 // Public member standings exclude unreported people entirely.
 // Own people remain countable but are explicitly rank-null until reported.
 const publicMembers=rankedPeople.filter(x=>x.rank!==null).map(x=>({
  rank:x.rank,company:x.companyName,name:x.name,count:x.count
 }));
 const publicProducts=rankedProducts.map(x=>({
  rank:x.rank,name:x.name,count:x.count
 }));
 // Publish ranked, aggregate-only organization comparisons. This is the
 // same already-verified set of ON-only source lines as member/SKU ranks.
 // No team ID, UID, salary, unit price or source report can leave this API.
 const publicCompanies=ordered(companyRows.map(x=>({
  id:x.id,name:x.name,count:x.count
 })),x=>x.count).map(x=>({rank:x.rank,name:x.name,count:x.count}));
 const publicTeams=ordered([...teams.values()].filter(x=>
  [...teamDetails.get(JSON.stringify([x.companyId,x.id.slice(x.companyId.length+1)])).people.values()].some(p=>p.days.size>0)).map(x=>({
  id:x.id,name:x.name,company:x.companyName,count:x.count
 })),x=>x.count).map(x=>({
  rank:x.rank,name:x.name,company:x.company,count:x.count
 }));
 const data={schema:common.schema,period:common.period,range,unit:"件",
  readTime:common.readTime,role:"partner_owner",
  own:{company:parsed.names.get(ownCompany),
   count:companyRows.find(x=>x.id===ownCompany)?.count??0,
   unidentifiedCount:companyRows.find(x=>x.id===ownCompany)?.unidentifiedCount??0,
   people:ownPeople,products:ownProducts},
  publicRanking:{members:publicMembers,products:publicProducts,
   companies:publicCompanies,teams:publicTeams}};
 auditNoFinancialKeys(data);
 return data;
}
