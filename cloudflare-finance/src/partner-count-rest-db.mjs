/**
 * Firestore REST transaction adapter for the append-only partner COUNT ledger.
 * Restricted documents only. No raw sales/finance writes, deletes, queries,
 * Firebase SDK, browser credentials, or deploy side effects.
 *
 * Caller supplies a server-owned OAuth bearer provider. All reads are bound
 * to one Firestore transaction. No automatic retry on ambiguous commits.
 */
const PROJECT="sales-management-cc116";
const ROOT="projects/"+PROJECT+"/databases/(default)/documents";
const BASE="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/databases/(default)";
const WRITABLE=new Set([
 "partnerCountRecords","partnerCountRevisions","partnerCountPublicRevisions",
 "partnerCountCorrections","partnerCountIdempotencyKeys","partnerCountDailyClaims"
]);
const TRUSTED=/^(?:users\/[A-Za-z0-9_:-]{1,128}|companies\/[A-Za-z0-9_:-]{1,128}(?:\/members\/[A-Za-z0-9_:-]{1,128})?|teams\/[A-Za-z0-9_:-]{1,128}|partnerRelations\/[A-Za-z0-9_:-]{1,128}|partnerCountCatalog\/[A-Za-z0-9_:-]{1,128})$/;
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const deny=()=>{throw Error("partner_count_rest_transaction_refused");};
const decode=v=>{
 if(!v||typeof v!=="object")deny();
 if(typeof v.stringValue==="string")return v.stringValue;
 if(typeof v.booleanValue==="boolean")return v.booleanValue;
 if(typeof v.integerValue==="string"&&/^-?\d+$/.test(v.integerValue)){
  const n=Number(v.integerValue);if(!Number.isSafeInteger(n))deny();return n;
 }
 if(typeof v.doubleValue==="number"&&Number.isFinite(v.doubleValue))return v.doubleValue;
 if(typeof v.timestampValue==="string")return v.timestampValue;
 if("nullValue" in v)return null;
 if(v.mapValue&&typeof v.mapValue.fields==="object")
  return Object.fromEntries(Object.entries(v.mapValue.fields).map(([k,x])=>[k,decode(x)]));
 if(v.arrayValue&&Array.isArray(v.arrayValue.values??[]))
  return (v.arrayValue.values??[]).map(decode);
 deny();
};
function encode(v){
 if(v===null)return {nullValue:null};
 if(typeof v==="string")return {stringValue:v};
 if(typeof v==="boolean")return {booleanValue:v};
 if(typeof v==="number"&&Number.isSafeInteger(v))
  return {integerValue:String(v)};
 if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
 if(v&&typeof v==="object"&&!Array.isArray(v))
  return {mapValue:{fields:encodeFields(v)}};
 deny();
}
function encodeFields(object){
 if(!object||typeof object!=="object"||Array.isArray(object))deny();
 const output={};
 for(const [key,v] of Object.entries(object)){
  if(typeof key!=="string"||!/^[A-Za-z0-9_:-]{1,128}$/.test(key)||
      v===undefined)deny();
  output[key]=encode(v);
 }
 return output;
}
function parseResponses(raw){
 if(typeof raw!=="string"||!raw.trim())deny();
 try{
  const decoded=JSON.parse(raw);
  return Array.isArray(decoded)?decoded:[decoded];
 }catch{
  try{return raw.trim().split(/\r?\n/).map(s=>JSON.parse(s));}
  catch{deny();}
 }
}
function allowedPath(path){
 if(typeof path!=="string")deny();
 const components=path.split("/");
 if(components.length===2&&WRITABLE.has(components[0])&&ID.test(components[1]))
  return path;
 if(TRUSTED.test(path))return path;
 deny();
}
const resource=p=>ROOT+"/"+p.split("/").map(encodeURIComponent).join("/");
export function makePartnerCountRestDb({
 projectId=PROJECT,getServiceToken,fetcher=fetch
}={}){
 if(projectId!==PROJECT||typeof getServiceToken!=="function"||
    typeof fetcher!=="function")deny();
 return Object.freeze({
  doc(path){return Object.freeze({path:allowedPath(path)});},
  async runTransaction(job){
   if(typeof job!=="function")deny();
   const token=await getServiceToken();
   if(typeof token!=="string"||!token)deny();
   const call=async(endpoint,payload)=>{
    const result=await fetcher(BASE+endpoint,{
     method:"POST",headers:{Authorization:"Bearer "+token,
       "Content-Type":"application/json","Cache-Control":"no-store"},
     body:JSON.stringify(payload)
    });
    if(!result?.ok)deny();
    return result;
   };
   const begin=await call("/documents:beginTransaction",{options:{readWrite:{}}});
   const tx=(await begin.json())?.transaction;
   if(typeof tx!=="string"||!tx)deny();
   let reads=0,staged=false,committed=false;
   const writes=[];
   const refs=new WeakSet();
   const ref=path=>{
    const item=Object.freeze({path:allowedPath(path)});
    refs.add(item);return item;
   };
   const raw={
    async get(documentRef){
     // Store constructs and tracks references with its own WeakMap;
     // validate path again at the final REST boundary.
     const path=allowedPath(documentRef?.path);
     if(staged||++reads>70)deny();
     const batch=await call("/documents:batchGet",{
      documents:[resource(path)],transaction:tx
     });
     const reply=parseResponses(await batch.text());
     if(reply.length!==1)deny();
     const row=reply[0];
     if(row.missing===resource(path))return {exists:false,data:()=>null};
     if(row.found?.name!==resource(path)||!row.found.fields)deny();
     const data=Object.fromEntries(Object.entries(row.found.fields)
      .map(([k,v])=>[k,decode(v)]));
     return {exists:true,data:()=>structuredClone(data)};
    },
    create(documentRef,data){
     const path=allowedPath(documentRef?.path);
     if(!WRITABLE.has(path.split("/")[0]))deny();
     if(writes.length>=8)deny();
     staged=true;
     writes.push({update:{name:resource(path),fields:encodeFields(data)},
      currentDocument:{exists:false}});
    },
    update(documentRef,data){
     const path=allowedPath(documentRef?.path);
     if(!path.startsWith("partnerCountRecords/"))deny();
     if(writes.length>=8)deny();
     staged=true;
     // No updateMask: replace the complete count-only current pointer, so
     // stale fields from an older version cannot survive invisibly.
     writes.push({update:{name:resource(path),fields:encodeFields(data)},
      currentDocument:{exists:true}});
    }
   };
   try{
    const result=await job(raw);
    if(writes.length===0)return result; // idempotent replay: rollback below
    if(writes.length>8)deny();
    const reply=await call("/documents:commit",{transaction:tx,writes});
    const ack=await reply.json();
    if(!Array.isArray(ack.writeResults)||ack.writeResults.length!==writes.length)
      deny();
    committed=true;
    return result;
   }finally{
    // No deletes EVER. On a timed-out commit the HTTP error is ambiguous;
    // client must re-read using the same retryKey before trying anything else.
    if(!committed){
     try{await call("/documents:rollback",{transaction:tx});}catch{}
    }
   }
  }
 });
}
