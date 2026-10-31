/**
 * Server-only partner catalog boundary, PURE (no Firestore calls or writes).
 * "Current company" products are the canonical source for partner selling.
 * Prices/revenue/cashback NEVER cross the company boundary. Partner-custom
 * products are permanently PRIVATE, including their names and counts.
 */
import {projectPublicProduct,assertPublicSchema} from "../security/public-projection.mjs";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const PRICE=/(?:売上|単価|利益|報酬|キャッシュバック|[¥￥$€]|(?:CB|revenue|unitPrice|cashback|commission)[ :_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万|千)?円)/i;
const deny=()=>{throw Error("Partner catalog denied or incomplete");};
const valid=x=>typeof x==="string"&&ID.test(x);
function name(x){
 if(typeof x!=="string")deny();
 const text=x.replace(/[\r\n\t]/g," ").trim();
 if(!text||text.length>80||PRICE.test(text))deny();
 return text;
}
function publicProduct(input){
 const row=projectPublicProduct(input);
 assertPublicSchema("publicProducts",[row]);
 if(!valid(row.companyId)||!valid(row.sourceId))deny();
 return row;
}
function customProduct(input,partnerCompanyId){
 if(!input||typeof input!=="object"||Array.isArray(input)||
   Object.keys(input).some(k=>![
     "companyId","productId","name","active","sortOrder","visibility"
   ].includes(k))||
   input.companyId!==partnerCompanyId||!valid(input.productId)||
   input.visibility!=="private"||input.active!==true&&input.active!==false||
   !Number.isSafeInteger(input.sortOrder)||input.sortOrder<0)deny();
 name(input.name);
 return input;
}
function verifyRelation(relation,hubCompanyId,partnerCompanyId){
 // Linked companies and consent may NEVER be trusted from browser input.
 if(!relation||relation.serverVerified!==true||relation.active!==true||
   relation.hubCompanyId!==hubCompanyId||
   relation.partnerCompanyId!==partnerCompanyId||
   relation.catalogAccessApproved!==true||relation.countSharingApproved!==true)
   deny();
}
/**
 * Called by a trusted backend with one verified reciprocal company relation.
 * Raw internal hubProducts may contain money fields but only projectPublicProduct
 * is ever serialized, never spread or returned as source objects.
 * localCustomProducts are separately stored name-only docs (no price).
 */
export function buildPartnerCatalog({
  hubCompanyId,partnerCompanyId,relation,hubProducts,localCustomProducts,
  audience="partner"
}){
 if(!valid(hubCompanyId)||!valid(partnerCompanyId)||
    hubCompanyId===partnerCompanyId ||
    !["partner","hub"].includes(audience) ||
    !Array.isArray(hubProducts)||!Array.isArray(localCustomProducts)||
    hubProducts.length>10000||localCustomProducts.length>10000)deny();
 verifyRelation(relation,hubCompanyId,partnerCompanyId);
 const merged=[];
 const seen=new Set();
 if(audience==="partner"){
  for(const raw of hubProducts){
   const p=publicProduct(raw);
   if(p.companyId!==hubCompanyId)deny();
   const key="shared:"+hubCompanyId+":"+p.sourceId;
   if(seen.has(key))deny();seen.add(key);
   if(p.active)merged.push({
     catalogId:key,canonicalCompanyId:hubCompanyId,canonicalProductId:p.sourceId,
     name:name(p.name),sortOrder:p.sortOrder,scope:"shared",visibility:"shared_counts"
   });
  }
 }else if(hubProducts.length){ // hub view does not need to ingest raw canonical master
   deny();
 }
 for(const raw of localCustomProducts){
  const item=customProduct(raw,partnerCompanyId);
  const key="custom:"+partnerCompanyId+":"+item.productId;
  if(seen.has(key))deny();seen.add(key);
  if(item.active!==true)continue;
  // Partner custom products never reach the internal hub, even as names.
  if(audience==="hub")continue;
  const row={
    catalogId:key,canonicalCompanyId:partnerCompanyId,
    canonicalProductId:item.productId,name:name(item.name),
    sortOrder:item.sortOrder,scope:"partner_custom",
    visibility:item.visibility
  };
  merged.push(row);
 }
 const catalog=merged.sort((a,b)=>a.sortOrder-b.sortOrder||a.catalogId.localeCompare(b.catalogId));
 for(const row of catalog){
  if(Object.keys(row).some(k=>/price|revenue|cashback|unitPrice|amount/i.test(k)))deny();
 }
 return {hubCompanyId,partnerCompanyId,audience,
  products:catalog,sharedCustomProductIds:[]};
}
/**
 * New custom products always have NO price fields, remain private by default,
 * and never overwrite legacy raw products. No writes are performed here.
 */
export function planCreatePartnerProduct({actor,partnerCompanyId,productId,productName,sortOrder=0}){
 if(!actor||actor.serverVerified!==true||actor.companyId!==partnerCompanyId||
    !valid(partnerCompanyId)||!valid(productId) ||
    !["owner","catalog_manager"].includes(actor.partnerCatalogRole)||
    !Number.isSafeInteger(sortOrder)||sortOrder<0)deny();
 return {
  companyId:partnerCompanyId,productId,name:name(productName),
  sortOrder,active:true,visibility:"private"
 };
}
export function planChangePartnerProduct({actor,existing,partnerCompanyId,nextVisibility}){
 if(!actor||actor.serverVerified!==true||actor.companyId!==partnerCompanyId ||
    !valid(partnerCompanyId)||actor.partnerCatalogRole!=="owner"||
    nextVisibility!=="private")deny();
 const item=customProduct(existing,partnerCompanyId);
 return {
  ...item,visibility:nextVisibility
 };
}
/**
 * In the global count contest, private products are excluded from other
 * companies' *counts and rankings*, not just hidden by label. Otherwise
 * combined totals can leak private sales via subtraction.
 * The partner still sees their own private counts within their own scope.
 */
export function filterPartnerCountLines({partnerCompanyId,customProducts,lines,audience}){
 if(!valid(partnerCompanyId)||!["hub","partner"].includes(audience)||
    !Array.isArray(lines)||!Array.isArray(customProducts))deny();
 const catalog=new Map(customProducts.map(x=>{
   const c=customProduct(x,partnerCompanyId);
   return [c.productId,c];
 }));
 if(catalog.size!==customProducts.length)deny();
 const result=[];
 for(const line of lines){
  if(!line||typeof line!=="object"||line.companyId!==partnerCompanyId||
    !valid(line.productId)||!Number.isSafeInteger(line.count)||line.count<0)deny();
  const item=catalog.get(line.productId);
  if(!item)deny();
  // No partner-custom count reaches the hub, regardless of caller flags.
  if(audience==="hub")continue;
  result.push({productId:line.productId,count:line.count});
 }
 return result;
}
