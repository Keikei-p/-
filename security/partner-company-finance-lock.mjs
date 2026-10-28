/**
 * CANDIDATE FIRESTORE RULES FOR LOCAL EMULATOR ONLY.
 * Restricts direct reads/writes to money-bearing documents in partner
 * companies. This candidate MUST NOT be deployed before old PWA clients
 * migrate to the separate count-only registration API.
 */
export function buildPartnerFinanceLockCandidate(base){
 if(typeof base!=="string"||!base.startsWith("rules_version = '2';"))
   throw Error("Unexpected base rules");
 const anchor="    function canViewRevenue(companyId) {";
 if(base.split(anchor).length!==2)throw Error("Finance helper changed");
 const helper=[
  "    function canReadWriteRawFinance(companyId) {",
  "      return companyId != null",
  "        && exists(companyPath(companyId))",
  "        && get(companyPath(companyId)).data.get('companyKind', 'internal') != 'partner';",
  "    }",
  ""
 ].join("\n");
 let transformed=base.replace(anchor,helper+"\n"+anchor);
 const collections=["products","records","recordCorrections","revenueGoals"];
 const matches=["productId","recordId","correctionId","goalId"];
 for(let i=0;i<collections.length;i++){
   const name=collections[i],match="    match /"+name+"/{"+matches[i]+"} {";
   const start=transformed.indexOf(match);
   const nextMatch=transformed.indexOf("\n    match /",start+match.length);
   const end=nextMatch>=0?nextMatch:transformed.lastIndexOf("\n  }\n}");
   if(start<0||end<0||transformed.indexOf(match,start+match.length)>=0)
     throw Error("Raw financial rule changed: "+name);
   let region=transformed.slice(start,end);
   for(const op of ["read","create","update"]){
     const pattern="allow "+op+": if ";
     if(!region.includes(pattern)){
       if(name==="recordCorrections"&&op==="update")continue;
       throw Error("Missing raw finance verb: "+name+"/"+op);
     }
     region=region.replace(pattern,
       pattern+"canReadWriteRawFinance("+
       (op==="read"?"resource.data.companyId":
        op==="create"?"request.resource.data.companyId":"resource.data.companyId")+
       ") && ");
   }
   if(name==="records"){
     const pattern="allow get: if ";
     if(!region.includes(pattern))throw Error("Missing record get gate");
     region=region.replace(pattern,
       pattern+"canReadWriteRawFinance(currentCompanyId()) && ");
   }
   transformed=transformed.slice(0,start)+region+transformed.slice(end);
 }
 return transformed;
}
