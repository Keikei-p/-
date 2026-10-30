/**
 * Read-only, trusted-backend cutover planning: source records/products ->
 * flat financial-free public projections.
 *
 * No Firebase clients, credentials, requests, writes, deletes or migrations.
 * The trusted caller MUST independently count/exhaustively read the source
 * documents at a single frozen snapshot and pass its exact observed counts.
 * A plan is never proof of a successful production snapshot or deployment.
 */
import {
 projectPublicRecordHeader,projectPublicRecordLines,projectPublicProduct,
 assertPublicSchema,auditNoFinancialKeys
} from "./public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const READ_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const deny=()=>{throw Error("count_projection_reconciliation_failed");};
const validCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000000;
function sortedUnique(items,collection){
 const ids=new Set();
 for(const row of items){
  const id=row.sourceId;
  if(typeof id!=="string"||ids.has(id))deny();
  ids.add(id);
 }
 items.sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 assertPublicSchema(collection,items);
 return items;
}
export function prepareVerifiedCountProjection({
 companyId,month,sourceSnapshotTime,
 records,products,expectedRecordCount,expectedProductCount
}={}){
 if(typeof companyId!=="string"||!ID.test(companyId)||
    typeof month!=="string"||!MONTH.test(month)||
    typeof sourceSnapshotTime!=="string"||!READ_TIME.test(sourceSnapshotTime)||
    !Array.isArray(records)||!Array.isArray(products)||
    !validCount(expectedRecordCount)||!validCount(expectedProductCount)||
    records.length!==expectedRecordCount||products.length!==expectedProductCount)
  deny();
 const headers=[],lines=[],catalog=[];
 let sourceCount=0,publicCount=0;
 // The source must be complete. Public document count may exceed 2,000/day;
 // no silent truncation or fixed 10k document/page cap is permitted here.
 for(const original of records){
  if(!original||original.companyId!==companyId||
     typeof original.date!=="string"||
     !original.date.startsWith(month+"-"))deny();
  let header,detail;
  try{
   header=projectPublicRecordHeader(original);
   detail=projectPublicRecordLines(original);
   assertPublicSchema("publicRecords",[header]);
   assertPublicSchema("publicRecordLines",detail);
  }catch{deny();}
  const detailTotal=detail.reduce((n,row)=>n+row.count,0);
  if(detailTotal!==header.totalCount||header.companyId!==companyId||
     !validCount(header.totalCount)||!validCount(detailTotal))deny();
  sourceCount+=Number(original.totalCount);
  publicCount+=header.totalCount;
  if(!Number.isSafeInteger(sourceCount)||!Number.isSafeInteger(publicCount))deny();
  headers.push(header);lines.push(...detail);
 }
 for(const item of products){
  if(!item||item.companyId!==companyId)deny();
  let projection;
  try{
   projection=projectPublicProduct(item);
   assertPublicSchema("publicProducts",[projection]);
  }catch{deny();}
  catalog.push(projection);
 }
 sortedUnique(headers,"publicRecords");
 sortedUnique(lines,"publicRecordLines");
 sortedUnique(catalog,"publicProducts");
 if(sourceCount!==publicCount)deny();
 // Do not embed original records, snapshots or monetary fields in the result.
 const output={
  manifest:{
   companyId,month,sourceSnapshotTime,
   expectedRecordCount,expectedProductCount,
   publishedRecordCount:headers.length,
   publishedLineCount:lines.length,
   publishedProductCount:catalog.length,
   checkedTotalCount:publicCount,
   noSourceWrites:true,productionApprovalGranted:false
  },
  collections:{publicRecords:headers,publicRecordLines:lines,publicProducts:catalog}
 };
 auditNoFinancialKeys(output);
 return output;
}
