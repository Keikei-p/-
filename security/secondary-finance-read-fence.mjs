/**
 * Candidate finance-read rule for an active secondary partner. EMULATOR ONLY.
 * This generator never replaces/deploys the source Firestore Rules.
 * A legacy read-then-write count form may break after denying raw records;
 * real UID count continuity must be proved before any Rules change.
 */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
export const ORIGINAL_BLOB="d9f4df6a2ac0f8b5720534a2461ec66b94379190";
export const COLLECTIONS=Object.freeze(["products","records","recordCorrections","revenueGoals"]);
function gitBlob(value){
 const data=Buffer.from(value,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");
}
export const originalRules=()=>readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
function replaceOnce(source,before,after,name){
 if(typeof source!=="string"||source.split(before).length!==2)
  throw Error("FINANCE_READ_FENCE_UNKNOWN_RULES_"+name);
 return source.replace(before,after);
}
const guard=[
"    // A secondary partner must never inherit the old internal company's money reads.",
"    // The caller cannot supply this context: it comes from protected Firestore.",
"    function activeSecondaryPartnerForHub(companyId) {",
"      let ref = /databases/$(database)/documents/partnerWorkspaceContexts/$(request.auth.uid);",
"      return verifiedUser()",
"        && exists(ref)",
"        && get(ref).data.get('active', false) == true",
"        && get(ref).data.get('hubCompanyId', '') == companyId",
"        // Unknown active partner context types fail closed.",
"        && get(ref).data.get('kind', '') != 'internal';",
"    }"
].join("\n");
export function proposeSecondaryFinanceFence(source=originalRules()){
 if(typeof source!=="string"||gitBlob(source)!==ORIGINAL_BLOB)
  throw Error("FINANCE_READ_FENCE_BASE_RULES_CHANGED");
 let candidate=replaceOnce(source,
  "    match /products/{productId} {",
  guard+"\n\n    match /products/{productId} {","GUARD_INSERT");
 for(const name of COLLECTIONS){
  const marker="    match /"+name+"/{"+({
   products:"productId",records:"recordId",recordCorrections:"correctionId",
   revenueGoals:"goalId"
  })[name]+"} {";
  const pos=candidate.indexOf(marker);
  if(pos<0||candidate.indexOf(marker,pos+marker.length)!==-1)
   throw Error("FINANCE_READ_FENCE_MISSING_MATCH_"+name);
  let next=candidate.indexOf("\n    match /",pos+marker.length);
  // revenueGoals is the final root collection in the reviewed production file.
  if(next<0)next=candidate.lastIndexOf("\n  }\n}");
  if(next<=pos)throw Error("FINANCE_READ_FENCE_MISSING_BOUNDARY_"+name);
  const current=candidate.slice(pos,next);
  const old=name==="revenueGoals"?
   "      allow read: if resource.data.companyId != null\n"+
   "        && sameCompany(resource.data.companyId)\n"+
   "        && (":
   "      allow read: if resource.data.companyId != null\n"+
   "        && sameCompany(resource.data.companyId);";
  const safe=name==="revenueGoals"?
   "      allow read: if resource.data.companyId != null\n"+
   "        && sameCompany(resource.data.companyId)\n"+
   "        && !activeSecondaryPartnerForHub(resource.data.companyId)\n"+
   "        && (":
   "      allow read: if resource.data.companyId != null\n"+
   "        && sameCompany(resource.data.companyId)\n"+
   "        && !activeSecondaryPartnerForHub(resource.data.companyId);";
  const patched=replaceOnce(current,old,safe,name);
  candidate=candidate.slice(0,pos)+patched+candidate.slice(next);
 }
 if(candidate===source)throw Error("FINANCE_READ_FENCE_UNCHANGED");
 for(const k of ["allow create:","allow update:","allow delete:"])
  if(source.split(k).length!==candidate.split(k).length)
   throw Error("FINANCE_READ_FENCE_WRITES_CHANGED");
 return candidate;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=="--check")
  throw Error("FINANCE_READ_FENCE_NO_DEPLOY");
 const candidate=proposeSecondaryFinanceFence();
 console.log("SECONDARY_FINANCE_DEMO_RULES_SHA256="+createHash("sha256").update(candidate).digest("hex"));
 console.log("PRODUCTION_RULES_WRITES=0");
}
