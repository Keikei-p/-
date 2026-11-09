"use strict";
// Count-only gate for explicitly mapped legacy categories. No historical writes.
const {readLinks}=require("./catalog-count-links.cjs");
const {loadPublication}=require("./catalog-publication.cjs");
function enforceLegacyPublication({linksDoc,publicationDoc,categories,date,previous,next}){
 const links=readLinks(linksDoc,categories).links;
 const published=new Set(loadPublication(publicationDoc).productIds);
 if(!previous||!next||typeof previous!=="object"||typeof next!=="object")
  throw Error("PARTNER_LEGACY_COUNTS_INVALID");
 for(const link of links){
  if(date<link.effectiveFrom||published.has(link.productId))continue;
  const before=previous[link.category],after=next[link.category];
  if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after)||after<0)
   throw Error("PARTNER_LEGACY_COUNTS_INVALID");
  // A retired category may be reduced to zero, but not increased or restored.
  if(after>before)throw Error("PARTNER_LEGACY_CATEGORY_UNPUBLISHED");
 }
 return true;
}
module.exports={enforceLegacyPublication};
