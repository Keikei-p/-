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
  const databaseMatch="match /databases/{database}/documents {";
  if(next.split(databaseMatch).length!==2 ||
     next.includes("function isInternalFinanceReader("))
    throw Error("Unexpected candidate rules structure");
  // A partner company's owner/master is a partner, regardless of owner role.
  const helper=[
    "",
    "    function isInternalFinanceReader(companyId) {",
    "      return companyId != null",
    "        && exists(companyPath(companyId))",
    "        && exists(userPath(request.auth.uid))",
    "        && exists(memberPath(companyId, request.auth.uid))",
    "        && get(companyPath(companyId)).data.get('active', true) == true",
    "        && get(companyPath(companyId)).data.get('companyKind', 'internal') != 'partner'",
    "        && get(companyPath(companyId)).data.get('companyKind', 'internal') != 'cooperator'",
    "        && get(userPath(request.auth.uid)).data.get('accessKind', 'internal') != 'partner'",
    "        && get(memberPath(companyId, request.auth.uid)).data.get('accessKind', 'internal') != 'partner'",
    "        && get(userPath(request.auth.uid)).data.get('memberType', 'internal') != 'cooperator'",
    "        && get(memberPath(companyId, request.auth.uid)).data.get('memberType', 'internal') != 'cooperator'",
    "        && get(userPath(request.auth.uid)).data.get('memberType', 'internal') != 'partner'",
    "        && get(memberPath(companyId, request.auth.uid)).data.get('memberType', 'internal') != 'partner';",
    "    }",
    ""
  ].join("\n");
  next=next.replace(databaseMatch,databaseMatch+helper);
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
      "        && isInternalFinanceReader(resource.data.companyId)\n"+
      "        && (isCompanyMaster(resource.data.companyId) || isCompanyOwner(resource.data.companyId));");
    next=next.slice(0,start)+closed+next.slice(start+region.length);
  }
  // Revenue goals store monetary targets too. They cannot remain directly
  // readable by a partner just because an incorrect canViewRevenue flag exists.
  const revenueGroup="match /revenueGoals/{goalId} {";
  const revenuePos=next.indexOf(revenueGroup);
  if(revenuePos<0||next.indexOf(revenueGroup,revenuePos+revenueGroup.length)>=0)
    throw Error("Missing or repeated revenueGoals rule");
  const readStart=next.indexOf("allow read:",revenuePos+revenueGroup.length);
  const createStart=next.indexOf("allow create:",readStart);
  if(readStart<0||createStart<0)throw Error("Invalid revenueGoals rule");
  const previous=next.slice(readStart,createStart);
  if(!previous.includes("sameCompany(resource.data.companyId)") ||
     !previous.includes("canViewRevenue(resource.data.companyId)"))
    throw Error("Unexpected revenue goals read boundary");
  next=next.slice(0,readStart)+
    "allow read: if resource.data.companyId != null\n"+
    "        && isInternalFinanceReader(resource.data.companyId)\n"+
    "        && (isCompanyMaster(resource.data.companyId) || isCompanyOwner(resource.data.companyId));\n\n      "+
    next.slice(createStart);
  if(next===phase1)throw Error("No finance rules changed in staging model");
  return next;
}
