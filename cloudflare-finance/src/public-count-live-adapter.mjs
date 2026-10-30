/**
 * Live-capable Firestore/Identity Toolkit REST adapters for the existing
 * count-only read gateway. NO direct Firebase SDK/console writes.
 *
 * Strictly scoped to nonfinancial membership docs and the four explicitly
 * public count projections. Service credentials stay only inside the Worker.
 * Importing this module does not authorize any access: the route is OFF until
 * separate projection, cost and gateway approvals are present.
 */
import {createStagedCountGateway} from "../../security/staged-count-gateway.mjs";

const PROJECT="sales-management-cc116";
const ROOT="projects/"+PROJECT+"/databases/(default)/documents";
const FIRESTORE="https://firestore.googleapis.com/v1/"+ROOT;
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const MEMBER_PATH=[
 /^users\/[A-Za-z0-9_:-]{1,128}$/,
 /^companies\/[A-Za-z0-9_:-]{1,128}$/,
 /^companies\/[A-Za-z0-9_:-]{1,128}\/members\/[A-Za-z0-9_:-]{1,128}$/,
 /^teams\/[A-Za-z0-9_:-]{1,128}$/,
 /^partnerRelations\/[A-Za-z0-9_:-]{1,128}$/
];
const PUBLIC=new Set(["publicRecords","publicRecordLines","publicProducts","publicRankEntries"]);
const deny=()=>{throw Error("public_count_adapter_unavailable");};
const asDate=sec=>{
 if(typeof sec!=="string"||!/^\d{1,12}$/.test(sec))deny();
 const n=Number(sec);
 if(!Number.isSafeInteger(n)||n<0||n>253402300799)deny();
 return new Date(n*1000).toISOString();
};
function fromValue(v){
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
  return Object.fromEntries(Object.entries(v.mapValue.fields).map(([k,x])=>[k,fromValue(x)]));
 if(v.arrayValue&&Array.isArray(v.arrayValue.values??[]))
  return (v.arrayValue.values??[]).map(fromValue);
 deny();
}
function firestoreDoc(raw){
 if(!raw||typeof raw!=="object"||typeof raw.fields!=="object")deny();
 return Object.fromEntries(Object.entries(raw.fields).map(([k,v])=>[k,fromValue(v)]));
}
async function json(resp){
 if(!resp?.ok)deny();
 return resp.json();
}
function firestorePath(path){
 if(!MEMBER_PATH.some(x=>x.test(path)))deny();
 return path.split("/").map(encodeURIComponent).join("/");
}
function responseRows(raw){
 if(Array.isArray(raw))return raw;
 if(typeof raw!=="string"||!raw.trim())deny();
 try{
  const parsed=JSON.parse(raw);
  return Array.isArray(parsed)?parsed:[parsed];
 }catch{
  try{return raw.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  catch{deny();}
 }
}
/**
 * getServiceToken() must mint an OAuth token with BOTH datastore and
 * identitytoolkit scopes from a server-owned service account.
 */
export function makePublicCountRestAdapters({
 projectId=PROJECT,getServiceToken,fetcher=fetch
}={}){
 if(projectId!==PROJECT||typeof getServiceToken!=="function"||
   typeof fetcher!=="function")deny();
 const headers=async()=>({
  Authorization:"Bearer "+await getServiceToken(),
  "Content-Type":"application/json","Cache-Control":"no-store"
 });
 return Object.freeze({
  async loadAuthUser(uid){
   if(typeof uid!=="string"||!ID.test(uid))deny();
   const res=await fetcher(
    "https://identitytoolkit.googleapis.com/v1/projects/"+PROJECT+"/accounts:lookup",{
     method:"POST",headers:await headers(),
     body:JSON.stringify({localId:[uid],targetProjectId:PROJECT})
    });
   const body=await json(res);
   if(!Array.isArray(body.users)||body.users.length!==1)deny();
   const user=body.users[0];
   if(user.localId!==uid||user.emailVerified!==true||
     user.disabled===true||typeof user.validSince!=="string")deny();
   return {
    uid,disabled:false,emailVerified:true,
    tokensValidAfterTime:asDate(user.validSince)
   };
  },
  async readDocument(path){
   const url=FIRESTORE+"/"+firestorePath(path);
   const res=await fetcher(url,{method:"GET",headers:await headers()});
   if(res?.status===404)return null;
   return firestoreDoc(await json(res));
  },
  async executeRunQuery({endpoint,method,body}={}){
   if(method!=="POST"||endpoint!==FIRESTORE+":runQuery"||
      !body||typeof body!=="object"||
      !PUBLIC.has(body.structuredQuery?.from?.[0]?.collectionId)||
      body.structuredQuery.from.length!==1||
      body.structuredQuery.limit>50||body.structuredQuery.limit<1)deny();
   // Collection, filter, cursor, and snapshot are constructed only by
   // createPublicFirestoreReader (never user-supplied Firestore queries).
   const res=await fetcher(endpoint,{method:"POST",headers:await headers(),
     body:JSON.stringify(body)});
   if(!res?.ok)deny();
   return responseRows(await res.text());
  }
 });
}
export function makePublicCountRestHandler({
 enabled=false,projectId=PROJECT,getServiceToken,fetcher=fetch,
 subtle=globalThis.crypto?.subtle,nowSeconds
}={}){
 if(enabled!==true)return createStagedCountGateway({enabled:false});
 const adapters=makePublicCountRestAdapters({
  projectId,getServiceToken,fetcher
 });
 return createStagedCountGateway({
  enabled:true,projectId,fetchKeys:fetcher,subtle,nowSeconds,
  ...adapters
 });
}
