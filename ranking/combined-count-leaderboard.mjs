/**
 * Combined company + partner count leaderboard (STAGING LIBRARY, NO DEPLOY).
 * Uses exclusively already-sanitized public count projections. Never read or
 * copy raw records, products, monetary prices, cashback or personal sales.
 *
 * MUST be executed only by a trusted server after current, reciprocal owner
 * approval and membership/role verification. Client-provided approvals are NOT
 * authorization and this module makes no Firebase or network requests.
 */
import {assertPublicSchema,auditNoFinancialKeys} from "../security/public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const READ_TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const MONEY=/(?:売上|単価|キャッシュバック|報酬|利益|[¥￥$€]|(?:CB|cashback|revenue|unitPrice|commission)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const fail=()=>{throw Error("Incomplete or unauthorized combined count snapshot");};
const validId=id=>typeof id==="string"&&ID.test(id);
function label(input){
 if(typeof input!=="string")fail();
 const name=input.replace(/[\r\n\t]/g," ").trim();
 if(!name||name.length>80||MONEY.test(name))fail();
 return name;
}
function unit(n){
 if(typeof n!=="number"||!Number.isSafeInteger(n)||n<0)fail();
 return n;
}
function safeAdd(a,b){
 const sum=unit(a)+unit(b);
 if(!Number.isSafeInteger(sum))fail();
 return sum;
}
function orderedRanks(rows,score){
 const ordered=[...rows].sort((a,b)=>score(b)-score(a)||
    a.id.localeCompare(b.id));
 let rank=0;
 return ordered.map((row,i)=>{
   if(!i||score(row)!==score(ordered[i-1]))rank=i+1;
   return {...row,rank,champion:score(row)>0&&rank===1};
 });
}
function unique(list,key){
 const ids=list.map(key);
 if(new Set(ids).size!==ids.length)fail();
 return true;
}
function validateSource(source,hubCompanyId,approvedCompanyIds,period){
 if(!source||!validId(source.companyId)||!approvedCompanyIds.includes(source.companyId)||
    source.consentVerified!==true||typeof source.readTime!=="string"||
    !READ_TIME.test(source.readTime)||source.isComplete!==true)fail();
 if(source.companyId===hubCompanyId && source.kind!=="own")fail();
 if(source.companyId!==hubCompanyId && source.kind!=="partner")fail();
 for(const key of ["teams","records","lines","products"]){
   if(!Array.isArray(source[key])||source[key].length>100000)fail();
 }
 label(source.companyLabel);
 assertPublicSchema("publicRecords",source.records);
 assertPublicSchema("publicRecordLines",source.lines);
 assertPublicSchema("publicProducts",source.products);
 unique(source.teams,x=>x.id);
 unique(source.records,x=>x.sourceId);
 unique(source.lines,x=>x.sourceId);
 unique(source.products,x=>x.sourceId);
 for(const team of source.teams){
   if(!validId(team.id))fail();
   label(team.name);
   if(team.goalCount!==null&&team.goalCount!==undefined)unit(team.goalCount);
 }
 const products=new Map();
 for(const p of source.products){
   if(p.companyId!==source.companyId||!validId(p.sourceId))fail();
   label(p.name);products.set(p.sourceId,p);
 }
 const teams=new Map(source.teams.map(t=>[t.id,{
   id:source.companyId+":"+t.id,teamId:t.id,
   companyId:source.companyId,companyLabel:label(source.companyLabel),
   name:label(t.name),count:0,
   goalCount:t.goalCount==null?null:unit(t.goalCount)
 }]));
 const recordMap=new Map(),countsByRecord=new Map(),people=new Map();
 for(const r of source.records){
   if(r.companyId!==source.companyId||!validId(r.sourceId)||!validId(r.uid)||
     !r.date.startsWith(period+"-") ||
     !validId(r.teamId) ||
     !["submitted","no_result"].includes(r.reportStatus))fail();
   unit(r.totalCount);
   recordMap.set(r.sourceId,r);
   countsByRecord.set(r.sourceId,0);
   const key=source.companyId+":"+r.uid;
   const existing=people.get(key);
   const safeDisplay=label(r.memberNameSnapshot||"担当者");
   if(!existing)people.set(key,{id:key,name:safeDisplay,companyId:source.companyId,
     companyLabel:label(source.companyLabel),count:0});
   if(!teams.has(r.teamId)){
     // A later reassignment/deactivation MUST NOT rewrite historical team.
     // Retain the original snapshot as an archived team with unknown goal.
     const historicalName=label(r.teamNameSnapshot||"過去所属班");
     teams.set(r.teamId,{
       id:source.companyId+":"+r.teamId,teamId:r.teamId,
       companyId:source.companyId,companyLabel:label(source.companyLabel),
       name:historicalName,count:0,goalCount:null
     });
   }
 }
 return {source,products,teams,recordMap,countsByRecord,people};
}
/**
 * sources[] must contain EXACTLY hub + all reciprocally-approved partner
 * companies, with isComplete true and readTime of each consistent extracted
 * snapshot. Every document has to be supplied, not a partial first page.
 * A missed partner makes the entire response fail, never a misleading total.
 * productGroups is an owner-reviewed canonical mapping of IDs across companies.
 */
