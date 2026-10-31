/**
 * Firestore REST reader for a verified server-side count-only daily page.
 * Constrained to a single company/day and a snapshot-pinned cursor.
 *
 * The supplied getServiceToken() and decodeDocument() are trusted server
 * dependencies. This reader has no arbitrary user-controlled collection
 * names or network hosts and never returns raw docs directly to a browser.
 */
const PROJECT="sales-management-cc116";
const ROOT="projects/"+PROJECT+"/databases/(default)/documents/records/";
const URL="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/databases/(default)/documents:runQuery";
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const stop=()=>{throw Error("count_day_firestore_snapshot_unavailable");};
export function makeCountDayFirestoreReader({getServiceToken,decodeDocument,fetcher=fetch}={}){
 if(typeof getServiceToken!=="function"||
    typeof decodeDocument!=="function"||typeof fetcher!=="function")stop();
 return async ({companyId,date,cursor="",readTime="",pageSize=50}={})=>{
  if(typeof companyId!=="string"||!ID.test(companyId)||
     typeof date!=="string"||!DATE.test(date)||
     pageSize!==50||typeof cursor!=="string"||
     (cursor&&!ID.test(cursor))||
     typeof readTime!=="string"||
     (Boolean(cursor)!==Boolean(readTime))||
     readTime&&!/^\d{4}-\d{2}-\d{2}T/.test(readTime))stop();
  const where={compositeFilter:{op:"AND",filters:[
   {fieldFilter:{field:{fieldPath:"companyId"},op:"EQUAL",value:{stringValue:companyId}}},
   {fieldFilter:{field:{fieldPath:"date"},op:"EQUAL",value:{stringValue:date}}}
  ]}};
  const structuredQuery={from:[{collectionId:"records"}],
   where,orderBy:[
    {field:{fieldPath:"date"},direction:"ASCENDING"},
    {field:{fieldPath:"__name__"},direction:"ASCENDING"}
   ],limit:pageSize+1};
  if(cursor)structuredQuery.startAt={values:[
   {stringValue:date},{referenceValue:ROOT+cursor}
  ],before:false};
  const body={structuredQuery};
  if(readTime)body.readTime=readTime;
  const token=await getServiceToken();
  if(typeof token!=="string"||!token)stop();
  const resp=await fetcher(URL,{
   method:"POST",
   headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
   body:JSON.stringify(body)
  });
  if(!resp?.ok)stop();
  const rows=await resp.json();
  if(!Array.isArray(rows))stop();
  const stamp=rows.find(x=>typeof x?.readTime==="string")?.readTime;
  if(!stamp||! /^\d{4}-\d{2}-\d{2}T/.test(stamp)||
     (readTime&&stamp!==readTime)||
     rows.some(x=>x?.readTime&&x.readTime!==stamp||
       x?.skippedResults>0))stop();
  const found=rows.filter(x=>x?.document).map(x=>x.document);
  if(found.length>pageSize+1)stop();
  let last="",seen=new Set();
  for(const raw of found){
   if(typeof raw.name!=="string"||!raw.name.startsWith(ROOT)||
      !ID.test(raw.name.slice(ROOT.length))||
      (last&&raw.name<=last)||seen.has(raw.name)||
      (cursor&&raw.name<=ROOT+cursor)||
      raw.fields?.companyId?.stringValue!==companyId||
      raw.fields?.date?.stringValue!==date)stop();
   last=raw.name;seen.add(raw.name);
  }
  const page=found.slice(0,pageSize),next=page.at(-1)?.name.slice(ROOT.length)||null;
  const records=page.map(raw=>decodeDocument(raw));
  if(records.some(x=>!x||x.companyId!==companyId||x.date!==date))stop();
  const hasMore=found.length>pageSize;
  return {records,hasMore,nextCursor:hasMore?next:null,readTime:stamp};
 };
}
