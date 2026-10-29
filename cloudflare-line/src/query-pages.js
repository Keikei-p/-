// Snapshot-consistent Firestore Query pagination for unattended LINE jobs.
// Never silently send a partial count report when the source exceeds a page.
export async function collectLineQueryPages(pageReader,{root,companyId,pageSize=500,maxPages=201}){
 if(typeof root!=="string" || !/^projects\/[A-Za-z0-9_-]+\/databases\/\(default\)\/documents\/[A-Za-z0-9_-]+\/$/.test(root) ||
    !/^[A-Za-z0-9_-]{1,150}$/.test(companyId||"") ||
    !Number.isInteger(pageSize)||pageSize<1||pageSize>500||
    !Number.isInteger(maxPages)||maxPages<1||maxPages>201)
   throw Error("invalid_line_query_scope");
 let cursor="",snapshot="",last="";
 const all=[],seen=new Set();
 for(let p=0;p<maxPages;p++){
  const rows=await pageReader({cursor,readTime:snapshot,pageSize});
  if(!Array.isArray(rows))throw Error("line_query_bad_page");
  const found=rows.filter(row=>row?.document);
  if(found.length>pageSize)throw Error("line_query_excess_page");
  const time=rows.find(row=>typeof row?.readTime==="string")?.readTime;
  if(!time || !/^\d{4}-\d{2}-\d{2}T/.test(time))
    throw Error("line_query_snapshot_missing");
  if(!snapshot)snapshot=time;
  if(rows.some(row=>row?.readTime && row.readTime!==snapshot))
    throw Error("line_query_snapshot_changed");
  if(rows.some(row=>Number(row?.skippedResults||0)>0))
    throw Error("line_query_skipped_records");
  for(const {document:doc} of found){
   if(typeof doc?.name!=="string"||!doc.name.startsWith(root)||
     !/^[^/]+$/.test(doc.name.slice(root.length)) ||doc.name<=last ||seen.has(doc.name))
     throw Error("line_query_cursor_invalid");
   if(doc.fields?.companyId?.stringValue!==companyId)
     throw Error("line_query_cross_company");
   seen.add(doc.name);
   all.push(doc);
   last=doc.name;
   if(all.length>100000)throw Error("line_query_safety_limit");
  }
  if(found.length<pageSize)return all;
  cursor=last;
 }
 throw Error("line_query_safety_limit");
}


// Scheduled month-to-date reports must not reread all historical records.
// A second collector is used because date + __name__ ordering requires a
// two-field cursor rather than the legacy __name__-only cursor.
export async function collectLineMonthQueryPages(pageReader,{
 root,companyId,monthStart,throughDate,pageSize=200,maxDocuments=1999
}){
 const datePattern=/^\d{4}-\d{2}-\d{2}$/;
 if(typeof pageReader!=="function" ||
    typeof root!=="string" || !/^projects\/[A-Za-z0-9_-]+\/databases\/\(default\)\/documents\/records\/$/.test(root) ||
    !/^[A-Za-z0-9_-]{1,150}$/.test(companyId||"") ||
    !datePattern.test(monthStart||"") || !datePattern.test(throughDate||"") ||
    !monthStart.endsWith("-01") || monthStart.slice(0,7)!==throughDate.slice(0,7) ||
    monthStart>throughDate ||
    !Number.isInteger(pageSize) || pageSize<1 || pageSize>500 ||
    !Number.isInteger(maxDocuments) || maxDocuments<1 || maxDocuments>1999)
   throw Error("invalid_line_month_query_scope");
 let cursor=null,snapshot="",lastDate="",lastName="";
 const all=[],seen=new Set();
 // Read at most maxDocuments + 1: the extra document detects truncation.
 while(all.length<=maxDocuments){
  const requestSize=Math.min(pageSize,maxDocuments+1-all.length);
  const rows=await pageReader({cursor,readTime:snapshot,pageSize:requestSize});
  if(!Array.isArray(rows))throw Error("line_month_query_bad_page");
  const found=rows.filter(row=>row?.document);
  if(found.length>requestSize)throw Error("line_month_query_excess_page");
  const time=rows.find(row=>typeof row?.readTime==="string")?.readTime;
  if(!time || !/^\d{4}-\d{2}-\d{2}T/.test(time))
   throw Error("line_month_query_snapshot_missing");
  if(!snapshot)snapshot=time;
  if(rows.some(row=>row?.readTime && row.readTime!==snapshot))
   throw Error("line_month_query_snapshot_changed");
  if(rows.some(row=>Number(row?.skippedResults||0)>0))
   throw Error("line_month_query_skipped_records");
  for(const {document:doc} of found){
   const name=doc?.name,date=doc?.fields?.date?.stringValue;
   if(typeof name!=="string" || !name.startsWith(root) ||
      !/^[^/]+$/.test(name.slice(root.length)) || typeof date!=="string" ||
      !datePattern.test(date) || date<monthStart || date>throughDate)
    throw Error("line_month_query_out_of_scope");
   if(date<lastDate || (date===lastDate && name<=lastName) || seen.has(name))
    throw Error("line_month_query_cursor_invalid");
   if(doc?.fields?.companyId?.stringValue!==companyId)
    throw Error("line_month_query_cross_company");
   seen.add(name);all.push(doc);lastDate=date;lastName=name;
   if(all.length>maxDocuments)throw Error("line_month_read_budget_exceeded");
  }
  if(found.length<requestSize)return all;
  if(!found.length)throw Error("line_month_query_no_progress");
  cursor={date:lastDate,documentName:lastName};
 }
 throw Error("line_month_read_budget_exceeded");
}
