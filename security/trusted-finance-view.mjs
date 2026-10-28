/**
 * Staging-only server projection, NEVER callable with client-supplied principal.
 * A future trusted gateway must first verify Firebase ID token AND read the
 * latest users/{uid}, companies/{companyId}/members/{uid}, owner and historical
 * team membership from Firestore. This module does NO network or database I/O.
 * Never return a raw records/products Firestore object to an app client.
 */
function fail(){throw Error("Financial view denied or incomplete");}
const isObj=v=>v&&typeof v==="object"&&!Array.isArray(v);
function money(v){
  if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0)fail();
  return v;
}
function safeId(v){
  if(typeof v!=="string"||!v||v.length>200)fail();
  return v;
}
export function projectTrustedFinancialView({record,principal}){
  if(!isObj(record)||!isObj(principal)||!isObj(principal.user)||!isObj(principal.member))
    fail();
  const {uid,companyId,user,member,allowedHistoricalTeamIds}=principal;
  if(!principal.firebaseIdTokenVerified || !principal.emailVerified ||
    !safeId(uid)||!safeId(companyId) ||
    user.uid!==uid || member.uid!==uid ||
    user.companyId!==companyId || member.companyId!==companyId ||
    user.active!==true || member.active!==true ||
    record.companyId!==companyId)
    fail();
  const owner=principal.serverVerifiedOwner===true &&
    user.companyRole==="owner" && member.companyRole==="owner";
  const teams=allowedHistoricalTeamIds;
  const permittedTeam=Array.isArray(teams)&&teams.length<=100 &&
    typeof record.teamId==="string" && record.teamId &&
    teams.includes(record.teamId);
  if(!owner&&!permittedTeam)fail();

  // Permission flags come ONLY from freshly read Firestore member document.
  // Owners are independently verified against the company owner document.
  const revenueAllowed=owner||member.canViewRevenue===true;
  const unitAllowed=owner||member.canViewUnitPrice===true;
  if(!revenueAllowed&&!unitAllowed)fail();

  const output={
    recordId:safeId(record.id),
    date:safeId(record.date),
    teamId:record.teamId==null?null:safeId(record.teamId),
    companyId,
  };
  if(revenueAllowed) output.totalRevenue=money(record.totalRevenue);

  if(unitAllowed){
    if(!isObj(record.results)||Object.keys(record.results).length>200)fail();
    const plans=[];
    for(const [sourceKey,result] of Object.entries(record.results)){
      if(!isObj(result))fail();
      const productId=safeId(result.productId??sourceKey);
      plans.push({productId,revenuePerUnit:money(result.revenuePerUnit)});
    }
    output.unitPrices=plans;
  }
  // No cashback, before/after maps, original results, product catalog, or
  // ranking scores are ever serialized, even to an authorized user.
  return output;
}
