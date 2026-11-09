#!/usr/bin/env node
/**
 * READ-ONLY: inspect only Firestore users with active===false and their
 * authoritative company/member/Auth status. No UID/email/name/IDs/timestamps
 * printed. Never signs in or changes an account.
 */
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
const STOP=k=>{throw Error("STOP_DISABLED_LOGIN_AUDIT_"+k)};
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const validId=v=>typeof v==="string"&&ID.test(v);
const data=s=>s?.exists===true?s.data()||{}:{};
const add=(s,k)=>{s[k]=(s[k]||0)+1};
export function classifyDisabledAccount({
 uid,user,auth,companyExists,company,memberExists,member
}={}){
 if(!validId(uid)||user?.uid!==uid||user.active!==false)
  return "NOT_PROVEN_DISABLED_PROFILE";
 if(!auth)return "AUTH_RECORD_MISSING";
 if(auth.uid!==uid||auth.disabled===true)return "FIREBASE_AUTH_DISABLED_OR_MISMATCHED";
 if(auth.emailVerified!==true)return "FIREBASE_EMAIL_NOT_VERIFIED";
 if(!validId(user.companyId))return "DISABLED_NO_VALID_COMPANY_REFERENCE";
 if(!companyExists)return "DISABLED_COMPANY_NOT_FOUND";
 if(company?.active!==true)return "DISABLED_COMPANY_NOT_ACTIVE";
 const partner=user.accessKind==="partner"||
  ["partner","cooperator"].includes(user.memberType);
 if(partner){
  if(user.accessKind==="partner"&&user.memberType==="cooperator"&&
   user.canViewRevenue===false&&user.canViewUnitPrice===false)
   return "DISABLED_PARTNER_COUNT_ONLY_PROFILE";
  return "DISABLED_PARTNER_FLAG_CONFLICT";
 }
 if(!memberExists)return "DISABLED_INTERNAL_MEMBER_MISSING";
 if(member?.uid!==uid||
    (member.companyId!=null&&member.companyId!==user.companyId))
  return "DISABLED_INTERNAL_MEMBER_ID_MISMATCH";
 if(member.active===false)return "DISABLED_USER_AND_MEMBER_BOTH_INACTIVE";
 if(member.active===true)return "DISABLED_USER_WITH_ACTIVE_MEMBER";
 return "DISABLED_INTERNAL_MEMBER_STATE_UNSPECIFIED";
}
export async function auditDisabledLoginStatus({db,auth}={}){
 if(typeof db?.collection!=="function"||typeof auth?.getUser!=="function")
  STOP("DEPENDENCIES");
 const rows=await db.collection("users").where("active","==",false).limit(11).get();
 if(!Array.isArray(rows?.docs)||rows.docs.length>10)
  STOP("SCOPE_EXCEEDED");
 const groups={},scope={users:rows.docs.length,companyReads:0,
  memberReads:0,authReads:0};
 for(const snap of rows.docs){
  const uid=snap.id,u=data(snap);
  if(!validId(uid)||snap.exists!==true){
   add(groups,"NOT_PROVEN_DISABLED_PROFILE");continue;
  }
  let authUser;
  try{authUser=await auth.getUser(uid)}
  catch(err){
   if(err?.code==="auth/user-not-found")authUser=null;
   else STOP("AUTH_METADATA_UNAVAILABLE");
  }
  scope.authReads++;
  let cs=null,ms=null;
  if(validId(u.companyId)){
   cs=await db.collection("companies").doc(u.companyId).get();
   scope.companyReads++;
   const partner=u.accessKind==="partner"||
    ["partner","cooperator"].includes(u.memberType);
   if(!partner){
    ms=await db.collection("companies").doc(u.companyId)
     .collection("members").doc(uid).get();
    scope.memberReads++;
   }
  }
  add(groups,classifyDisabledAccount({
   uid,user:u,auth:authUser,companyExists:cs?.exists===true,
   company:data(cs),memberExists:ms?.exists===true,member:data(ms)
  }));
 }
 return Object.freeze({
  audit:"DISABLED_LOGIN_ROOT_CAUSE_METADATA_GET_ONLY",
  disabledProfilesFound:rows.docs.length,
  categoryCounts:groups,readCounts:scope,
  verifiedActualPasswordLogin:false,
  intentionalDisablementReasonKnown:false,
  uidOrEmailLogged:false,
  recordsOrFinancialOriginalsRead:false,
  newUserOrRoleGranted:false,
  accountsReactivated:0,firestoreWrites:0,
  authChanges:0,functionsDeployed:0,rulesChanged:0
 });
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--read-only"||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!=="sales-management-cc116"||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("MAIN_CONTEXT_NOT_AUTHORIZED");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getAuth}=require("firebase-admin/auth");
 const {getFirestore}=require("firebase-admin/firestore");
 const app=initializeApp({credential:applicationDefault(),projectId:"sales-management-cc116"});
 const result=await auditDisabledLoginStatus({db:getFirestore(app),auth:getAuth(app)});
 console.log("DISABLED_LOGIN_LIVE_READONLY "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_DISABLED_LOGIN_AUDIT_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_DISABLED_LOGIN_AUDIT_UNKNOWN");
  process.exitCode=1;
 });
