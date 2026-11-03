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
 if(field?.mapValue&&typeof field.mapValue==="object"&&
    !Array.isArray(field.mapValue)){
  const fields=field.mapValue.fields??{};
  if(fields&&typeof fields==="object"&&!Array.isArray(fields))
   return {shape:"map",lines:Object.values(fields)};
 }
 if(field?.arrayValue&&typeof field.arrayValue==="object"&&
    Array.isArray(field.arrayValue.values??[]))
  return {shape:"array",lines:field.arrayValue.values??[]};
 return null;
}
function snapshotCounts(data){
 const fields=data?.mapValue?.fields;
 if(!fields||typeof fields!=="object")return null;
 const saved=quantity(fields.totalCount),decoded=linesFrom(fields.results);
 if(saved===null||!decoded)return null;
 let derived=0;
 for(const line of decoded.lines){
  const n=quantity(line?.mapValue?.fields?.count);
  if(n===null)return null;
  derived+=n;
  if(!valid(derived))return null;
 }
 return {saved,derived};
}
function countMap(field){
 if(!field?.mapValue||typeof field.mapValue!=="object")return null;
 const rows=field.mapValue.fields??{};
 if(!rows||typeof rows!=="object"||Array.isArray(rows))return null;
 const output=new Map();
 for(const [key,row] of Object.entries(rows)){
  const count=quantity(row?.mapValue?.fields?.count);
  if(count===null)return null;
  output.set(key,count);
 }
 return output;
}
function afterRowChanges(currentRecord,correction){
 const latest=correction?.value?.fields?.after?.mapValue?.fields||{};
 const original=countMap(latest.results);
 const current=countMap(currentRecord?.value?.fields?.results);
 if(!original||!current)return null;
 let added=0,removed=0,changed=0;
 for(const [key,n] of current){
  if(!original.has(key))added++;
  else if(original.get(key)!==n)changed++;
 }
 for(const key of original.keys())if(!current.has(key))removed++;
 const at=correction?.value?.fields?.createdAt?.timestampValue;
 const updated=currentRecord?.value?.updateTime;
 const t1=typeof at==="string"?Date.parse(at):NaN;
 const t2=typeof updated==="string"?Date.parse(updated):NaN;
 return {addedProductRows:added,removedProductRows:removed,
  quantityChangedProductRows:changed,
  currentRecordUpdatedAfterCorrection:
   Number.isFinite(t1)&&Number.isFinite(t2)?t2>t1:null};
}
function correctionProof(rows,saved,derived,record){
 const result={beforeConsistent:0,beforeMismatched:0,
  afterConsistent:0,afterMismatched:0,
  verifiedAfterSnapshots:0,afterSavedMatchesCurrent:0,
  afterLinesMatchCurrent:0,afterBothMatchCurrent:0,
  unverifiedSnapshots:0,
  currentVsSingleCorrection:null};
 if(rows.length===1)
  result.currentVsSingleCorrection=afterRowChanges(record,rows[0]);
 for(const c of rows){
  const fields=c.value?.fields||{};
  const before=snapshotCounts(fields.before);
  const after=snapshotCounts(fields.after);
  if(before){
   if(before.saved===before.derived)result.beforeConsistent++;
   else result.beforeMismatched++;
  }else result.unverifiedSnapshots++;
  if(after){
   result.verifiedAfterSnapshots++;
   if(after.saved===after.derived)result.afterConsistent++;
   else result.afterMismatched++;
   if(after.saved===saved)result.afterSavedMatchesCurrent++;
   if(after.derived===derived)result.afterLinesMatchCurrent++;
   if(after.saved===saved&&after.derived===derived)result.afterBothMatchCurrent++;
  }else result.unverifiedSnapshots++;
 }
 return result;
}
export function classifyCountDrift(snapshot){
 if(snapshot?.projectId!=="sales-management-cc116"||
    snapshot?.format!=="firestore-rest-typed-v1"||
    !Array.isArray(snapshot?.documents))throw Error("COUNT_DIAGNOSTIC_INVALID_SNAPSHOT");
 const corrections=new Map();
 for(const item of snapshot.documents){
  if(!/^recordCorrections\/[^/]+$/.test(item?.path||""))continue;
  const ref=item?.value?.fields?.recordId?.stringValue;
  if(typeof ref!=="string"||!ref||ref.includes("/"))continue;
  const rows=corrections.get(ref)||[];
  rows.push(item);
  corrections.set(ref,rows);
 }
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
   savedCountIsZero:saved===0,linesCountIsZero:computed===0,
   relatedCorrectionDocuments:(corrections.get(item.path.slice("records/".length))||[]).length,
   correctionCountProof:correctionProof(corrections.get(item.path.slice("records/".length))||[],saved,computed,item)
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
