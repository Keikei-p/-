/**
 * STAGED ONLY: fixed public-collection queries via Firestore REST runQuery.
 * This module never connects to Firebase: a trusted adapter must supply the
 * authenticated service-account REST transport.
 */
const DB="projects/sales-management-cc116/databases/(default)/documents";
const ALLOWED=new Set(["publicRecords","publicRecordLines","publicProducts","publicRankEntries"]);
const TEAM_SCOPED=new Set(["publicRecords","publicRecordLines"]);
const ID=/^[a-zA-Z0-9_:-]{1,200}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const fail=()=>{throw Error("Invalid public-only Firestore query or response");};

function validate(o){
 if(!o||!ALLOWED.has(o.collection)||!ID.test(o.companyId??"")||
   !Number.isSafeInteger(o.limit)||o.limit<1||o.limit>50||
   typeof o.startAfter!=="string"||(o.startAfter&&!ID.test(o.startAfter))||
   (o.snapshotTime!=null&&!TIME.test(o.snapshotTime))||
   TEAM_SCOPED.has(o.collection)!==Boolean(o.teamId)||
   (o.teamId&&!ID.test(o.teamId)))fail();
}
export function buildPublicRunQuery(o){
 validate(o);
 const filters=[{fieldFilter:{field:{fieldPath:"companyId"},op:"EQUAL",
   value:{stringValue:o.companyId}}}];
 if(o.teamId)filters.push({fieldFilter:{field:{fieldPath:"teamId"},
   op:"EQUAL",value:{stringValue:o.teamId}}});
 const structuredQuery={
   from:[{collectionId:o.collection}],
   where:filters.length===1?filters[0]:{compositeFilter:{op:"AND",filters}},
   orderBy:[{field:{fieldPath:"__name__"},direction:"ASCENDING"}],
   limit:o.limit
 };
 if(o.startAfter)structuredQuery.startAt={before:false,
   values:[{referenceValue:DB+"/"+o.collection+"/"+o.startAfter}]};
 const body={structuredQuery};
 if(o.snapshotTime)body.readTime=o.snapshotTime;
 return {method:"POST",endpoint:"https://firestore.googleapis.com/v1/"+DB+":runQuery",body};
}
function typed(v){
 if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length!==1)fail();
 if(typeof v.stringValue==="string")return v.stringValue;
 if(typeof v.booleanValue==="boolean")return v.booleanValue;
 if(typeof v.integerValue==="string" && /^-?\d+$/.test(v.integerValue)){
   const n=Number(v.integerValue);if(!Number.isSafeInteger(n))fail();return n;
 }
 if(typeof v.doubleValue==="number"&&Number.isFinite(v.doubleValue))return v.doubleValue;
 fail(); // Never deserialize nested maps, arrays, or arbitrary bytes.
}
export function decodePublicRunQuery(rows,o){
 validate(o);
 if(!Array.isArray(rows)||!rows.length)fail();
 const prefix=DB+"/"+o.collection+"/";
 let readTime="",last=o.startAfter;
 const items=[];
 for(const row of rows){
   if(!row||typeof row!=="object"||!TIME.test(row.readTime??"")||
      row.skippedResults>0)fail();
   if(!readTime)readTime=row.readTime;
   if(readTime!==row.readTime||(o.snapshotTime&&row.readTime!==o.snapshotTime))fail();
   if(!row.document)continue;
   const doc=row.document;
   if(typeof doc.name!=="string"||!doc.name.startsWith(prefix))fail();
   const id=doc.name.slice(prefix.length);
   if(!ID.test(id)||id<=last||!doc.fields||typeof doc.fields!=="object")fail();
   const fields=Object.fromEntries(
     Object.entries(doc.fields).map(([key,value])=>[key,typed(value)]));
   if(fields.sourceId!==id||fields.companyId!==o.companyId||
      (o.teamId&&fields.teamId!==o.teamId))fail();
   items.push(fields);last=id;
   if(items.length>o.limit)fail();
 }
 return {items,readTime};
}
export function createPublicFirestoreReader({executeRunQuery}={}){
 return async options=>{
   if(typeof executeRunQuery!=="function")fail();
   const query=buildPublicRunQuery(options);
   const rows=await executeRunQuery(query);
   return decodePublicRunQuery(rows,options);
 };
}
