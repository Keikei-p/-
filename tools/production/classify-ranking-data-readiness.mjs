/**
 * Read-only status classifier for the EXISTING production count publication
 * documents. Do not query or log raw sales, prices, customers or identities.
 * This cannot authorize a release or change a runtime feature flag.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const safe=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const doc=d=>d===null||(d&&typeof d==="object"&&!Array.isArray(d));
const ids=a=>Array.isArray(a)&&a.length<=1000&&
 a.every(safe)&&new Set(a).size===a.length;
const stop=x=>{throw Error("STOP_RANKING_READINESS_"+x);};
export function classifyRankingReadiness({relations,hubs,sourceComplete=true}={}){
 if(sourceComplete!==true||!Array.isArray(relations)||relations.length>=100)
  stop("INCOMPLETE_RELATION_INVENTORY");
 if(!Array.isArray(hubs)||hubs.length>50||!hubs.every(x=>
    x&&safe(x.id)&&doc(x.visibility)&&doc(x.mapping)&&doc(x.catalog))||
   new Set(hubs.map(x=>x.id)).size!==hubs.length)stop("INVALID_HUB_DATA");
 const seen=new Set(),byHub=new Map(hubs.map(x=>[x.id,x]));
 for(const rel of relations){
  if(!rel||!safe(rel.hubCompanyId)||!safe(rel.partnerCompanyId)||
     typeof rel.active!=="boolean"||typeof rel.countSharingApproved!=="boolean"||
     seen.has(rel.partnerCompanyId)||!byHub.has(rel.hubCompanyId))
   stop("INVALID_RELATION_SCOPE");
  seen.add(rel.partnerCompanyId);
 }
 const approvedRelations=relations.filter(x=>x.active&&x.countSharingApproved);
 let visibilityDocs=0,mappingDocs=0,catalogDocs=0,
  enabledSkuTotal=0,skuBindings=0,catalogSkuTotal=0,readyHubs=0;
 for(const {id,visibility,mapping,catalog} of hubs){
  const rels=approvedRelations.filter(x=>x.hubCompanyId===id);
  const mappedIds=new Set();
  if(visibility!==null){
   if(!ids(visibility.enabledHubProductIds)||!
      Number.isSafeInteger(visibility.version)||visibility.version<0)
    stop("INVALID_VISIBILITY_SCHEMA");
   visibilityDocs++;enabledSkuTotal+=visibility.enabledHubProductIds.length;
  }
  if(mapping!==null){
   if(!Array.isArray(mapping.bindings)||mapping.bindings.length>5000||
      typeof mapping.active!=="boolean")stop("INVALID_MAPPING_SCHEMA");
   for(const b of mapping.bindings){
    if(!b||!safe(b.hubProductId)||!safe(b.companyId)||!
       safe(b.productId)||mappedIds.has(b.companyId+":"+b.productId))
      stop("INVALID_MAPPING_BINDINGS");
    mappedIds.add(b.companyId+":"+b.productId);
   }
   mappingDocs++;skuBindings+=mapping.bindings.length;
  }
  if(catalog!==null){
   if(!Array.isArray(catalog.products)||catalog.products.length>1000||
      !catalog.products.every(x=>x&&safe(x.id)))
     stop("INVALID_PUBLIC_CATALOG");
   catalogDocs++;catalogSkuTotal+=catalog.products.length;
  }
  const covered=mapping?.bindings?.some(x=>rels.some(r=>
    x.companyId===r.partnerCompanyId)&&
    visibility?.enabledHubProductIds?.includes(x.hubProductId)&&
    catalog?.products?.some(p=>p.id===x.hubProductId));
  if(rels.length>0&&visibility&&mapping?.active===true&&catalog&&covered)
   readyHubs++;
 }
 return Object.freeze({
  countOnly:true,
  relationsInspected:relations.length,
  activeApprovedRelations:approvedRelations.length,
  hubsInspected:hubs.length,
  visibilityDocumentsPresent:visibilityDocs,
  skuMappingDocumentsPresent:mappingDocs,
  publicCatalogDocumentsPresent:catalogDocs,
  publishedSkuReferences:enabledSkuTotal,
  reviewedSkuBindings:skuBindings,
  catalogSkuReferences:catalogSkuTotal,
  hubConfigurationsWithAtLeastOneLinkedSku:readyHubs,
  countRankingDataPreconditionsMet:relations.length>0&&
   approvedRelations.length===relations.length&&readyHubs===hubs.length,
  // No changes to production and no claims about user-specific security:
  realOwnerAuthenticatedSaveVerified:false,
  realPartnerFinanceGetListDeniedVerified:false,
  rankingRuntimeEnabled:false,
  productionWrites:0
 });
}
