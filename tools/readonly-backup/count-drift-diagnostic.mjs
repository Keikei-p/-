/**
 * Firestore REST typed-count mismatch classifier.
 * Immutable, offline, and no identifier/name, timestamp, financial value,
 * path, or raw Firestore field is ever returned.
 */
const ROOT=/^records\/[^/]+$/;
const valid=x=>Number.isSafeInteger(x)&&x>=0;
function quantity(field){
 if(field&&typeof field==="object"&&typeof field.integerValue==="string"&&/^\d+$/.test(field.integerValue)){
  const n=Number(field.integerValue);return valid(n)?n:null;
 }
 if(field&&typeof field==="object"&&typeof field.doubleValue==="number"){
  return valid(field.doubleValue)?field.doubleValue:null;
 }
 return null;
}
function linesFrom(field){
 if(field?.mapValue?.fields&&typeof field.mapValue.fields==="object"&&
    !Array.isArray(field.mapValue.fields))
  return {shape:"map",lines:Object.values(field.mapValue.fields)};
 if(field?.arrayValue&&typeof field.arrayValue==="object"&&
    Array.isArray(field.arrayValue.values??[]))
  return {shape:"array",lines:field.arrayValue.values??[]};
 return null;
}
export function classifyCountDrift(snapshot){
 if(snapshot?.projectId!=="sales-management-cc116"||
    snapshot?.format!=="firestore-rest-typed-v1"||
    !Array.isArray(snapshot?.documents))throw Error("COUNT_DIAGNOSTIC_INVALID_SNAPSHOT");
 const mismatches=[],summary={matched:0,unverifiable:0};
 for(const item of snapshot.documents){
  if(!ROOT.test(item?.path||""))continue;
  const fields=item?.value?.fields||{};
  const saved=quantity(fields.totalCount);
  const decoded=linesFrom(fields.results);
  if(saved===null||!decoded){
   summary.unverifiable++;continue;
  }
  let computed=0,zeroRows=0,invalid=false;
  for(const line of decoded.lines){
   const n=quantity(line?.mapValue?.fields?.count);
   if(n===null){invalid=true;break;}
   if(n===0)zeroRows++;
   computed+=n;
   if(!valid(computed)){invalid=true;break;}
  }
  if(invalid){summary.unverifiable++;continue;}
  if(computed===saved){summary.matched++;continue;}
  // Do not return any document IDs, names, dates, or financial data.
  mismatches.push(Object.freeze({
   shape:decoded.shape,
   rowCount:decoded.lines.length,
   zeroCountRows:zeroRows,
   direction:saved>computed?"saved_exceeds_lines":"lines_exceed_saved",
   absoluteCountDifference:Math.abs(saved-computed),
   savedCountIsZero:saved===0,linesCountIsZero:computed===0
  }));
 }
 return Object.freeze({
  mismatchedRecords:mismatches.length,
  matchedRecords:summary.matched,
  unverifiableRecords:summary.unverifiable,
  // Match the existing 123-document count auditor; no attempt to "correct"
  // stored totals or historic pricing, and no raw record identity is returned.
  mismatchKinds:mismatches.slice(0,5),
  additionalMismatchesOmitted:Math.max(0,mismatches.length-5),
  noStoredDataModified:true
 });
}
