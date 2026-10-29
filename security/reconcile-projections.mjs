/**
 * PRE-RELEASE ONLY. Full parity check for a prepared count-only Firestore view.
 * No Firebase credentials, network, Firestore writes, or data migrations.
 * Never include actual record IDs, names, prices, amounts or values in errors.
 */
import {
  projectPublicRecordHeader,projectPublicRecordLines,projectPublicProduct,
  projectPublicCorrectionFlat,assertPublicSchema
} from "./public-projection.mjs";

const COLLECTIONS=[
  "publicRecords","publicRecordLines","publicProducts","publicRecordCorrections"
];

function canonical(value){
  if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw Error("Projection contains non-finite number");
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object"){
    return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
  }
  throw Error("Invalid projection value type");
}
function verifyIdentityAndCompany(items,companyId,label,field="id"){
  if(!Array.isArray(items)||items.length>100000)
    throw Error("Invalid or oversized "+label+" collection");
  const seen=new Set();
  for(const doc of items){
    if(!doc||typeof doc!=="object"||Array.isArray(doc)
      ||typeof doc[field]!=="string"||!doc[field]
      ||seen.has(doc[field])||doc.companyId!==companyId)
      throw Error("Duplicate, missing or cross-company "+label+" source");
    seen.add(doc[field]);
  }
}
function verifyExact(expected,actual,name){
  if(!Array.isArray(actual))throw Error("Missing "+name+" collection");
  assertPublicSchema(name,actual);
  if(actual.length!==expected.length)
    throw Error("Projection parity mismatch: "+name+" size");
  const ids=new Set();
  for(const item of actual){
    if(typeof item.sourceId!=="string"||!item.sourceId||ids.has(item.sourceId))
      throw Error("Duplicate or invalid "+name+" source ID");
    ids.add(item.sourceId);
  }
  const sortById=x=>x.slice().sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
  if(canonical(sortById(expected))!==canonical(sortById(actual)))
    throw Error("Projection parity mismatch: "+name+" values");
}
export function verifyPreparedCountProjections({companyId,source,publicView}){
  if(typeof companyId!=="string"||!companyId)throw Error("Missing company ID");
  if(!source||!publicView||typeof source!=="object"||typeof publicView!=="object")
    throw Error("Missing projection sources");
  const records=source.records,products=source.products,corrections=source.recordCorrections;
  verifyIdentityAndCompany(records,companyId,"records");
  verifyIdentityAndCompany(products,companyId,"products");
  verifyIdentityAndCompany(corrections,companyId,"recordCorrections");
  const recordIds=new Set(records.map(x=>x.id));
  for(const correction of corrections){
    if(!recordIds.has(correction.recordId))
      throw Error("Correction references an absent source record");
  }
  const expected={
    publicRecords:records.map(projectPublicRecordHeader),
    publicRecordLines:records.flatMap(projectPublicRecordLines),
    publicProducts:products.map(projectPublicProduct),
    publicRecordCorrections:corrections.map(projectPublicCorrectionFlat)
  };
  for(const name of COLLECTIONS){
    assertPublicSchema(name,expected[name]);
    verifyExact(expected[name],publicView[name],name);
  }
  let totalCount=0;
  for(const item of expected.publicRecords){
    totalCount+=item.totalCount;
    if(!Number.isSafeInteger(totalCount))throw Error("Saved count total exceeds safe precision");
  }
  return {
    companyVerified:true,
    recordDocuments:records.length,
    storedContractCount:totalCount,
    productDocuments:products.length,
    correctionDocuments:corrections.length,
    publicRecordLines:expected.publicRecordLines.length,
    exactParity:true,
    databaseChanged:false
  };
}
