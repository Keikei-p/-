/**
 * STAGING / NO DEPLOY. Convert the original NICO FACTORY sales records into
 * the same count-only shape as the partner ledger, inside ONE Firestore
 * read-only transaction. Never mutate/read back customer revenue in output.
 *
 * The existing index.html writes top-level records:
 * {companyId,uid,date,teamId,memberNameSnapshot,teamNameSnapshot,
 *  results:{[productId]:{count,revenuePerUnit,...}},totalCount,reportStatus}.
 * Counts use exact IDs; an unknown/duplicate/ambiguous row stops publication.
 * Unlike the browser's local ranking groups, SKU mappings must be separately
 * approved server-side; this adapter deliberately cannot infer them.
 */
import {assertPublicSchema,auditNoFinancialKeys} from "../security/public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DATE=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const MONEY=/(?:売上|単価|利益|報酬|キャッシュバック|[¥￥$€]|(?:cashback|revenue|unitPrice|commission|CB)[\s:=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:円|万円))/i;
const LIMIT={records:2000,products:300,teams:150,users:1000};
const NO_TEAM="rankUnassignedTeam";
const stop=()=>{throw Error("INTERNAL_MONTH_COUNT_SOURCE_UNVERIFIED");};
const id=v=>typeof v==="string"&&ID.test(v)&&
 !["__proto__","constructor","prototype"].includes(v);
const obj=v=>v!=null&&typeof v==="object"&&!Array.isArray(v);
const count=v=>Number.isSafeInteger(v)&&v>=0?v:stop();
const label=(v,backup=null)=>{
 if((v==null||v==="")&&backup!==null)return label(backup);
 if(typeof v!=="string"||v.trim().length<1||v.length>80||MONEY.test(v))stop();
 return v.replace(/[\r\n\t]/g," ").trim();
};
function day(v){
 if(typeof v!=="string"||!DATE.test(v))stop();
 const [y,m,d]=v.split("-").map(Number);
 const x=new Date(0);x.setUTCHours(0,0,0,0);x.setUTCFullYear(y,m-1,d);
 if(x.getUTCFullYear()!==y||x.getUTCMonth()+1!==m||x.getUTCDate()!==d)stop();
 return v;
}
const data=s=>s?.exists===true&&typeof s.data==="function"?s.data():stop();
function rows(s,maximum){
 if(!Array.isArray(s?.docs)||s.docs.length>maximum)stop();
 const seen=new Set();
 return s.docs.map(x=>{
  if(!id(x.id)||seen.has(x.id))stop();
  seen.add(x.id);return {id:x.id,value:data(x)};
 });
}
function timeOf(s){
 const t=s?.readTime;
 if(!Number.isSafeInteger(t?.seconds)||!Number.isSafeInteger(t?.nanoseconds)||
    t.nanoseconds<0||t.nanoseconds>=1000000000||
    typeof t.toDate!=="function")stop();
 const v=t.toDate();
 if(!(v instanceof Date)||!Number.isFinite(v.getTime()))stop();
 const iso=v.toISOString();
 if(!TIME.test(iso))stop();
 return {key:t.seconds+":"+t.nanoseconds,iso};
}
function productCounts(record){
 if(Array.isArray(record.results)){
  return record.results.map(x=>{
   if(!obj(x)||!id(x.productId))stop();
   return {productId:x.productId,count:count(x.count)};
  });
 }
 if(obj(record.results)){
  return Object.entries(record.results).map(([productId,x])=>{
   if(!id(productId)||!obj(x)||
      (x.productId!=null&&x.productId!==productId))stop();
   return {productId,count:count(x.count)};
  });
 }
 // Legacy single-product record (unchanged by this reader).
 if(record.results==null&&id(record.productId)){
  return [{productId:record.productId,count:count(record.count)}];
 }
 stop();
}
export function buildInternalMonthCountSource({
 hubCompanyId,month,readTime,company,records,products,teams,users
}={}){
 if(!id(hubCompanyId)||!MONTH.test(month||"")||
    !TIME.test(readTime||"")||!obj(company)||
    company.active===false||
    ![null,undefined,"direct","internal"].includes(company.companyKind)||
    !id(company.ownerUid)||
    !Array.isArray(records)||records.length>LIMIT.records||
    !Array.isArray(products)||products.length>LIMIT.products||
    !Array.isArray(teams)||teams.length>LIMIT.teams||
    !Array.isArray(users)||users.length>LIMIT.users)stop();
 const productMap=new Map(),teamMap=new Map(),rosterMap=new Map();
 const companyLabel=label(company.name);
 for(const p of products){
  if(!id(p.id)||productMap.has(p.id)||!obj(p.value)||
     p.value.companyId!==hubCompanyId)stop();
  productMap.set(p.id,{companyId:hubCompanyId,sourceId:p.id,
   name:label(p.value.name),active:p.value.active!==false,
   sortOrder:Number.isSafeInteger(p.value.sortOrder)&&
     p.value.sortOrder>=0?p.value.sortOrder:0});
 }
 for(const t of teams){
  if(!id(t.id)||t.id===NO_TEAM||teamMap.has(t.id)||!obj(t.value)||
     t.value.companyId!==hubCompanyId)stop();
  teamMap.set(t.id,{id:t.id,name:label(t.value.name),goalCount:null});
 }
 teamMap.set(NO_TEAM,{id:NO_TEAM,name:"所属なし",goalCount:null});
 const teamFor=(original,storedName)=>{
  if(original==null||original==="")return NO_TEAM;
  if(!id(original))stop();
  if(!teamMap.has(original)){
   // Archived historical teams may no longer be present in active teams.
   teamMap.set(original,{id:original,name:label(storedName),goalCount:null});
  }
  return original;
 };
 for(const u of users){
  if(!id(u.id)||!obj(u.value)||u.value.companyId!==hubCompanyId)stop();
  if(u.value.active===false)continue;
  const uid=id(u.value.uid)?u.value.uid:u.id;
  if(uid!==u.id||rosterMap.has(uid))stop();
  const teamId=teamFor(u.value.teamId,u.value.teamNameSnapshot);
  rosterMap.set(uid,{uid,teamId,name:label(u.value.name,"担当者")});
 }
 const headers=[],lines=[],seenDate=new Set();
 for(const r of records){
  if(!id(r.id)||!obj(r.value)||r.value.companyId!==hubCompanyId||
     !id(r.value.uid)||day(r.value.date).slice(0,7)!==month)stop();
  const v=r.value;
  const ownerKey=v.uid+"|"+v.date;
  if(seenDate.has(ownerKey))stop();
  seenDate.add(ownerKey);
  const teamId=teamFor(v.teamId,v.teamNameSnapshot);
  const memberName=label(v.memberNameSnapshot,"担当者");
  if(!rosterMap.has(v.uid))rosterMap.set(v.uid,{
   uid:v.uid,teamId,name:memberName});
  const productRows=productCounts(v),seen=new Set();
  let sum=0;
  for(const [i,x] of productRows.entries()){
   if(!productMap.has(x.productId)||seen.has(x.productId))stop();
   seen.add(x.productId);sum+=x.count;
   if(!Number.isSafeInteger(sum))stop();
   if(x.count>0)lines.push({
    companyId:hubCompanyId,recordId:r.id,sourceId:r.id+"__"+i,
    uid:v.uid,teamId,date:v.date,productId:x.productId,count:x.count
   });
  }
  if(sum!==count(v.totalCount))stop();
  // Older positive-count records predate reportStatus; the positive
  // saved count unambiguously signifies submitted, unlike ambiguous zero.
  const status=v.reportStatus??
    (sum>0?"submitted":null);
  if(!["submitted","no_result"].includes(status)||
     (status==="no_result"&&sum!==0))stop();
  headers.push({
   companyId:hubCompanyId,sourceId:r.id,uid:v.uid,teamId,
   date:v.date,totalCount:sum,reportStatus:status,
   memberNameSnapshot:memberName,
   teamNameSnapshot:teamMap.get(teamId).name,workLocation:""
  });
 }
 // Never add current members without a stable, verified team. A zero
 // present-day roster member may appear as unreported; retired staff with
 // historical records remain through their saved snapshots above.
 for(const member of rosterMap.values())if(!teamMap.has(member.teamId))stop();
 const result={
  companyId:hubCompanyId,companyLabel,kind:"own",
  consentVerified:true,isComplete:true,readTime,
  completeWindows:{current:true,previous:false},
  teams:[...teamMap.values()],
  roster:[...rosterMap.values()],
  records:headers,lines,
  products:[...productMap.values()]
 };
 assertPublicSchema("publicRecords",headers);
 assertPublicSchema("publicRecordLines",lines);
 assertPublicSchema("publicProducts",result.products);
 auditNoFinancialKeys(result);
 return result;
}

