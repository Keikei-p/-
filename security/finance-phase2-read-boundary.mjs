/**
 * EMULATOR-ONLY: stage-2 finance closure candidate.
 * This NEVER writes or deploys any Firestore rules or records.
 * Replacing legacy read rules before the new client/gateway is fully live
 * would break the current production sales app and older cached PWAs.
 */
const GROUPS=["products","records","recordCorrections"];

export function modelOwnerOnlyFinanceRules(phase1){
  if(typeof phase1!=="string"||!phase1.includes("rules_version = '2'"))
    throw Error("Invalid staging rules");
  let next=phase1;
  for(const group of GROUPS){
    const marker="match /"+group+"/{";
    const pos=next.indexOf(marker);
    if(pos<0||next.indexOf(marker,pos+marker.length)>=0)
      throw Error("Missing or repeated finance collection "+group);
    const start=next.indexOf("{",pos+marker.length)+1;
    const end=next.indexOf("match /",start);
    const region=next.slice(start,end<0?undefined:end);
    const open=/allow read:\s*if resource\.data\.companyId != null\s*&& sameCompany\(resource\.data\.companyId\);/g;
    const count=[...region.matchAll(open)].length;
    if(count!==1)throw Error("Unexpected legacy finance rule for "+group);
    const closed=region.replace(open,
      "allow read: if resource.data.companyId != null\n"+
      "        && (isCompanyMaster(resource.data.companyId) || isCompanyOwner(resource.data.companyId));");
    next=next.slice(0,start)+closed+next.slice(start+region.length);
  }
  if(next===phase1)throw Error("No finance rules changed in staging model");
  return next;
}
