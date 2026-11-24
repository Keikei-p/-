#!/usr/bin/env node
/**
 * Complete, bounded READ ONLY partner history inventory. One Firestore
 * read-only transaction; document-ID pagination; no export or local files.
 * Only projected count/catalog metadata is read. Financial master fields,
 * account profiles, staff names, authentication and history are not fetched.
 */
import {createRequire} from "node:module";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {inventoryPartnerFullHistory} from "../../ranking/partner-full-history-inventory.mjs";

const PROJECT="sales-management-cc116";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const id=x=>typeof x==="string"&&ID.test(x)&&!["__proto__","constructor","prototype"].includes(x);
const fail=reason=>{throw Error("STOP_PARTNER_FULL_HISTORY_READONLY_"+reason);};
export const HISTORY_READ_LIMITS=Object.freeze({pageSize:100,companies:200,relations:200,
 products:1000,entriesPerCompany:10000,privateProductsPerCompany:1000,reports:20000,
 totalDocuments:50000,totalQueries:2000});
const ENTRY_FIELDS=Object.freeze(["id","companyId","hubCompanyId","date","staffId","version",
 "counts","totalCount","privateCounts","privateTotalCount","publishedCounts","publishedTotalCount","ownerProductCounts","ownerProductTotalCount"]);
const REPORT_FIELDS=Object.freeze(["hubCompanyId","partnerCompanyId","date","source","version",
 "counts","totalCount","publishedCounts","publishedTotalCount","ownerProductCounts","ownerProductTotalCount"]);
function readTime(s){
 const t=s?.readTime;
 if(!Number.isSafeInteger(t?.seconds)||!Number.isSafeInteger(t?.nanoseconds)||
    t.nanoseconds<0||t.nanoseconds>=1000000000||typeof t?.toDate!=="function")fail("SNAPSHOT_TIME");
 const d=t.toDate();
 if(!(d instanceof Date)||!Number.isFinite(d.getTime()))fail("SNAPSHOT_TIME");
 return {key:t.seconds+":"+t.nanoseconds,iso:d.toISOString()};
}
const data=s=>{
 if(s?.exists!==true||typeof s?.data!=="function")fail("DOCUMENT");
 const v=s.data();
 if(!v||typeof v!=="object"||Array.isArray(v))fail("DOCUMENT");
 return v;
};

/**
 * Admin SDK must be configured for PROJECT before calling. Returns ONLY
 * pseudonymous company/month/product summaries, never source documents.
 * An incomplete page, changed read time or exhausted bound throws, so a
 * first-page result can never be reported as a complete historical inventory.
 */
