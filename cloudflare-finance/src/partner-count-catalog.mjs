/**
 * Signed partner count-only catalog endpoint. OFF by default.
 * Reads only partnerCountCatalog nonfinancial documents and trusted ACL docs.
 * Does not read products/records, expose money, mutate Firestore or publish.
 */
import {createFirebaseIdTokenVerifier}
 from "../../security/firebase-id-token-verifier.mjs";
import {createTrustedMembershipLoader}
 from "../../security/trusted-membership-loader.mjs";
import {makePublicCountRestAdapters}
 from "./public-count-live-adapter.mjs";
import {auditNoFinancialKeys}
 from "../../security/public-projection.mjs";

const PROJECT="sales-management-cc116";
const ORIGIN="https://nico-factory.web.app";
const RUN_QUERY="https://firestore.googleapis.com/v1/projects/"+PROJECT+
 "/databases/(default)/documents:runQuery";
const PREFIX="projects/"+PROJECT+"/databases/(default)/documents/partnerCountCatalog/";
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const MONEY=/(?:[¥￥$€]|(?:\d|[０-９])[\d０-９,.，]*\s*(?:万|千)?円|(?:\\d|[０-９])[\\d０-９,.，]*\\s*万(?:\\D|$)|(?:CB|cashback|revenue|unitprice|単価|売上|報酬|利益)[\s:_=-]*(?:\d|[０-９]))/i;
const deny=()=>{throw Error("partner_catalog_denied");};
function reply(status,data,origin=""){
 const headers={"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer","Vary":"Origin"};
 if(origin===ORIGIN)headers["Access-Control-Allow-Origin"]=ORIGIN;
 return new Response(JSON.stringify(data),{status,headers});
}
function unpack(v){
 if(typeof v?.stringValue==="string")return v.stringValue;
 if(typeof v?.booleanValue==="boolean")return v.booleanValue;
 deny();
}
function rowsFrom(text){
 if(typeof text!=="string"||!text.trim())deny();
 try{const v=JSON.parse(text);return Array.isArray(v)?v:[v];}
 catch{try{return text.trim().split(/\r?\n/).map(x=>JSON.parse(x));}
 catch{deny();}}
}
function safeRow(doc,ownerId,hubId,partnerId){
 if(!doc||typeof doc.name!=="string"||!doc.name.startsWith(PREFIX)||
    !doc.fields||typeof doc.fields!=="object")deny();
 const catalogId=doc.name.slice(PREFIX.length);
 if(!ID.test(catalogId)||MONEY.test(catalogId))deny();
 const keys=Object.keys(doc.fields).sort().join(",");
 if(keys!==["active","catalogId","ownerCompanyId","visibility"].sort().join(","))deny();
 const fields=Object.fromEntries(Object.entries(doc.fields)
  .map(([k,v])=>[k,unpack(v)]));
 auditNoFinancialKeys(fields);
 if(fields.catalogId!==catalogId||fields.ownerCompanyId!==ownerId||
    !ID.test(fields.ownerCompanyId)||typeof fields.active!=="boolean"||
    !["shared_counts","private"].includes(fields.visibility))deny();
 const isShared=ownerId===hubId&&catalogId.startsWith("shared:"+hubId+":")&&
   fields.visibility==="shared_counts";
 const isCustom=ownerId===partnerId&&
   catalogId.startsWith("custom:"+partnerId+":");
 if(!isShared&&!isCustom)deny();
 if(fields.active!==true)return null;
 // Deliberately derive a plain count category label from immutable ID.
 // Do not return private product master, commission, unit price or CB tiers.
 const prefix=isShared?"shared:"+hubId+":":"custom:"+partnerId+":";
 const label=catalogId.slice(prefix.length).replaceAll("_"," ").trim();
 if(!label||MONEY.test(label))deny();
 return {catalogId,name:label,visibility:fields.visibility};
}
export function createPartnerCountCatalogHandler({
 enabled=false,projectId=PROJECT,fetcher=fetch,
 getServiceToken,subtle=globalThis.crypto?.subtle,nowSeconds
}={}){
 if(enabled!==true)return async()=>reply(503,{error:"service_disabled"});
 if(projectId!==PROJECT||typeof getServiceToken!=="function"||
    typeof fetcher!=="function")deny();
 const adapters=makePublicCountRestAdapters({projectId,getServiceToken,fetcher});
 const authenticate=createFirebaseIdTokenVerifier({
  projectId,fetchKeys:fetcher,subtle,nowSeconds
 });
 const membership=createTrustedMembershipLoader({
  loadAuthUser:adapters.loadAuthUser,readDocument:adapters.readDocument
 });
 async function forOwner(ownerId,hubId,partnerId){
  if(!ID.test(ownerId))deny();
  const bearer=await getServiceToken();
  if(typeof bearer!=="string"||!bearer)deny();
  // A server-defined equality filter. Callers cannot choose a Firestore query.
  const body={structuredQuery:{
   from:[{collectionId:"partnerCountCatalog"}],
   where:{fieldFilter:{field:{fieldPath:"ownerCompanyId"},op:"EQUAL",
    value:{stringValue:ownerId}}},
   orderBy:[{field:{fieldPath:"__name__"},direction:"ASCENDING"}],
   limit:101
  }};
  const res=await fetcher(RUN_QUERY,{method:"POST",
   headers:{Authorization:"Bearer "+bearer,"Content-Type":"application/json",
    "Cache-Control":"no-store"},
   body:JSON.stringify(body)});
  if(!res?.ok)deny();
  const rows=rowsFrom(await res.text());
  const found=rows.filter(x=>x?.document);
  // Never report a plausible incomplete catalog in case of >100 products.
  if(found.length>100||rows.some(x=>x?.skippedResults>0))deny();
  const items=[],seen=new Set();
  for(const row of found){
   const item=safeRow(row.document,ownerId,hubId,partnerId);
   const id=row.document.name.slice(PREFIX.length);
   if(seen.has(id))deny();
   seen.add(id);
   if(item)items.push(item);
  }
  // An exact 100-result page could have more; refuse without guessing.
  if(found.length===100)deny();
  return items;
 }
 return async request=>{
  const origin=request?.headers?.get?.("origin")??"";
  try{
   const url=new URL(request.url);
   if(origin!==ORIGIN||request.method!=="GET"||
      url.protocol!=="https:"||url.pathname!=="/v1/partner-count-catalog"||
      url.search!==""||url.hash!=="")return reply(403,{error:"request_blocked"},origin);
   const token=request.headers.get("authorization")?.match(
    /^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1];
   if(!token)return reply(401,{error:"unauthorized"},origin);
   const signed=await authenticate(token);
   const scope=await membership(signed.uid,signed);
   const company=await adapters.readDocument("companies/"+scope.companyId);
   if(company?.companyKind!=="partner"||!ID.test(company.hubCompanyId)||
      company.hubCompanyId===scope.companyId)deny();
   const [shared,custom]=await Promise.all([
    forOwner(company.hubCompanyId,company.hubCompanyId,scope.companyId),
    forOwner(scope.companyId,company.hubCompanyId,scope.companyId)
   ]);
   const teams=[];
   for(const teamId of scope.teamIds){
    if(!ID.test(teamId))deny();
    const team=await adapters.readDocument("teams/"+teamId);
    if(!team||team.active!==true||team.companyId!==scope.companyId||
       typeof team.name!=="string"||team.name.length<1||
       team.name.length>80||MONEY.test(team.name))deny();
    teams.push({teamId,name:team.name});
   }
   const products=[...shared,...custom].sort((a,b)=>a.name.localeCompare(b.name,"ja")||
    a.catalogId.localeCompare(b.catalogId));
   if(new Set(products.map(x=>x.catalogId)).size!==products.length)deny();
   return reply(200,{teams,products},origin);
  }catch{
   // Never leak company UIDs, Firestore response bodies or amounts.
   return reply(403,{error:"request_blocked"},origin);
  }
 };
}
