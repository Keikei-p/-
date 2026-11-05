/**
 * NO DEPLOY: fixed Firestore REST runQuery reader for existing internal
 * records/products. Only a trusted service-account backend can execute it.
 * Results may contain money-bearing nested legacy fields; discard those
 * before sending to the count-only projection. Never rewrite originals.
 */
const DB='projects/sales-management-cc116/databases/(default)/documents';
const ENDPOINT='https://firestore.googleapis.com/v1/'+DB+':runQuery';
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const deny=()=>{throw Error('STAGED_INTERNAL_FIRESTORE_READ_BLOCKED');};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&ID.test(v);
const eq=(name,value)=>({fieldFilter:{field:{fieldPath:name},op:'EQUAL',value:{stringValue:value}}});
function date(value){
 if(typeof value!=='string'||!DAY.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function scalar(v){
 if(!obj(v)||Object.keys(v).length!==1)deny();
 if(typeof v.stringValue==='string')return v.stringValue;
 if(typeof v.booleanValue==='boolean')return v.booleanValue;
 if(typeof v.integerValue==='string'&&/^-?\d+$/.test(v.integerValue)){
  const n=Number(v.integerValue);
  if(Number.isSafeInteger(n))return n;
 }
 if(typeof v.doubleValue==='number'&&Number.isFinite(v.doubleValue))return v.doubleValue;
 if(v.nullValue===null)return null;
 deny();
}
function countResults(v){
 if(!obj(v)||!obj(v.mapValue)||!obj(v.mapValue.fields))deny();
 const entries=Object.entries(v.mapValue.fields);
 if(entries.length>200)deny();
 const result=Object.create(null);
 for(const [bucket,raw] of entries){
  if(!bucket||bucket.length>200||!obj(raw)||!obj(raw.mapValue)||!obj(raw.mapValue.fields))deny();
  const f=raw.mapValue.fields;
  if(!f.productId||!f.count)deny();
  const productId=scalar(f.productId),count=scalar(f.count);
  if(!id(productId)||count===null||count===''||
     !Number.isSafeInteger(Number(count))||Number(count)<0||Number(count)>1000000)deny();
  const name=f.productName?scalar(f.productName):f.productNameSnapshot?
   scalar(f.productNameSnapshot):'';
  if(typeof name!=='string')deny();
  // Intentionally never parse cashback, revenuePerUnit, raw nested maps,
  // prices, customer information, or other money-bearing fields.
  result[bucket]={productId,count,productName:name};
 }
 return result;
}
function decodeDocument(table,fields,documentId){
 const allowed=table==='products'
  ?['companyId','name','active','sortOrder']
  :['companyId','uid','date','teamId','memberNameSnapshot','teamNameSnapshot',
     'workLocation','reportStatus','totalCount','results'];
 if(!obj(fields)||Object.keys(fields).some(k=>!allowed.includes(k)))deny();
 if(table==='products'){
  if(!fields.companyId||!fields.name)deny();
  const doc={id:documentId,companyId:scalar(fields.companyId),name:scalar(fields.name)};
  if(!id(doc.companyId)||typeof doc.name!=='string')deny();
  if(fields.active)doc.active=scalar(fields.active);
  if(fields.sortOrder)doc.sortOrder=scalar(fields.sortOrder);
  if(doc.active!==undefined&&typeof doc.active!=='boolean')deny();
  if(doc.sortOrder!==undefined&&(!Number.isSafeInteger(doc.sortOrder)||doc.sortOrder<0))deny();
  return doc;
 }
 if(!fields.companyId||!fields.uid||!fields.date||
    !fields.totalCount||!fields.results)deny();
 const doc={id:documentId,companyId:scalar(fields.companyId),
  uid:scalar(fields.uid),date:scalar(fields.date),
  totalCount:scalar(fields.totalCount),results:countResults(fields.results)};
 for(const key of ['teamId','memberNameSnapshot','teamNameSnapshot','workLocation','reportStatus'])
  if(fields[key])doc[key]=scalar(fields[key]);
 if(!id(doc.companyId)||!id(doc.uid)||!date(doc.date)||
    !Number.isSafeInteger(doc.totalCount)||doc.totalCount<0||
    (doc.teamId!=null&&typeof doc.teamId!=='string')||
    ['memberNameSnapshot','teamNameSnapshot','workLocation','reportStatus'].some(k=>
      doc[k]!==undefined&&typeof doc[k]!=='string'))deny();
 return doc;
}
export function buildStagedInternalRunQuery({table,companyId,day,cursor='',snapshotTime=null,limit}={}){
 if(!['products','records'].includes(table)||!id(companyId)||
    (table==='records'&&!date(day))||(table==='products'&&day!==undefined)||
    typeof cursor!=='string'||(cursor&&!id(cursor))||
    (table==='products'&&cursor!=='')||
    (snapshotTime!==null&&!TIME.test(snapshotTime))||
    limit!==(table==='products'?201:50))deny();
 const filters=[eq('companyId',companyId)];
 if(table==='records')filters.push(eq('date',day));
 const query={
  from:[{collectionId:table}],
  select:{fields:(table==='products'
   ?['companyId','name','active','sortOrder']
   :['companyId','uid','date','teamId','memberNameSnapshot','teamNameSnapshot',
     'workLocation','reportStatus','totalCount','results']
  ).map(fieldPath=>({fieldPath}))},
  where:filters.length===1?filters[0]:{compositeFilter:{op:'AND',filters}},
  orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit
 };
 if(cursor)query.startAt={before:false,values:[
  {referenceValue:DB+'/'+table+'/'+cursor}]};
 const body={structuredQuery:query};
 if(snapshotTime)body.readTime=snapshotTime;
 return {method:'POST',endpoint:ENDPOINT,body};
}
export function decodeStagedInternalRunQuery(rows,{table,companyId,cursor='',snapshotTime=null,limit}={}){
 if(!Array.isArray(rows)||!rows.length||!['products','records'].includes(table)||
    !id(companyId)||limit!==(table==='products'?201:50)||
    (cursor&&!id(cursor))||(snapshotTime!==null&&!TIME.test(snapshotTime)))deny();
 const prefix=DB+'/'+table+'/';
 let last=cursor,time='';
 const docs=[];
 for(const row of rows){
  if(!obj(row)||!TIME.test(row.readTime??'')||
     (row.skippedResults??0)!==0||row.error||row.transaction)deny();
  if(!time)time=row.readTime;
  if(time!==row.readTime||(snapshotTime&&time!==snapshotTime))deny();
  if(!row.document)continue;
  if(!obj(row.document)||!row.document.name?.startsWith(prefix))deny();
  const documentId=row.document.name.slice(prefix.length);
  if(!id(documentId)||documentId<=last)deny();
  const doc=decodeDocument(table,row.document.fields,documentId);
  if(doc.companyId!==companyId)deny();
  docs.push(doc);last=documentId;
  if(docs.length>limit)deny();
 }
 return {readTime:time,docs};
}
export function createStagedInternalFirestoreReader({executeRunQuery}={}){
 if(typeof executeRunQuery!=='function')deny();
 return async ({companyId,day,cursor='',snapshotTime=null,limit=50}={})=>{
  if(!id(companyId)||!date(day)||limit!==50||
     typeof cursor!=='string'||(cursor&&!id(cursor))||
     (snapshotTime!==null&&!TIME.test(snapshotTime)))deny();
  // Always use the product catalog's returned readTime to pin the records
  // query. Every subsequent page pins BOTH to that original time.
  const p=buildStagedInternalRunQuery({
   table:'products',companyId,snapshotTime,limit:201});
  const catalog=decodeStagedInternalRunQuery(await executeRunQuery(p),{
   table:'products',companyId,snapshotTime,limit:201});
  if(catalog.docs.length>200)deny();
  const q=buildStagedInternalRunQuery({
   table:'records',companyId,day,cursor,
   snapshotTime:catalog.readTime,limit:50});
  const records=decodeStagedInternalRunQuery(await executeRunQuery(q),{
   table:'records',companyId,cursor,snapshotTime:catalog.readTime,limit:50});
  return {complete:true,readTime:catalog.readTime,
   products:catalog.docs,records:records.docs};
 };
}