export async function inspectPartnerFullHistory({db,documentId,
 pseudonymKey=randomBytes(32).toString("hex"),limits={}}={}){
 if(typeof db?.collection!=="function"||typeof db?.collectionGroup!=="function"||
    typeof db?.runTransaction!=="function"||!documentId||
    !limits||typeof limits!=="object"||Array.isArray(limits)||
    Object.keys(limits).some(k=>!Object.hasOwn(HISTORY_READ_LIMITS,k)))fail("DEPENDENCY");
 const bound={...HISTORY_READ_LIMITS,...limits};
 for(const [key,value] of Object.entries(bound))
  if(!Number.isSafeInteger(value)||value<1||value>HISTORY_READ_LIMITS[key])fail("LIMIT_CONFIG");
 return db.runTransaction(async tx=>{
  if(typeof tx?.get!=="function")fail("TRANSACTION");
  let baseline=null,documentsRead=0,queriesRead=0;
  const consistent=s=>{
   const time=readTime(s);
   if(baseline&&baseline.key!==time.key)fail("MIXED_SNAPSHOTS");
   baseline??=time;
  };
  const getDoc=async ref=>{
   if(++documentsRead>bound.totalDocuments||++queriesRead>bound.totalQueries)fail("GLOBAL_READ_LIMIT");
   const s=await tx.get(ref);consistent(s);
   return s?.exists===true?data(s):null;
  };
  const scan=async(query,max)=>{
   const rows=[],seen=new Set();let cursor=null;
   const ordered=query.orderBy(documentId);
   for(let page=0;page<=Math.floor(max/bound.pageSize)+1;page++){
    if(++queriesRead>bound.totalQueries)fail("GLOBAL_QUERY_LIMIT");
    let q=ordered.limit(bound.pageSize);
    if(cursor)q=q.startAfter(cursor);
    const snapshot=await tx.get(q);consistent(snapshot);
    if(!Array.isArray(snapshot?.docs)||snapshot.docs.length>bound.pageSize)fail("PAGE_SHAPE");
    for(const s of snapshot.docs){
     const p=s?.ref?.path;
     if(typeof p!=="string"||!id(s.id)||seen.has(p))fail("PAGE_DUPLICATE");
     consistent(s);seen.add(p);
     if(++documentsRead>bound.totalDocuments||rows.length>=max)fail("DOCUMENT_LIMIT");
     rows.push({id:s.id,path:p,value:data(s)});
    }
    if(snapshot.docs.length<bound.pageSize)return rows;
    cursor=snapshot.docs.at(-1);
   }
   fail("PAGINATION_INCOMPLETE");
  };
  const companyRows=await scan(db.collection("companies")
   .select("companyKind","ownerUid","hubCompanyId","active"),bound.companies);
  const relationRows=await scan(db.collection("partnerRelations")
   .select("partnerCompanyId","hubCompanyId","active","countSharingApproved"),bound.relations);
  const relations=relationRows.map(({id:docId,value:v})=>{
   if(v.partnerCompanyId!==docId||!id(v.hubCompanyId))fail("RELATION_IDENTITY");
   return {partnerCompanyId:docId,hubCompanyId:v.hubCompanyId,
    active:v.active===true,countSharingApproved:v.countSharingApproved===true};
  });
  const companiesById=new Map(companyRows.map(x=>[x.id,x.value]));
  const partners=companyRows.filter(x=>x.value.companyKind==="partner");
  const hubIds=new Set([...partners.map(x=>x.value.hubCompanyId),...relations.map(x=>x.hubCompanyId)]);
  if(hubIds.size>20)fail("HUB_LIMIT");
  const hubs=[];
  for(const hubId of [...hubIds].sort()){
   const h=companiesById.get(hubId);
   if(!id(hubId)||!h||h.companyKind==="partner"||!id(h.ownerUid))fail("HUB_IDENTITY");
   const ref=db.collection("companies").doc(hubId);
   const visibility=await getDoc(ref.collection("rankingProductVisibility").doc("shared"));
   const mapping=await getDoc(ref.collection("rankingSkuMappings").doc("shared"));
   const catalog=await getDoc(ref.collection("rankingCountPublicCatalog").doc("shared"));
   // Explicit field projection prevents fetching unit prices or sales fields
   // even though owner master documents also contain those financial fields.
   const products=await scan(db.collection("products").where("companyId","==",hubId)
    .select("companyId","name","active"),bound.products);
   hubs.push({id:hubId,ownerUid:h.ownerUid,visibility,mapping,catalog,
    ownerProducts:products.map(p=>({id:p.id,...p.value}))});
  }
  const companies=partners.map(partner=>{
   if(!id(partner.value.hubCompanyId))fail("PARTNER_HUB");
   return {id:partner.id,hubCompanyId:partner.value.hubCompanyId,
    active:partner.value.active===true,entries:[],privateProducts:[]};
  });
  const partnerMap=new Map(companies.map(c=>[c.id,c]));
  // A missing company parent must not hide orphan historical originals.
  // Projected collection-group scans find every actual descendant, then
  // exact paths and the company scope are checked before reconciliation.
  const entryRows=await scan(db.collectionGroup("partnerWorkEntries").select(...ENTRY_FIELDS),bound.totalDocuments);
  for(const row of entryRows){
   const parts=row.path.split("/");
   if(parts.length!==4||parts[0]!=="companies"||parts[2]!=="partnerWorkEntries")continue;
   const company=partnerMap.get(parts[1]);
   if(!company||row.value.companyId!==company.id||row.value.hubCompanyId!==company.hubCompanyId)
    fail("ORPHAN_ENTRY_SCOPE");
   if(Object.hasOwn(row.value,"id")&&row.value.id!==row.id)fail("ENTRY_DOCUMENT_ID");
   if(company.entries.length>=bound.entriesPerCompany)fail("ENTRY_LIMIT");
   company.entries.push({...row.value,id:row.id});
  }
  const privateRows=await scan(db.collectionGroup("partnerPrivateProducts")
   .select("companyId","name","active","origin","visibility"),bound.totalDocuments);
  for(const row of privateRows){
   const parts=row.path.split("/");
   if(parts.length!==4||parts[0]!=="companies"||parts[2]!=="partnerPrivateProducts")continue;
   const company=partnerMap.get(parts[1]);
   if(!company||row.value.companyId!==company.id)fail("ORPHAN_PRIVATE_PRODUCT_SCOPE");
   if(company.privateProducts.length>=bound.privateProductsPerCompany)fail("PRIVATE_PRODUCT_LIMIT");
   company.privateProducts.push({id:row.id,...row.value});
  }
  // Day parent documents need not exist when a reports child exists. Query
  // the projected collection group to include those descendants as well.
  // No custom index or write is needed for document-ID-only pagination.
  const reportRows=await scan(db.collectionGroup("reports").select(...REPORT_FIELDS),bound.reports);
  const reports=[];
  for(const row of reportRows){
   const parts=row.path.split("/");
   if(parts.length!==6||parts[0]!=="companies"||parts[4]!=="reports"||
      !["partnerWorkCountDays","partnerQuickCountDays"].includes(parts[2]))continue;
   if(!hubIds.has(parts[1])||row.value.hubCompanyId!==parts[1]||
      row.value.partnerCompanyId!==parts[5]||row.value.date!==parts[3])fail("REPORT_PATH_IDENTITY");
   reports.push({...row.value,kind:parts[2]==="partnerWorkCountDays"?"staff":"quick"});
  }
  const report=inventoryPartnerFullHistory({hubs,companies,relations,reports,pseudonymKey,proof:{
   serverVerified:true,snapshotConsistent:true,completeCompanies:true,completeRelations:true,
   completeEntries:true,completePrivateProducts:true,completeReports:true,completeOwnerProducts:true,
   completeSettings:true,readTime:baseline.iso
  }});
  return {...report,readDocumentCount:documentsRead,readQueryCount:queriesRead,
   sourceDocumentsExported:0,financialMasterFieldsRead:0};
 },{readOnly:true});
}

async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--read-only"||
    process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"||!process.env.GOOGLE_APPLICATION_CREDENTIALS||
    JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8")).projects.default!==PROJECT)
  fail("RUNTIME");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getFirestore,FieldPath}=require("firebase-admin/firestore");
 initializeApp({credential:applicationDefault(),projectId:PROJECT});
 const report=await inspectPartnerFullHistory({db:getFirestore(),documentId:FieldPath.documentId()});
 console.log("NICO_PARTNER_FULL_HISTORY_READONLY "+JSON.stringify({project:PROJECT,...report}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  const reason=/^(?:STOP_PARTNER_FULL_HISTORY_READONLY|PARTNER_FULL_HISTORY)_[A-Z_]+$/.test(e?.message??"")?
   e.message:"STOP_PARTNER_FULL_HISTORY_READONLY_UNVERIFIED";
  console.error(reason);process.exitCode=1;
 });