export function buildCombinedCountLeaderboard({
 hubCompanyId,approvedCompanyIds,period,sources,productGroups=[]
}){
 if(!validId(hubCompanyId)||!MONTH.test(period)||
    !Array.isArray(approvedCompanyIds)||!approvedCompanyIds.includes(hubCompanyId)||
    approvedCompanyIds.length>50||!approvedCompanyIds.every(validId)||
    !Array.isArray(sources)||sources.length!==approvedCompanyIds.length ||
    !Array.isArray(productGroups)||productGroups.length>5000)fail();
 unique(approvedCompanyIds,x=>x);
 unique(sources,x=>x.companyId);
 const groupMap=new Map(),productLabelMap=new Map();
 for(const map of productGroups){
   if(!map||!validId(map.companyId)||!approvedCompanyIds.includes(map.companyId)||
     !validId(map.productId)||!validId(map.groupId))fail();
   const name=label(map.groupName);
   const key=map.companyId+":"+map.productId;
   if(groupMap.has(key))fail();
   groupMap.set(key,map.groupId);
   if(productLabelMap.has(map.groupId)&&productLabelMap.get(map.groupId)!==name)fail();
   productLabelMap.set(map.groupId,name);
 }
 const checked=sources.map(s=>validateSource(s,hubCompanyId,approvedCompanyIds,period));
 if(checked.some(x=>x.source.readTime!==checked[0].source.readTime))fail();
 const teamRows=[],memberRows=[],productTotals=new Map(),productMembers=new Map();
 const unknownProducts=[];
 let combinedCount=0,combinedGoal=0,goalsComplete=true;
 for(const check of checked){
   const {source,products,teams,recordMap,countsByRecord,people}=check;
   for(const line of source.lines){
     if(line.companyId!==source.companyId ||
       !recordMap.has(line.recordId)||!products.has(line.productId)||
       !validId(line.sourceId))fail();
     const r=recordMap.get(line.recordId);
     if(line.uid!==r.uid||line.teamId!==r.teamId||line.date!==r.date)fail();
     const count=unit(line.count);
     countsByRecord.set(line.recordId,safeAdd(countsByRecord.get(line.recordId),count));
     const productKey=source.companyId+":"+line.productId;
     // Never guess two products represent the same SKU because names look alike.
     const approved=groupMap.has(productKey);
     const groupId=approved?groupMap.get(productKey):"unmapped:"+productKey;
     const name=approved?productLabelMap.get(groupId):
       label(source.companyLabel)+"・"+label(products.get(line.productId).name)+"（未統合）";
     if(!approved&&!unknownProducts.includes(productKey))unknownProducts.push(productKey);
     if(!productTotals.has(groupId))productTotals.set(groupId,{
       id:groupId,name,count:0,approvedMapping:approved
     });
     const group=productTotals.get(groupId);
     group.count=safeAdd(group.count,count);
     if(!productMembers.has(groupId))productMembers.set(groupId,new Map());
     const peopleForProduct=productMembers.get(groupId);
     const personKey=source.companyId+":"+r.uid;
     peopleForProduct.set(personKey,safeAdd(peopleForProduct.get(personKey)??0,count));
   }
   for(const r of source.records){
     if(countsByRecord.get(r.sourceId)!==r.totalCount)fail();
     combinedCount=safeAdd(combinedCount,r.totalCount);
     const team=teams.get(r.teamId);
     team.count=safeAdd(team.count,r.totalCount);
     const person=people.get(source.companyId+":"+r.uid);
     person.count=safeAdd(person.count,r.totalCount);
   }
   for(const team of teams.values()){
     if(team.goalCount===null)goalsComplete=false;
     else combinedGoal=safeAdd(combinedGoal,team.goalCount);
     teamRows.push(team);
   }
   memberRows.push(...people.values());
 }
 if([...productTotals.values()].reduce((s,p)=>safeAdd(s,p.count),0)!==combinedCount)fail();
 const countRanking=orderedRanks(teamRows,team=>team.count);
 const progressRanking=orderedRanks(teamRows.filter(t=>t.goalCount!==null&&t.goalCount>0)
   .map(t=>({...t,progressPercent:Math.round(t.count*10000/t.goalCount)/100})),
    t=>t.progressPercent);
 const memberRanking=orderedRanks(memberRows,m=>m.count)
   .map(({id,name,companyId,companyLabel,rank,champion})=>({
     id,name,companyId,companyLabel,rank,champion
   })); // No individual counts and NO revenue in response.
 const productRanking=orderedRanks([...productTotals.values()],p=>p.count)
   .map(row=>{
     const byKey=productMembers.get(row.id)??new Map();
     const individual=orderedRanks(memberRows.filter(m=>byKey.has(m.id)).map(m=>({
       ...m,productScore:byKey.get(m.id)
     })),m=>m.productScore)
       .map(({id,name,companyLabel,rank,champion})=>({
         id,name,companyLabel,rank,champion
       })); // Product subranking also rank-only per individual.
     return {...row,individual};
   });
 const result={
   period,readTime:checked[0].source.readTime,companyCount:checked.length,combinedCount,
   combinedGoalCount:goalsComplete?combinedGoal:null,
   targetComplete:goalsComplete,
   teamCountRanking:countRanking,
   teamProgressRanking:progressRanking,
   individualRankOnly:memberRanking,
   productCountRanking:productRanking,
   needsProductMapping:unknownProducts.length>0,
   unmappedProducts:unknownProducts.length
 };
 auditNoFinancialKeys(result);
 return result;
}
