/**
 * Pure staging-only company-spanning SKU mapping. No manual matching by name:
 * every partner uses the source hub's exact canonical product ID. Partner
 * private SKUs never get a public canonical rank mapping.
 */
import {assertPublicSchema} from "../security/public-projection.mjs";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const DENY=()=>{throw Error("Invalid or unapproved shared catalog ranking mapping");};
const safeId=x=>typeof x==="string"&&ID.test(x);
export function buildSharedCanonicalRankingGroups({
  hubCompanyId,hubPublicProducts,partnerRelations,
  partnerPublicCustomProducts=[]
}){
 if(!safeId(hubCompanyId)||!Array.isArray(hubPublicProducts)||
    !Array.isArray(partnerRelations)||!Array.isArray(partnerPublicCustomProducts)||
    hubPublicProducts.length>10000||partnerRelations.length>100||
    partnerPublicCustomProducts.length>10000)DENY();
 assertPublicSchema("publicProducts",hubPublicProducts);
 const products=hubPublicProducts.filter(p=>p.active===true);
 const productIds=new Set();
 for(const p of hubPublicProducts){
  if(p.companyId!==hubCompanyId||!safeId(p.sourceId)||productIds.has(p.sourceId))DENY();
  productIds.add(p.sourceId);
 }
 const partners=new Set();
 for(const r of partnerRelations){
  if(!r||r.serverVerified!==true||r.active!==true||
   r.hubCompanyId!==hubCompanyId||!safeId(r.partnerCompanyId)||
   r.partnerCompanyId===hubCompanyId||partners.has(r.partnerCompanyId)||
   r.catalogAccessApproved!==true||r.countSharingApproved!==true)DENY();
  partners.add(r.partnerCompanyId);
 }
 const groups=[];
 const push=(companyId,productId,groupId,groupName)=>{
  if(!safeId(companyId)||!safeId(productId)||!safeId(groupId)||
     typeof groupName!=="string"||!groupName||groupName.length>80)DENY();
  groups.push({companyId,productId,groupId,groupName});
 };
 for(const product of products){
  const groupId="canon:"+hubCompanyId+":"+product.sourceId;
  push(hubCompanyId,product.sourceId,groupId,product.name);
  for(const partnerCompanyId of partners){
    push(partnerCompanyId,"shared:"+hubCompanyId+":"+product.sourceId,groupId,product.name);
  }
 }
 const seenCustom=new Set();
 for(const p of partnerPublicCustomProducts){
  if(!p||p.visibility!=="shared_counts"||!partners.has(p.companyId)||
    !safeId(p.productId)||typeof p.name!=="string"||!p.name||
    p.name.length>80)DENY();
  const key=p.companyId+":"+p.productId;
  if(seenCustom.has(key))DENY();seenCustom.add(key);
  const groupId="partner:"+key;
  push(p.companyId,"custom:"+key,groupId,p.name);
 }
 if(new Set(groups.map(g=>g.companyId+":"+g.productId)).size!==groups.length)DENY();
 return groups;
}
