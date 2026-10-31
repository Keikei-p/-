#!/usr/bin/env node
/**
 * Read-only production count/rules audit. Never signs into user accounts,
 * creates reports, changes prices, deletes data, or deploys Firestore Rules.
 * Output is aggregate numbers only: no names, IDs, tokens, prices or PII.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const PROJECT="sales-management-cc116";
export const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const SECRET_KEYS=/^(?:totalRevenue|revenue|revenuePerUnit|unitPrice|pricingOptions|targetRevenue|sellingPrice|salesAmount|pricePerUnit|price|profit)$/i;
const sha=text=>createHash("sha256").update(text.replace(/\r\n/g,"\n").trim()).digest("hex");
const abort=code=>{throw Error("READ_ONLY_AUDIT_STOP_"+code);};
export function validCountRow(data){
 if(!data||typeof data!=="object"||Array.isArray(data)||
    !data.counts||typeof data.counts!=="object"||Array.isArray(data.counts)||
    Object.keys(data.counts).sort().join("|")!==[...KEYS].sort().join("|"))abort("BAD_CATEGORY_SCHEMA");
 for(const key of Object.keys(data))if(SECRET_KEYS.test(key))abort("MONEY_IN_COUNT_REPORT");
 let total=0;
 for(const key of KEYS){
  const n=data.counts[key];
  if(!Number.isSafeInteger(n)||n<0||n>9999)abort("BAD_COUNT");
  total+=n;
 }
 if(!Number.isSafeInteger(data.totalCount)||data.totalCount!==total)abort("COUNT_TOTAL_MISMATCH");
 return total;
}
export function compareStaffRollup({summary,entries,date,partnerCompanyId,hubCompanyId}){
 validCountRow(summary);
 if(summary.source!=="staff-entries-v1"||
    summary.date!==date||summary.partnerCompanyId!==partnerCompanyId||
    summary.hubCompanyId!==hubCompanyId)abort("FOREIGN_STAFF_SUMMARY");
 if(!Array.isArray(entries)||entries.length>200)abort("ENTRY_LIMIT");
 const seen=new Set(),sum=Object.fromEntries(KEYS.map(k=>[k,0]));
 for(const entry of entries){
  validCountRow(entry);
  if(entry.date!==date||entry.companyId!==partnerCompanyId||
     entry.hubCompanyId!==hubCompanyId||
     typeof entry.staffId!=="string"||!entry.staffId||
     seen.has(entry.staffId))abort("BAD_STAFF_OR_DUPLICATE");
  seen.add(entry.staffId);
  for(const key of KEYS)sum[key]+=entry.counts[key];
 }
 for(const key of KEYS)if(sum[key]!==summary.counts[key])abort("ROLLUP_DIFFERS_FROM_STAFF");
 return {entries:entries.length,total:summary.totalCount};
}
export function financeLockedIdentity(company,users,member){
 if(company?.companyKind!=="partner")abort("NOT_PARTNER");
 for(const identity of [...users,member]){
  if(identity?.accessKind!=="partner"||identity?.memberType!=="cooperator"||
     identity?.canViewRevenue!==false||identity?.canViewUnitPrice!==false)
   abort("PARTNER_IDENTITY_FINANCE_FLAGS");
 }
}
// Match the positive internal classification allowlist in firestore.rules.
// Reject unknown markers even when accessKind != "partner".
const INTERNAL_ACCESS=new Set([undefined,"internal"]);
const INTERNAL_TYPES=new Set([undefined,"internal","direct","member","managed"]);
export function isInternalIdentitySafe(company,member,user=member){
 if(!company||!member||!user)return false;
 return INTERNAL_ACCESS.has(company.companyKind)&&
  INTERNAL_ACCESS.has(member.accessKind)&&INTERNAL_ACCESS.has(user.accessKind)&&
  INTERNAL_TYPES.has(member.memberType)&&INTERNAL_TYPES.has(user.memberType);
}
async function retrieveRules(credential,request=fetch){
 const token=(await credential.getAccessToken()).access_token;
 if(!token||typeof token!=="string")abort("CREDENTIAL");
 const root="https://firebaserules.googleapis.com/v1/projects/"+PROJECT;
 const secureGet=async url=>{
  if(!url.startsWith(root+"/"))abort("UNTRUSTED_RULES_URL");
  const resp=await request(url,{headers:{Authorization:"Bearer "+token},redirect:"error"});
  if(!resp.ok)abort("RULES_API_HTTP_"+resp.status);
  return resp.json();
 };
 const rel=await secureGet(root+"/releases/cloud.firestore");
 if(typeof rel.rulesetName!=="string"||
    !/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/.test(rel.rulesetName))
  abort("RULES_RELEASE_MISSING");
 const rules=await secureGet("https://firebaserules.googleapis.com/v1/"+rel.rulesetName);
 const files=rules?.source?.files;
 if(!Array.isArray(files)||files.length!==1||typeof files[0].content!=="string")
  abort("UNEXPECTED_RULES_SOURCE");
 const expected=readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8");
 return {deployedRulesMatchReviewedRepo:sha(files[0].content)===sha(expected)};
}
const dateJst=(time=Date.now())=>{
 const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"})
  .formatToParts(new Date(time));
 const fields=Object.fromEntries(p.map(x=>[x.type,x.value]));
 return fields.year+"-"+fields.month+"-"+fields.day;
};
export async function inspectLive({db,credential,clock=Date.now,request=fetch}){
 if(!db||typeof db.collection!=="function"||!credential)abort("MISSING_DEPENDENCY");
 const security=await retrieveRules(credential,request);
 const snap=await db.collection("companies").select("companyKind","ownerUid","hubCompanyId","active").limit(201).get();
 if(snap.size>200)abort("COMPANY_SCAN_INCOMPLETE");
 let internal=0,partners=0,accounts=0,staffReports=0,quickReports=0,staffEntries=0,verifiedCounts=0,unmatchedFlags=0;
 let activeInternalAccountsChecked=0,nonLoginManagedStaff=0,internalOwnersVerified=0;
 let legacyMembersWithoutUid=0,legacyMembersWithoutCompanyId=0;
 const hubs=new Map();
 for(const companyDoc of snap.docs){
  const company=companyDoc.data();
  if(company.active===false)continue;
  if(company.companyKind==="partner"){
   partners++;
   const ownerUid=company.ownerUid;
   if(typeof ownerUid!=="string"||!ownerUid||typeof company.hubCompanyId!=="string"||!company.hubCompanyId)
     abort("PARTNER_COMPANY_MARKERS");
   const [userDoc,memberDoc]=await Promise.all([
    db.collection("users").doc(ownerUid).get(),
    db.collection("companies").doc(companyDoc.id).collection("members").doc(ownerUid).get()
   ]);
   if(!userDoc.exists||!memberDoc.exists)abort("PARTNER_OWNER_PROFILE_MISSING");
   financeLockedIdentity(company,[userDoc.data()],memberDoc.data());
   const memberSnapshot=await db.collection("companies").doc(companyDoc.id)
    .collection("members").select("accessKind","memberType","canViewRevenue","canViewUnitPrice","active").limit(201).get();
   if(memberSnapshot.size>200)abort("PARTNER_MEMBERS_INCOMPLETE");
   for(const doc of memberSnapshot.docs){
    const m=doc.data();
    if(m.active===false)continue;
    accounts++;
    financeLockedIdentity(company,[m],m);
   }
   if(!hubs.has(company.hubCompanyId))hubs.set(company.hubCompanyId,[]);
   hubs.get(company.hubCompanyId).push(companyDoc.id);
  }else{
   internal++;
   const members=await db.collection("companies").doc(companyDoc.id)
    .collection("members").select("uid","companyId","accessKind","memberType",
     "companyRole","hasAccount","active").limit(201).get();
   if(members.size>200)abort("INTERNAL_MEMBERS_INCOMPLETE");
   if(!isInternalIdentitySafe(company,{},{}))abort("INTERNAL_COMPANY_KIND_UNSUPPORTED");
   let foundOwner=false;
   for(const doc of members.docs){
    const m=doc.data();
    if(m.active===false)continue;
    // Managed staff with no account cannot authenticate as this document.
    if(m.hasAccount===false&&m.memberType==="managed"){
     nonLoginManagedStaff++;
     if(!isInternalIdentitySafe(company,m,m))unmatchedFlags++;
     continue;
    }
    // Legacy membership documents can omit uid/companyId entirely. Existing
    // isCompanyMember() checks the PATH and users.companyId, not these fields.
    // A conflicting *present* marker is still a hard stop: never repair it.
    if(m.uid==null)legacyMembersWithoutUid++;
    else if(m.uid!==doc.id)abort("INTERNAL_MEMBER_IDENTITY_INCONSISTENT");
    if(m.companyId==null)legacyMembersWithoutCompanyId++;
    else if(m.companyId!==companyDoc.id)abort("INTERNAL_MEMBER_COMPANY_CONFLICT");
    // firebase-admin DocumentReference does not have .select(). Only
    // collection queries do. The verified profile is read without logging.
    const userSnap=await db.collection("users").doc(doc.id).get();
    if(!userSnap.exists)abort("INTERNAL_AUTH_PROFILE_MISSING");
    const u=userSnap.data();
    if(u.uid!==doc.id||u.companyId!==companyDoc.id||u.active===false)
     abort("INTERNAL_AUTH_PROFILE_MISMATCH");
    activeInternalAccountsChecked++;
    if(!isInternalIdentitySafe(company,m,u))unmatchedFlags++;
    if(doc.id===company.ownerUid){
     foundOwner=true;
     if(u.companyRole!=="owner"||m.companyRole!=="owner")
      abort("INTERNAL_OWNER_ROLE_MISMATCH");
     internalOwnersVerified++;
    }
   }
   if(!foundOwner)abort("INTERNAL_OWNER_NOT_VERIFIED");
  }
 }
 if(unmatchedFlags>0)abort("EXISTING_INTERNAL_MEMBER_WOULD_BE_DENIED");
 const now=Date.parse(dateJst(clock())+"T00:00:00Z");
 for(const [hubId,partnerIds] of hubs){
  for(let daysAgo=0;daysAgo<3;daysAgo++){
   const day=new Date(now-daysAgo*86400000).toISOString().slice(0,10);
   const hub=db.collection("companies").doc(hubId);
   const [staff,quick]=await Promise.all([
    hub.collection("partnerWorkCountDays").doc(day).collection("reports").limit(201).get(),
    hub.collection("partnerQuickCountDays").doc(day).collection("reports").limit(201).get()
   ]);
   if(staff.size>200||quick.size>200)abort("DAILY_REPORTS_INCOMPLETE");
   const allowed=new Set(partnerIds),staffPartnerIds=new Set();
   for(const doc of staff.docs){
    if(!allowed.has(doc.id))abort("UNRECOGNIZED_STAFF_PARTNER");
    staffPartnerIds.add(doc.id);
    const data=doc.data(),entries=await db.collection("companies").doc(doc.id)
     .collection("partnerWorkEntries").where("date","==",day).limit(201).get();
    if(entries.size>200)abort("STAFF_ENTRIES_INCOMPLETE");
    const result=compareStaffRollup({summary:data,entries:entries.docs.map(x=>x.data()),date:day,
      partnerCompanyId:doc.id,hubCompanyId:hubId});
    staffReports++;staffEntries+=result.entries;verifiedCounts+=result.total;
   }
   for(const doc of quick.docs){
    if(!allowed.has(doc.id))abort("UNRECOGNIZED_QUICK_PARTNER");
    const data=doc.data();
    validCountRow(data);
    if(data.date!==day||data.hubCompanyId!==hubId||data.partnerCompanyId!==doc.id)
      abort("QUICK_SUMMARY_IDENTITY");
    quickReports++;
    // The staff ledger replaces the quick one for the same company/day.
    if(!staffPartnerIds.has(doc.id))verifiedCounts+=data.totalCount;
   }
  }
 }
 return {project:PROJECT,mode:"READ_ONLY",dataWrites:0,authSignIns:0,
  companyCount:internal,partnerCompanyCount:partners,partnerActiveMemberCount:accounts,
  activeInternalAccountsChecked,nonLoginManagedStaff,internalOwnersVerified,
  legacyMembersWithoutUid,legacyMembersWithoutCompanyId,
  staffReportCount:staffReports,quickReportCount:quickReports,verifiedStaffEntryCount:staffEntries,
  effectiveThreeDayPartnerCount:verifiedCounts,...security,
  signedInPartnerE2EVerified:false,
  countAggregationVerified:staffReports+quickReports>0,
  internalOwnerAndStaffCompatibilityVerified:unmatchedFlags===0,
  // Role-marker validation alone cannot authorize a finance cutover while
  // the live browser still reads/writes money-bearing Firestore collections.
  safeToDeployExistingRules:false};
}
async function main(){
 if(process.env.NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||!process.env.GOOGLE_APPLICATION_CREDENTIALS)
  abort("READ_ONLY_ENV_NOT_APPROVED");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault,initializeApp}=require("firebase-admin/app");
 const {getFirestore}=require("firebase-admin/firestore");
 const credential=applicationDefault();
 initializeApp({credential,projectId:PROJECT});
 const result=await inspectLive({db:getFirestore(),credential});
 console.log("NICO_PARTNER_PRODUCTION_AUDIT "+JSON.stringify(result));
 if(!result.deployedRulesMatchReviewedRepo)console.log("BLOCK_FIRESTORE_RULES_NOT_DEPLOYED: no auto release");
 if(!result.countAggregationVerified)console.log("NOT_YET_VERIFIED_REAL_PARTNER_COUNTS: no partner reports found in last 3 days");
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(e=>{console.error(e.message?.startsWith("READ_ONLY_AUDIT_STOP_")?e.message:"READ_ONLY_AUDIT_STOP_UNEXPECTED");process.exitCode=1});
}
