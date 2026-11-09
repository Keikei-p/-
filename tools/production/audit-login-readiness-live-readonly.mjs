#!/usr/bin/env node
/**
 * GET-ONLY production login metadata audit. Never logs raw UID, email,
 * company ID, company names, access tokens, counts, prices or finance.
 * It does not authenticate as users, grant roles or modify any account.
 */
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {classifyLegacySalesEntrypoint} from "../../legacy-finance-entry-guard.mjs";
const STOP=code=>{throw Error("STOP_LOGIN_READINESS_READONLY_"+code)};
const MAX=200;
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const validId=v=>typeof v==="string"&&ID.test(v);
const raw=s=>s?.exists===true?s.data()||{}:{};
const increment=(counts,key)=>{counts[key]=(counts[key]||0)+1};
export function classifyLoginReadiness({uid,user,company,member,auth,companyExists,memberExists}={}){
 if(!validId(uid)||!user||typeof user!=="object"||user.uid!==uid)
  return "USER_UID_MISMATCH";
 if(!auth)return "AUTH_USER_NOT_FOUND";
 if(auth.uid!==uid)return "AUTH_UID_MISMATCH";
 if(auth.disabled===true)return "AUTH_DISABLED";
 if(auth.emailVerified!==true)return "AUTH_EMAIL_UNVERIFIED";
 if(user.active===false)return "USER_DISABLED";
 if(!validId(user.companyId))return "COMPANY_SETUP_OR_INVITE_REQUIRED";
 if(!companyExists)return "COMPANY_DOCUMENT_MISSING";
 if(company?.active===false)return "COMPANY_DISABLED";
 if(user.authKind==="partner_code_shared")
  return "SHARED_CODE_NOT_FIREBASE_EMAIL_ACCOUNT";
 const routeIsPartner=user.accessKind==="partner"||
  ["partner","cooperator"].includes(user.memberType);
 if(routeIsPartner){
  // Mirrors index.html: mixed/partial partner flags fail closed.
  if(user.accessKind!=="partner"||user.memberType!=="cooperator"||
   user.canViewRevenue!==false||user.canViewUnitPrice!==false)
   return "PARTNER_PROFILE_FLAGS_INCONSISTENT";
  // Partner login uses count-only callable; Firestore membership reads are
  // intentionally forbidden by Rules and NOT evidence of failed login.
  return "PARTNER_EMAIL_COUNT_ONLY_ROUTE_CANDIDATE";
 }
 if(!memberExists)return "INTERNAL_MEMBER_DOCUMENT_MISSING";
 const safeMember=member?.companyId==null?
  {...member,companyId:user.companyId}:member;
 const decision=classifyLegacySalesEntrypoint({
  uid,user,company,member:safeMember,authEmailVerified:auth.emailVerified
 });
 if(decision.mode==="internal")return "INTERNAL_ROUTE_METADATA_READY";
 if(decision.mode==="partner")return "INTERNAL_DOCUMENT_MARKED_PARTNER";
 const allowed=new Set([
  "unverified","membership_mismatch","unknown_role","team_mismatch",
  "role_mismatch","not_internal","count_only_required"
 ]);
 return "INTERNAL_ROUTE_BLOCKED_"+(allowed.has(decision.reason)?
  decision.reason.toUpperCase():"OTHER");
}
export async function auditLoginReadiness({db,auth}={}){
 if(typeof db?.collection!=="function"||typeof auth?.getUser!=="function")
  STOP("INVALID_DEPENDENCIES");
 const query=await db.collection("users").limit(MAX+1).get();
 if(!Array.isArray(query?.docs)||query.docs.length>MAX)
  STOP("USER_POPULATION_OVER_LIMIT");
 const stats={},scope={firebaseAccountsLookedUp:0,companyRead:0,memberRead:0};
 for(const snap of query.docs){
  const uid=snap.id;
  if(!validId(uid)){increment(stats,"USER_UID_MISMATCH");continue;}
  const user=raw(snap);
  if(!snap.exists||user.uid!==uid){
   increment(stats,"USER_UID_MISMATCH");continue;
  }
  let record;
  try{record=await auth.getUser(uid);scope.firebaseAccountsLookedUp++}
  catch(err){
   if(err?.code!=="auth/user-not-found")STOP("FIREBASE_AUTH_METADATA_UNAVAILABLE");
   record=null;scope.firebaseAccountsLookedUp++;
  }
  let cs=null,ms=null;
  if(validId(user.companyId)&&user.authKind!=="partner_code_shared"){
   cs=await db.collection("companies").doc(user.companyId).get();
   scope.companyRead++;
   // Avoid reading partner members: some are only secondary membership
   // records, whose canonical identity remains in the user profile.
   const partner=user.accessKind==="partner"||
    ["partner","cooperator"].includes(user.memberType);
   if(!partner){
    ms=await db.collection("companies").doc(user.companyId)
     .collection("members").doc(uid).get();
    scope.memberRead++;
   }
  }
  increment(stats,classifyLoginReadiness({
   uid,user,auth:record,company:raw(cs),member:raw(ms),
   companyExists:cs?.exists===true,memberExists:ms?.exists===true
  }));
 }
 return Object.freeze({
  audit:"LOGIN_METADATA_READINESS_NO_USER_IDENTIFIERS",
  userDocumentsScanned:query.docs.length,
  boundedScanComplete:true,
  categoryCounts:stats,
  metadataReads:scope,
  missingFirestoreUserProfilesNotCovered:true,
  actualPasswordSignInNotTested:true,
  clientRuntimeAndNetworkNotTested:true,
  codeBasedSharedSessionsNotTested:true,
  financialOriginalsRead:false,productionWrites:0,authChanges:0,
  roleChanges:0,loginSessionsCreated:0,containsUserIdentifiers:false
 });
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--read-only"||
  process.env.GITHUB_ACTIONS!=="true"||
  process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
  process.env.GITHUB_REF!=="refs/heads/main"||
  process.env.FIREBASE_PROJECT_ID!=="sales-management-cc116"||
  !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("APPROVED_MAIN_ONLY");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getAuth}=require("firebase-admin/auth");
 const {getFirestore}=require("firebase-admin/firestore");
 const app=initializeApp({credential:applicationDefault(),projectId:"sales-management-cc116"});
 const report=await auditLoginReadiness({db:getFirestore(app),auth:getAuth(app)});
 console.log("LOGIN_READINESS_LIVE_READONLY "+JSON.stringify(report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(err=>{
  console.error(/^STOP_LOGIN_READINESS_READONLY_[A-Z0-9_]+$/.test(err?.message||"")?
   err.message:"STOP_LOGIN_READINESS_READONLY_UNKNOWN");
  process.exitCode=1;
 });
