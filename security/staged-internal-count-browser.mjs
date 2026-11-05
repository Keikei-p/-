/**
 * NO DEPLOY / STAGED ONLY.
 * Browser read adapter for the future verified internal-count API.
 * It is NOT imported by the live page. Do not enable until the server route,
 * token/auth gate, original owner finance UI and complete migration pass E2E.
 * Reads only. It NEVER queries Firestore collections or writes sales data.
 */
import {assertPublicSchema} from './public-projection.mjs';

const ORIGIN='https://nico-factory.web.app';
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const PAGE_SIZE=50,MAX_TOTAL=100000,MAX_PAGES=2001;
const fail=()=>{throw Error('STAGED_INTERNAL_COUNT_BROWSER_BLOCKED');};
const validDay=day=>{
 if(typeof day!=='string'||!DAY.test(day))return false;
 const d=new Date(day+'T00:00:00Z');
 return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===day;
};
const sameContext=(getActiveScope,original)=>{
 try{
  const current=getActiveScope();
  return current?.uid===original.uid&&current?.companyId===original.companyId&&
   current?.mode==='internal';
 }catch{return false;}
};

export function createStagedInternalCountBrowserReader({
 enabled=false,getIdToken,getActiveScope,fetchPage
}={}){
 if(enabled!==true)return async()=>fail();
 if(typeof getIdToken!=='function'||typeof getActiveScope!=='function'||
    typeof fetchPage!=='function')fail();
 return async function readCountDay({day,signal}={}){
  if(!validDay(day)||signal?.aborted)fail();
  const original=getActiveScope();
  if(!ID.test(original?.uid??'')||!ID.test(original?.companyId??'')||
     original.mode!=='internal')fail();
  const token=await getIdToken();
  if(typeof token!=='string'||token.length<20||token.length>12000||
     !/^[A-Za-z0-9._-]+$/.test(token)||!sameContext(getActiveScope,original)||
     signal?.aborted)fail();
  let cursor='',snapshot='',catalog=null,total=0;
  const records=[],lines=[],seen=new Set(),seenLines=new Set();
  for(let pageIndex=0;pageIndex<MAX_PAGES;pageIndex++){
   if(!sameContext(getActiveScope,original)||signal?.aborted)fail();
   const url=new URL('/v1/internal-counts',ORIGIN);
   url.searchParams.set('day',day);
   if(cursor){
    url.searchParams.set('cursor',cursor);
    url.searchParams.set('readTime',snapshot);
   }
   const response=await fetchPage(url.toString(),{
    method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    credentials:'omit',redirect:'error',cache:'no-store',signal
   });
   if(!sameContext(getActiveScope,original)||signal?.aborted||
      response?.ok!==true||response.status!==200||
      typeof response.json!=='function'||
      !String(response.headers?.get?.('Content-Type')||'').toLowerCase()
       .startsWith('application/json'))fail();
   const body=await response.json();
   if(!sameContext(getActiveScope,original)||signal?.aborted||
      !body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).sort().join(',')!==
       ['day','readTime','companyId','records','lines','products',
        'catalogIncluded','hasMore','nextCursor'].sort().join(',')||
      body.day!==day||body.companyId!==original.companyId||
      !Array.isArray(body.records)||!Array.isArray(body.lines)||
      !Array.isArray(body.products)||body.records.length>PAGE_SIZE||
      body.lines.length>2000||body.products.length>200||
      typeof body.readTime!=='string'||!TIME.test(body.readTime)||
      (snapshot&&body.readTime!==snapshot)||
      typeof body.catalogIncluded!=='boolean'||
      typeof body.hasMore!=='boolean'||
      body.catalogIncluded!==(pageIndex===0))fail();
   try{
    assertPublicSchema('publicRecords',body.records);
    assertPublicSchema('publicRecordLines',body.lines);
    assertPublicSchema('publicProducts',body.products);
   }catch{fail();}
   snapshot=body.readTime;
   // The real Worker deliberately sends the verified product catalog only
   // once. Subsequent pages contain ONLY records + lines under readTime.
   if(pageIndex===0)catalog=body.products;
   else if(body.products.length!==0)fail();
   const pageRecords=new Map();
   for(const record of body.records){
    if(!ID.test(record.sourceId)||record.sourceId<=cursor||
       seen.has(record.sourceId)||record.companyId!==original.companyId||
       record.date!==day||record.totalCount<0||
       !Number.isSafeInteger(record.totalCount))fail();
    cursor=record.sourceId;
    seen.add(cursor);pageRecords.set(cursor,{header:record,sum:0});
    records.push(record);
   }
   const productIds=new Set(catalog.map(x=>x.sourceId));
   for(const line of body.lines){
    const matching=pageRecords.get(line.recordId);
    if(!matching||seenLines.has(line.sourceId)||
       line.companyId!==original.companyId||line.date!==day||
       line.uid!==matching.header.uid||line.teamId!==matching.header.teamId||
       !productIds.has(line.productId)||!Number.isSafeInteger(line.count)||
       line.count<0)fail();
    matching.sum+=line.count;
    if(!Number.isSafeInteger(matching.sum))fail();
    seenLines.add(line.sourceId);lines.push(line);
   }
   for(const {header,sum} of pageRecords.values())
    if(header.totalCount!==sum)fail();
   total+=body.records.length;
   if(total>MAX_TOTAL)fail();
   if(!body.hasMore){
    // Exactly 50 final records is legal: the Worker queried one additional
    // row to prove there is no next page. An absent cursor is authoritative.
    if(body.nextCursor!==null||!sameContext(getActiveScope,original)||
       signal?.aborted)fail();
    return Object.freeze({
     day,companyId:original.companyId,totalRecords:total,
     records:Object.freeze(records),lines:Object.freeze(lines),
     products:Object.freeze(catalog),snapshotTime:snapshot
    });
   }
   if(body.records.length!==PAGE_SIZE||
      body.nextCursor!==cursor||!ID.test(body.nextCursor))fail();
  }
  // Missing/failed page must never appear as a zero-count result.
  fail();
 };
}
