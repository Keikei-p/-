/**
 * STAGING ONLY: safe, money-free partner count registration and correction.
 * No Firebase access, calls, writes, deletes or production configuration.
 *
 * A trusted server must verify Firebase ID tokens, fetch fresh membership and
 * count-only catalog, allocate unique record IDs and run the entire write in
 * ONE transaction. Never accept claims from an untrusted browser as principal.
 */
import {assertPublicSchema,auditNoFinancialKeys} from "../security/public-projection.mjs";

const IDENTIFIER=/^[A-Za-z0-9_:-]{1,128}$/;
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONEY=/(?:[¥￥$€]|(?:\d|[０-９])[\d０-９,.，]*\s*(?:万円|千円|円)|(?:CB|cashback|revenue|unitprice|単価|売上|報酬|利益)[\s:_=-]*(?:\d|[０-９]))/i;
const deny=()=>{throw Error("Count-only submission denied or incomplete");};
const safeId=x=>typeof x==="string"&&IDENTIFIER.test(x)&&!MONEY.test(x);
const exact=(obj,keys)=>{
 if(!obj||typeof obj!=="object"||Array.isArray(obj)||
   Object.keys(obj).sort().join(",")!==[...keys].sort().join(","))deny();
};
function safeCount(n){
 if(typeof n!=="number"||!Number.isSafeInteger(n)||n<0||n>1000000)deny();
 return n;
}
function safeText(x){
 if(typeof x!=="string"||x.length>80||MONEY.test(x)||/[\r\n\t]/.test(x))deny();
 return x.trim();
}
function context(principal){
 // "serverVerified" means an actual backend verified token signature, current
 // company membership AND companyKind from a trusted Firestore read.
 if(!principal||principal.serverVerified!==true||
   principal.tokenVerified!==true||principal.memberActive!==true||
   principal.userActive!==true||principal.companyActive!==true||
   principal.companyKind!=="partner"||principal.accessKind!=="partner"||
   principal.partnerRelationApproved!==true||principal.canSubmit!==true||
   !safeId(principal.uid)||!safeId(principal.companyId)||
   !Array.isArray(principal.teamIds)||principal.teamIds.length>100||
   principal.teamIds.some(id=>!safeId(id))||
   new Set(principal.teamIds).size!==principal.teamIds.length)deny();
 return principal;
}
function catalogEntries(catalog,companyId){
 if(!Array.isArray(catalog)||catalog.length>10000)deny();
 const map=new Map();
 for(const row of catalog){
   // Server must supply only whitelisted nonfinancial products.
   exact(row,["catalogId","ownerCompanyId","active","visibility"]);
   if(!safeId(row.catalogId)||!safeId(row.ownerCompanyId)||
      typeof row.active!=="boolean" ||
      !["shared_counts","private"].includes(row.visibility)||
      (row.visibility==="private"&&row.ownerCompanyId!==companyId)||
      map.has(row.catalogId))deny();
   map.set(row.catalogId,row);
 }
 return map;
}
function parseRequest(request,scope,catalog){
 exact(request,["date","teamId","status","lines"]);
 if(!DATE.test(request.date)||!safeId(request.teamId)||
   !scope.teamIds.includes(request.teamId)||
   !["submitted","no_result"].includes(request.status)||
   !Array.isArray(request.lines)||request.lines.length>200)deny();
 const seen=new Set(),items=[];
 let ownCount=0,sharedCount=0;
 for(const line of request.lines){
   exact(line,["catalogId","count"]);
   const pid=line.catalogId;
   if(!safeId(pid)||seen.has(pid))deny();
   seen.add(pid);
   const item=catalog.get(pid);
   if(!item||item.active!==true)deny();
   const n=safeCount(line.count);
   if(n===0)deny(); // Zero results use "no_result", not fake product lines.
   ownCount+=n;
   if(item.visibility==="shared_counts")sharedCount+=n;
   if(!Number.isSafeInteger(ownCount)||!Number.isSafeInteger(sharedCount))deny();
   items.push({catalogId:pid,count:n,visibility:item.visibility});
 }
 if(request.status==="no_result"&&items.length)deny();
 if(request.status==="submitted"&&!items.length)deny();
 return {items,ownCount,sharedCount};
}
function projections({scope,recordId,request,parsed,memberName,teamName}){
 const header=parsed.sharedCount>0||request.status==="no_result"?
   {companyId:scope.companyId,sourceId:recordId,uid:scope.uid,
    date:request.date,teamId:request.teamId,totalCount:parsed.sharedCount,
    reportStatus:parsed.sharedCount>0?"submitted":"no_result",
    memberNameSnapshot:safeText(memberName),teamNameSnapshot:safeText(teamName),
    workLocation:""}:null;
 const lines=parsed.items.filter(row=>row.visibility==="shared_counts")
   .map((row,index)=>({
     companyId:scope.companyId,sourceId:recordId+"__"+String(index).padStart(4,"0"),
     recordId,date:request.date,uid:scope.uid,teamId:request.teamId,
     productId:row.catalogId,count:row.count
   }));
 if(header)assertPublicSchema("publicRecords",[header]);
 assertPublicSchema("publicRecordLines",lines);
 return {publicHeader:header,publicLines:lines};
}
function prepare({principal,catalog,request,serverRecordId,memberName,teamName}){
 const scope=context(principal);
 if(!safeId(serverRecordId)||!serverRecordId.startsWith("pc_"))deny();
 const available=catalogEntries(catalog,scope.companyId);
 const parsed=parseRequest(request,scope,available);
 const safeNames={memberName:safeText(memberName),teamName:safeText(teamName)};
 const projection=projections({scope,recordId:serverRecordId,
   request,parsed,...safeNames});
 return {scope,parsed,projection,safeNames};
}
export function planNewPartnerCount({
 principal,catalog,request,serverRecordId,memberName,teamName
}){
 const {scope,parsed,projection,safeNames}=prepare({
   principal,catalog,request,serverRecordId,memberName,teamName
 });
 const ownRecord={
   companyId:scope.companyId,sourceId:serverRecordId,uid:scope.uid,
   teamId:request.teamId,date:request.date,status:request.status,
   version:1,totalCount:parsed.ownCount,sharedCount:parsed.sharedCount,
   lines:parsed.items.map(x=>({catalogId:x.catalogId,count:x.count}))
 };
 auditNoFinancialKeys(ownRecord);
 return {
   action:"create_only",privateCollection:"partnerCountRecords",
   recordId:serverRecordId,privateRecord:ownRecord,
   ...projection,sourceChanges:[],
   // Backend must treat "create only" as atomic create-if-absent.
   transactionRequired:true
 };
}
export function planPartnerCountCorrection({
 principal,catalog,request,serverRecordId,memberName,teamName,
 previous,expectedVersion,correctionId
}){
 const {scope,parsed,projection}=prepare({
   principal,catalog,request,serverRecordId,memberName,teamName
 });
 if(!previous||previous.companyId!==scope.companyId||
    previous.sourceId!==serverRecordId||previous.uid!==scope.uid||
    previous.date!==request.date||previous.teamId!==request.teamId||
    !Number.isSafeInteger(previous.version)||previous.version<1||
    previous.version!==expectedVersion||
    !safeId(correctionId)||!correctionId.startsWith("pcfix_")||
    !Number.isSafeInteger(previous.totalCount)||
    !Number.isSafeInteger(previous.sharedCount))deny();
 const changed=previous.totalCount!==parsed.ownCount ||
    previous.sharedCount!==parsed.sharedCount ||
    JSON.stringify(previous.lines)!==JSON.stringify(
      parsed.items.map(x=>({catalogId:x.catalogId,count:x.count})));
 if(!changed)deny();
 const record={
   ...previous,version:expectedVersion+1,status:request.status,
   totalCount:parsed.ownCount,sharedCount:parsed.sharedCount,
   lines:parsed.items.map(x=>({catalogId:x.catalogId,count:x.count}))
 };
 // The original private record is updated ONLY via a version-CAS
 // transaction, and corrections are immutable append-only documents.
 const event={
   companyId:scope.companyId,recordId:serverRecordId,
   correctionId,changedByUid:scope.uid,
   priorVersion:expectedVersion,nextVersion:expectedVersion+1,
   beforeCount:previous.totalCount,afterCount:parsed.ownCount,
   beforeSharedCount:previous.sharedCount,
   afterSharedCount:parsed.sharedCount
 };
 auditNoFinancialKeys(record);
 auditNoFinancialKeys(event);
 return {
  action:"compare_and_swap_plus_append",
  privateCollection:"partnerCountRecords",
  correctionCollection:"partnerCountCorrections",
  expectedVersion,recordId:serverRecordId,
  privateRecord:record,immutableCorrection:event,
  ...projection,sourceChanges:[],
  transactionRequired:true
 };
}
