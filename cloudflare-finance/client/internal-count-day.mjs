/**
 * Staged read-only front-end client for authenticated COUNT-only daily pages.
 * NEVER import from index.html until safe cutover has passed ALL gates.
 *
 * Critically, this rejects missing pages, stale snapshot, duplicates and
 * unexpected money-bearing keys instead of painting a misleading zero.
 * It does not fetch directly from Firestore or write any documents.
 */
import {SALES_HOST_ORIGINS} from "./dual-host-adapter.mjs";
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_RECORD=[
 "companyId","sourceId","uid","date","teamId","totalCount",
 "reportStatus","memberNameSnapshot","teamNameSnapshot","workLocation"
].sort().join(",");
const ALLOWED_LINE=[
 "companyId","recordId","sourceId","date","uid","teamId","productId","count"
].sort().join(",");
const ALLOWED_PRODUCT=[
 "companyId","sourceId","name","active","sortOrder"
].sort().join(",");
const ALLOWED_PAGE=[
 "catalogIncluded","companyId","day","hasMore","lines","nextCursor",
 "products","readTime","records"
].sort().join(",");
const fail=x=>{throw Error("secure_count_day_"+x);};
const string=x=>typeof x==="string"&&x.length>0;
const props=x=>x&&typeof x==="object"&&!Array.isArray(x)?
 Object.keys(x).sort().join(","):null;
const boundedCount=x=>Number.isSafeInteger(x)&&x>=0&&x<=1e6;
const embedsMoney=s=>typeof s==="string" &&
 /(?:[¥￥$€]|(?:\d|[０-９])[\d０-９,.，]*\s*(?:万円|千円|円)|(?:CB|cashback|キャッシュバック|売上|単価|報酬|利益|commission|unitprice|revenue)[\s:_=－-]*(?:\d|[０-９]))/i.test(s);
const validDate=s=>{
 if(typeof s!=="string"||!DATE.test(s))fail("invalid_day");
 const x=new Date(s+"T00:00:00Z");
 if(Number.isNaN(x.valueOf())||x.toISOString().slice(0,10)!==s)fail("invalid_day");
 return s;
};
const approvedGateway=url=>{
 try{
  const u=new URL(url);
  return u.protocol==="https:"&&!u.username&&!u.password&&
   !u.search&&!u.hash&&u.pathname==="/"&&
   /^sales-finance-gateway\.[a-z0-9-]+\.workers\.dev$/i.test(u.hostname);
 }catch{return false;}
};
function validRow(row,expected,day,companyId){
 if(props(row)!==expected||row.companyId!==companyId||
    row.date!==day||!string(row.sourceId))fail("row_schema");
 for(const v of Object.values(row)){
  if(v!==null&&typeof v==="object")fail("nested_row");
  if(embedsMoney(v))fail("money_in_visible_label");
 }
}
function validatePage(page,day,expectedCompanyId,expectedReadTime,seen,catalogExpected){
 if(props(page)!==ALLOWED_PAGE||page.day!==day||
    !string(page.companyId)||
    (expectedCompanyId&&page.companyId!==expectedCompanyId)||
    !string(page.readTime)||
    (expectedReadTime&&page.readTime!==expectedReadTime)||
    page.catalogIncluded!==catalogExpected||
    !Array.isArray(page.records)||page.records.length>50||
    !Array.isArray(page.lines)||page.lines.length>10000||
    !Array.isArray(page.products)||page.products.length>200||
    typeof page.hasMore!=="boolean"||
    (page.hasMore&&(!string(page.nextCursor)||page.records.length!==50||
       page.nextCursor!==page.records.at(-1)?.sourceId))||
    (!page.hasMore&&page.nextCursor!==null)||
    (!catalogExpected&&page.products.length))
   fail("page_contract");
 const ids=new Set();
 let summed=0;
 for(const row of page.records){
  validRow(row,ALLOWED_RECORD,day,page.companyId);
  if(!string(row.uid)||!boundedCount(row.totalCount)||
     seen.has(row.sourceId)||ids.has(row.sourceId))fail("duplicate_or_invalid_record");
  ids.add(row.sourceId);
  summed+=row.totalCount;
  if(!Number.isSafeInteger(summed))fail("sum_overflow");
 }
 const perRecordCount=new Map();
 const lineKeys=new Set();
 for(const line of page.lines){
  validRow(line,ALLOWED_LINE,day,page.companyId);
  if(!string(line.recordId)||!ids.has(line.recordId)||
    !string(line.productId)||!boundedCount(line.count)||
    lineKeys.has(line.sourceId))fail("line_scope");
  lineKeys.add(line.sourceId);
  perRecordCount.set(line.recordId,(perRecordCount.get(line.recordId)||0)+line.count);
  if(!Number.isSafeInteger(perRecordCount.get(line.recordId)))fail("line_overflow");
 }
 for(const row of page.records)
  if((perRecordCount.get(row.sourceId)||0)!==row.totalCount)fail("count_mismatch");
 for(const product of page.products){
  if(props(product)!==ALLOWED_PRODUCT||product.companyId!==page.companyId||
     !string(product.sourceId)||typeof product.name!=="string"||
     typeof product.active!=="boolean"||
     !Number.isSafeInteger(product.sortOrder)||
     Object.values(product).some(embedsMoney))fail("catalog_contract");
 }
 for(const id of ids)seen.add(id);
 return page.companyId;
}
export async function fetchVerifiedInternalCountDay({
 user,origin,gatewayUrl,day,enabled=false,fetcher=fetch,maxPages=1000
}={}){
 if(enabled!==true)fail("cutover_disabled");
 if(!SALES_HOST_ORIGINS.includes(origin)||!approvedGateway(gatewayUrl))
  fail("untrusted_origin");
 validDate(day);
 if(!user||typeof user.getIdToken!=="function")fail("unauthenticated");
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>1000)
  fail("page_limit");
 const token=await user.getIdToken(true);
 if(!string(token)||token.length>12000)fail("unauthenticated");
 let cursor="",readTime="",companyId="";
 const records=[],lines=[];let products=[],pages=0;
 const seen=new Set(),visited=new Set();
 do {
  if(pages>=maxPages)fail("page_limit_exceeded");
  const url=new URL("/v1/internal-counts",gatewayUrl);
  url.searchParams.set("day",day);
  if(cursor){
    url.searchParams.set("cursor",cursor);
    url.searchParams.set("readTime",readTime);
  }
  const response=await fetcher(url.toString(),{
   method:"GET",headers:{Authorization:"Bearer "+token},
   cache:"no-store",redirect:"error"
  });
  if(!response?.ok)fail("page_http_"+String(response?.status??"unknown"));
  const page=await response.json();
  companyId=validatePage(page,day,companyId,readTime,seen,pages===0);
  if(pages===0){products=page.products;readTime=page.readTime;}
  records.push(...page.records);lines.push(...page.lines);
  pages++;
  if(!page.hasMore)break;
  if(visited.has(page.nextCursor)||page.nextCursor===cursor)
   fail("cursor_cycle");
  visited.add(page.nextCursor);
  cursor=page.nextCursor;
 }while(true);
 // Only return validated count-only objects. A failure at ANY page is fatal,
 // not a partial result and never a silent zero.
 return Object.freeze({companyId,day,readTime,pages,records,lines,products,
  totalCount:records.reduce((n,r)=>n+r.totalCount,0)});
}