/**
 * Uses canonical top-level collections from the real sales dashboard.
 * Firestore query limits must be exceeded, NOT silently truncated.
 * Full snapshot reads and builder run INSIDE caller's read-only transaction.
 */
export function createInternalMonthTransactionReader({db}={}){
 if(!db||typeof db.collection!=="function")stop();
 return async function readInternalMonth({
  tx,hubCompanyId,month,context
 }={}){
  if(!tx||typeof tx.get!=="function"||!id(hubCompanyId)||
     !MONTH.test(month||"")||
     !context||context.serverVerified!==true||
     context.hubCompanyId!==hubCompanyId||
     !context.approvedCompanyIds?.includes(hubCompanyId)||
     !["hub_owner","partner_owner"].includes(context.role))stop();
  const next=new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),1))
   .toISOString().slice(0,10);
  const monthFirst=month+"-01";
  const collections=name=>db.collection(name);
  const [companySnap,recordsSnap,productsSnap,teamsSnap,usersSnap]=
   await Promise.all([
    tx.get(collections("companies").doc(hubCompanyId)),
    tx.get(collections("records").where("companyId","==",hubCompanyId)
     .where("date",">=",monthFirst).where("date","<",next).limit(LIMIT.records+1)),
    tx.get(collections("products").where("companyId","==",hubCompanyId)
     .limit(LIMIT.products+1)),
    tx.get(collections("teams").where("companyId","==",hubCompanyId)
     .limit(LIMIT.teams+1)),
    tx.get(collections("users").where("companyId","==",hubCompanyId)
     .limit(LIMIT.users+1))
   ]);
  const initial=timeOf(recordsSnap);
  for(const s of [companySnap,productsSnap,teamsSnap,usersSnap])
   if(timeOf(s).key!==initial.key)stop();
  const result=buildInternalMonthCountSource({
   hubCompanyId,month,readTime:initial.iso,
   company:data(companySnap),
   records:rows(recordsSnap,LIMIT.records),
   products:rows(productsSnap,LIMIT.products),
   teams:rows(teamsSnap,LIMIT.teams),
   users:rows(usersSnap,LIMIT.users)
  });
  return result;
 };
}
