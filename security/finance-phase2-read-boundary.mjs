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
  // Partner/cooperator and UNKNOWN company/access markers must be denied,
  // including if a mistaken Owner/Master finance flag is present. Keep the
  // legacy absent-marker default for already established internal accounts.
  const helper=[
    "",
    "    function isInternalFinanceReader(companyId) {",
    "      return companyId != null",
    "        && exists(companyPath(companyId))",
    "        && exists(userPath(request.auth.uid))",
    "        && exists(memberPath(companyId, request.auth.uid))",
    "        && get(companyPath(companyId)).data.get('active', true) == true",
    "        && get(companyPath(companyId)).data.get('companyKind', 'internal') == 'internal'",
    "        && get(userPath(request.auth.uid)).data.get('accessKind', 'internal') == 'internal'",
    "        && get(memberPath(companyId, request.auth.uid)).data.get('accessKind', 'internal') == 'internal'",
    "        && get(userPath(request.auth.uid)).data.get('memberType', 'internal')",
    "             in ['internal', 'direct', 'member', 'managed']",
    "        && get(memberPath(companyId, request.auth.uid)).data.get('memberType', 'internal')",
    "             in ['internal', 'direct', 'member', 'managed']",
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
    let closed=region.replace(open,
      "allow read: if resource.data.companyId != null\n"+
      "        && isInternalFinanceReader(resource.data.companyId)\n"+
      "        && (isCompanyMaster(resource.data.companyId) || isCompanyOwner(resource.data.companyId));");
    // Deny creating/updating financial originals to ALL partner roles,
    // including the owner/master of a separate partner company. Wrap the
    // ENTIRE legacy condition, otherwise its internal OR clauses can bypass
    // the new guard. Physical deletion is never part of this cutover.
    const expected={records:["create","update","delete"],
      products:["create","update","delete"],
      recordCorrections:["create"]}[group];
    const writeRule=/allow (create|update|delete):\s*if\s*([\s\S]*?);/g;
    const writes=[...closed.matchAll(writeRule)];
    if(writes.length!==expected.length||
       writes.some((m,i)=>m[1]!==expected[i]))
      throw Error("Unexpected finance write rules for "+group);
    closed=closed.replace(writeRule,(_full,action,condition)=>{
      if(action==="delete")return "allow delete: if false;";
      const source=action==="create"
        ?"request.resource.data.companyId":"resource.data.companyId";
      return "allow "+action+": if isInternalFinanceReader("+source+")\n"+
        "        && ("+condition.trim()+");";
    });
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
  // Revenue goals are money-bearing too. Every write must be guarded.
  const revStart=next.indexOf(revenueGroup);
  const revEnd=next.indexOf("match /",revStart+revenueGroup.length);
  const revBody=next.slice(revStart,revEnd<0?undefined:revEnd);
  const revRule=/allow (create|update|delete):\s*if\s*([\s\S]*?);/g;
  const found=[...revBody.matchAll(revRule)];
  if(found.length!==3||found.map(m=>m[1]).join(",")!=="create,update,delete")
    throw Error("Unexpected revenue goals writes");
  const hardened=revBody.replace(revRule,(_all,action,original)=>{
    if(action==="delete")return "allow delete: if false;";
    const source=action==="create"
      ?"request.resource.data.companyId":"resource.data.companyId";
    return "allow "+action+": if isInternalFinanceReader("+source+")"+
      "\n        && ("+original.trim()+");";
  });
  next=next.slice(0,revStart)+hardened+
    next.slice(revStart+revBody.length);
  if(next===phase1)throw Error("No finance rules changed in staging model");
  return next;
}
