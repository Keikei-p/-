#!/usr/bin/env node
/**
 * Production READ ONLY. Check the exact count-only Owner SKU publication
 * prerequisites used by save, correction and joint standings.
 * Do not read sales products, price masters, records, users, tokens or
 * document contents into logs. Only bounded boolean/count summaries.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
const PROJECT="sales-management-cc116";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:revenue|sales|price|cashback|amount|commission|profit|salary|単価|売上|金額|報酬|利益|キャッシュバック)/i;
const fail=reason=>{throw Error("STOP_SKU_PUBLICATION_READONLY_"+reason);};
const obj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const id=x=>typeof x==="string"&&ID.test(x)&&!["__proto__","constructor","prototype"].includes(x);
const bool=x=>x===true;
const unique=x=>Array.isArray(x)&&x.length<=1000&&x.every(id)&&new Set(x).size===x.length;
function financialFields(v,depth=0){
 if(depth>10)return true;
 if(Array.isArray(v))return v.length>1000||v.some(x=>financialFields(x,depth+1));
 if(!obj(v))return false;
 const keys=Object.keys(v);
 return keys.length>1000||keys.some(k=>MONEY.test(k)||financialFields(v[k],depth+1));
}
export function assessSkuPublication({hubId,ownerUid,relations,visibility,mapping,catalog,approvals=[]}={}){
 if(!id(hubId)||!id(ownerUid)||!Array.isArray(relations)||
    relations.length>100||!Array.isArray(approvals)||approvals.length!==relations.length)
  fail("BAD_SCOPE");
 if(new Set(relations.map(r=>r.partnerCompanyId)).size!==relations.length||
    relations.some(r=>!obj(r)||!id(r.partnerCompanyId)||r.partnerCompanyId===hubId||
     r.hubCompanyId!==hubId||r.active!==true||r.countSharingApproved!==true))
  fail("RELATION_UNTRUSTED");
 const mappedPartnerCount=relations.length;
 if(!visibility||!mapping||!catalog)return Object.freeze({
  publishedCatalogReady:false,mappingsReviewed:false,companyScopedOnOffReady:false,
  reciprocalOwnerRankConsentReady:false,partnerCompanyCount:mappedPartnerCount,
  partnerCompaniesMapped:0,enabledCategoriesMappedToAllPartners:false
 });
 if(financialFields(visibility)||financialFields(mapping)||financialFields(catalog))
  fail("FINANCE_FIELD_IN_PUBLICATION");
 if(visibility.hubCompanyId!==hubId||visibility.ownerUid!==ownerUid||
    !Number.isSafeInteger(visibility.version)||visibility.version<1||
    !unique(visibility.enabledHubProductIds)||!obj(visibility.partnerOverrides)||
    Object.keys(visibility.partnerOverrides).length>100)fail("VISIBILITY");
 if(mapping.hubCompanyId!==hubId||mapping.ownerUid!==ownerUid||
    mapping.reviewedByUid!==ownerUid||mapping.active!==true||
    !Number.isSafeInteger(mapping.version)||mapping.version<1||
    !Array.isArray(mapping.bindings)||mapping.bindings.length>1000)
  fail("MAPPING");
 if(catalog.schema!=="nico-reviewed-count-public-catalog-v1"||
    catalog.hubCompanyId!==hubId||catalog.ownerUid!==ownerUid||
    catalog.version!==visibility.version||!Array.isArray(catalog.products)||
    catalog.products.length>1000)fail("CATALOG");
 const products=new Map();
 for(const row of catalog.products){
  if(!obj(row)||Object.keys(row).sort().join("|")!=="active|companyId|id|name"||
     !id(row.id)||row.companyId!==hubId||products.has(row.id)||
     typeof row.active!=="boolean"||typeof row.name!=="string"||
     row.name.length<1||row.name.length>80||
     MONEY.test(row.name))fail("PUBLIC_PRODUCT");
  products.set(row.id,row);
 }
 for(const productId of visibility.enabledHubProductIds)
  if(!products.has(productId))fail("UNREVIEWED_ENABLED_SKU");
 for(const [partnerId,ids] of Object.entries(visibility.partnerOverrides))
  if(!id(partnerId)||!relations.some(r=>r.partnerCompanyId===partnerId)||
     !unique(ids)||ids.some(x=>!products.has(x)))fail("PARTNER_OVERRIDES");
 const map=new Map(),ids=new Set();
 for(const bind of mapping.bindings){
  if(!obj(bind)||Object.keys(bind).sort().join("|")!=="companyId|hubProductId|productId"||
     !id(bind.companyId)||!id(bind.hubProductId)||
     !/^partnerSku0[1-9]$/.test(bind.productId)||!products.has(bind.hubProductId))
   fail("BINDING");
  const key=bind.companyId+":"+bind.productId;
  if(map.has(key))fail("DUPLICATE_MAPPING");
  map.set(key,bind.hubProductId);
  if(!relations.some(r=>r.partnerCompanyId===bind.companyId))continue;
  const pair=bind.companyId+":"+bind.hubProductId;
  if(ids.has(pair))fail("DUPLICATE_PARTNER_SKU");
  ids.add(pair);
  if(bind.productId==="partnerSku05"&&
    !/SB光・AIR|旧合算|未分類/.test(products.get(bind.hubProductId).name))
   fail("LEGACY_LIGHT_AIR_MAPPING");
 }
 let partnersReady=0,allEligibleMapped=true;
 for(const relation of relations){
  const pid=relation.partnerCompanyId;
  const visible=new Set(Object.hasOwn(visibility.partnerOverrides,pid)?
   visibility.partnerOverrides[pid]:visibility.enabledHubProductIds);
  const allowed=visibility.enabledHubProductIds.filter(x=>visible.has(x)&&products.get(x).active);
  const matched=[...map.entries()].filter(([key,product])=>
    key.startsWith(pid+":")&&allowed.includes(product));
  if(matched.length>0)partnersReady++;
  if(matched.length!==allowed.length)allEligibleMapped=false;
 }
 const reciprocal=approvals.every(x=>x&&x.hubApproved===true&&
  x.partnerApproved===true&&x.namesApproved===true);
 return Object.freeze({
  publishedCatalogReady:true,mappingsReviewed:true,
  companyScopedOnOffReady:true,reciprocalOwnerRankConsentReady:reciprocal,
  partnerCompanyCount:relations.length,partnerCompaniesMapped:partnersReady,
  enabledCategoriesMappedToAllPartners:allEligibleMapped
 });
}
const read=x=>x?.exists===true&&typeof x.data==="function"?x.data():null;
export async function inspectSkuPublication(db){
 if(typeof db?.collection!=="function")fail("MISSING_DB");
 const hubs=await db.collection("companies").select("companyKind","ownerUid","active")
  .limit(201).get();
 if(!Array.isArray(hubs?.docs)||hubs.docs.length>200)fail("COMPANY_LIMIT");
 let count=0,ready=0,mapping=0,consent=0,partnerCount=0,mappedPartners=0;
 const blockers=new Set();
 for(const doc of hubs.docs){
  const v=doc.data();
  if(v.active===false||v.companyKind==="partner")continue;
  if(!id(doc.id)||!id(v.ownerUid))fail("HUB_IDENTITY");
  count++;
  if(count>10)fail("HUB_LIMIT");
  const hub=db.collection("companies").doc(doc.id);
  const relSnapshot=await db.collection("partnerRelations")
   .where("hubCompanyId","==",doc.id)
   .select("partnerCompanyId","hubCompanyId","active",
    "countSharingApproved","combinedRankingApprovedByHub",
    "combinedRankingApprovedByPartner","individualNamesApprovedByHub",
    "individualNamesApprovedByPartner").limit(101).get();
  if(!Array.isArray(relSnapshot.docs)||relSnapshot.docs.length>100)
   fail("RELATION_LIMIT");
  const relations=relSnapshot.docs.filter(x=>x.data().active===true&&
   x.data().countSharingApproved===true).map(x=>x.data());
  const snaps=await Promise.all([
   hub.collection("rankingProductVisibility").doc("shared").get(),
   hub.collection("rankingSkuMappings").doc("shared").get(),
   hub.collection("rankingCountPublicCatalog").doc("shared").get()
  ]);
  // Ranking consent is an extra business gate. Never assume existence.
  const approved=await Promise.all(relations.map(async rel=>{
   const p=db.collection("companies").doc(rel.partnerCompanyId);
   const [lhs,rhs]=await Promise.all([
    hub.collection("rankingApprovals").doc(rel.partnerCompanyId).get(),
    p.collection("rankingApprovals").doc(doc.id).get()
   ]);
   const a=read(lhs),b=read(rhs);
   return {hubApproved:a?.active===true&&a.combinedRankingApproved===true&&
    rel.combinedRankingApprovedByHub===true,
    partnerApproved:b?.active===true&&b.combinedRankingApproved===true&&
    rel.combinedRankingApprovedByPartner===true,
    namesApproved:a?.individualNamesApproved===true&&
     b?.individualNamesApproved===true&&
     rel.individualNamesApprovedByHub===true&&
     rel.individualNamesApprovedByPartner===true};
  }));
  const result=assessSkuPublication({hubId:doc.id,ownerUid:v.ownerUid,
   relations,visibility:read(snaps[0]),mapping:read(snaps[1]),
   catalog:read(snaps[2]),approvals:approved});
  partnerCount+=result.partnerCompanyCount;
  mappedPartners+=result.partnerCompaniesMapped;
  if(result.publishedCatalogReady)ready++;
  else blockers.add("OWNER_PUBLIC_CATALOG_MISSING");
  if(result.mappingsReviewed&&result.enabledCategoriesMappedToAllPartners)mapping++;
  else blockers.add("PARTNER_SKU_MAPPING_INCOMPLETE");
  if(result.reciprocalOwnerRankConsentReady)consent++;
  else blockers.add("RECIPROCAL_RANK_CONSENT_INCOMPLETE");
 }
 if(count===0)fail("NO_INTERNAL_COMPANY");
 return Object.freeze({project:PROJECT,mode:"LIVE_READ_ONLY_NO_DEPLOY",
  hubCompanyCount:count,activeApprovedPartnerCount:partnerCount,
  mappedPartnerCount:mappedPartners,ownerPublicationCatalogReady:ready===count,
  allEnabledPartnerSkuMapped:mapping===count,
  reciprocalOwnerRankConsentReady:consent===count,
  ownerPublicationWriteFeatureEnabledInProd:false,
  realAccountCountSaveVerified:false,
  realPartnerFinanceGetListDeniedVerified:false,
  safeToEnableNewRanking:false,productionDocumentWrites:0,
  blockingReasons:[...blockers].sort()});
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS||
    JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8")).projects.default!==PROJECT)
   fail("RUNTIME");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getFirestore}=require("firebase-admin/firestore");
 initializeApp({credential:applicationDefault(),projectId:PROJECT});
 const report=await inspectSkuPublication(getFirestore());
 console.log("NICO_PARTNER_SKU_READINESS "+JSON.stringify(report));
 for(const reason of report.blockingReasons)console.log("BLOCK_"+reason);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  const code=/^STOP_SKU_PUBLICATION_READONLY_[A-Z_]+$/.test(e?.message||"")?
   e.message:"STOP_SKU_PUBLICATION_READONLY_UNVERIFIED";
  console.error(code);process.exitCode=1;
 });
