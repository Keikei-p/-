#!/usr/bin/env node
/**
 * NICO FACTORY Owner topology audit — PRODUCTION GET ONLY.
 * Explains why users with companyRole=owner differ from companies.ownerUid.
 * No UID, email, company name, raw document, count or financial values appear
 * in the report. No role fix or access expansion is performed.
 */
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {classifyOwnerRoot} from "./audit-owner-workspace-live-readonly.mjs";
const STOP=x=>{throw Error("STOP_OWNER_TOPOLOGY_READONLY_"+x)};
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const validId=x=>typeof x==="string"&&ID.test(x);
const data=x=>x?.exists===true?x.data()||{}:{};
const counter=(out,key)=>{out[key]=(out[key]||0)+1};
const validCandidate=(x,uid,hub)=>{
 const c=x||{};
 return c.uid===uid&&c.companyId===hub&&c.companyRole==="owner"&&
  c.active===true&&c.authKind!=="partner_code_shared"&&
  (c.accessKind==null||c.accessKind==="internal")&&
  (c.memberType==null||["internal","direct","member","managed"].includes(c.memberType));
};
const verifiedAuth=(a,uid)=>a?.uid===uid&&a.disabled!==true&&a.emailVerified===true&&
 typeof a.email==="string"&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email);
const checkMember=(m,uid,hub)=>m?.uid===uid&&m.active===true&&
 (m.companyId==null||m.companyId===hub)&&m.companyRole==="owner"&&
 (m.accessKind==null||m.accessKind==="internal")&&
 (m.memberType==null||["internal","direct","member","managed"].includes(m.memberType));
export async function auditOwnerTopology({db,auth}={}){
 if(!db?.collection||typeof auth?.getUser!=="function")STOP("DEPENDENCIES");
 const owners=await db.collection("users").where("companyRole","==","owner").limit(21).get();
 if(!Array.isArray(owners?.docs)||owners.docs.length>20)STOP("OWNER_LIMIT_EXCEEDED");
 const totals={},groups=new Map(),cache=new Map();
 const read=ref=>ref.get();
 async function authUser(uid){
  try{return await auth.getUser(uid)}catch{return null}
 }
 for(const snap of owners.docs){
  const uid=snap.id,user=data(snap),hub=user.companyId;
  if(!validId(uid)||!validId(hub)){
   counter(totals,"OWNER_INVALID_PROFILE");continue;
  }
  const companySnap=await read(db.collection("companies").doc(hub));
  const company=data(companySnap);
  if(company.companyKind==="partner"||user.authKind==="partner_code_shared"){
   counter(totals,"PARTNER_OWNER_EXCLUDED");continue;
  }
  const memberSnap=await read(db.collection("companies").doc(hub).collection("members").doc(uid));
  const member=data(memberSnap),authRecord=await authUser(uid);
  const code=classifyOwnerRoot({
   uid,user,company,member,authUser:authRecord,
   hasCompany:companySnap.exists===true,
   hasMember:memberSnap.exists===true
  });
  counter(totals,code);
  const group=groups.get(hub)||{ownerCandidates:0,rootReady:0,mismatches:0};
  group.ownerCandidates++;
  if(code==="ROOT_READY_METADATA_ONLY")group.rootReady++;
  if(code==="COMPANY_OWNER_UID_DIFFERENT")group.mismatches++;
  groups.set(hub,group);
  if(code!=="COMPANY_OWNER_UID_DIFFERENT")continue;
  const secondaryReady=validCandidate(user,uid,hub)&&checkMember(member,uid,hub)&&
   verifiedAuth(authRecord,uid);
  counter(totals,secondaryReady?"DIFFERENT_UID_SECONDARY_FULLY_VALID":
   "DIFFERENT_UID_SECONDARY_NOT_VERIFIED");
  const primaryId=company.ownerUid;
  if(!validId(primaryId)){
   counter(totals,"PRIMARY_ID_INVALID");continue;
  }
  const key=hub+"|"+primaryId;
  let primary=cache.get(key);
  if(!primary){
   const [primaryUser,primaryMember,primaryAuth]=await Promise.all([
    read(db.collection("users").doc(primaryId)),
    read(db.collection("companies").doc(hub).collection("members").doc(primaryId)),
    authUser(primaryId)
   ]);
   primary={uid:primaryId,user:data(primaryUser),member:data(primaryMember),
    authRecord:primaryAuth,hasUser:primaryUser.exists===true,
    hasMember:primaryMember.exists===true};
   cache.set(key,primary);
  }
  const primaryValid=primary.hasUser&&primary.hasMember&&
   validCandidate(primary.user,primaryId,hub)&&
   checkMember(primary.member,primaryId,hub)&&
   verifiedAuth(primary.authRecord,primaryId);
  counter(totals,primaryValid?"DIFFERENT_UID_POINTS_TO_VALID_PRIMARY":
   "DIFFERENT_UID_PRIMARY_NOT_VERIFIED");
 }
 const topology={};
 for(const group of groups.values()){
  if(group.mismatches===0)continue;
  if(group.rootReady>0)counter(topology,"SAME_COMPANY_HAS_VERIFIED_OWNER");
  else counter(topology,"NO_VERIFIED_OWNER_IN_SAMPLED_OWNERS");
  if(group.mismatches>1)counter(topology,"MULTIPLE_MISMATCHES_SAME_COMPANY");
  if(group.ownerCandidates>1)counter(topology,"MULTIPLE_OWNER_ROLE_USERS_SAME_COMPANY");
 }
 return Object.freeze({
  audit:"OWNER_TOPOLOGY_METADATA_ONLY",
  ownersScanned:owners.docs.length,
  ownerStatusCounts:totals,
  mismatchCompanyGroupCounts:topology,
  groupedCompanyCount:groups.size,
  authImpersonation:false,
  realUserBrowserLoginTested:false,
  suggestedAutomaticRoleChange:false,
  roleUpdates:0,firestoreWrites:0,functionsDeployed:0,
  financeOriginalsRead:false,countsRead:false,identitiesLogged:false
 });
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--read-only"||
  process.env.GITHUB_ACTIONS!=="true"||
  process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
  process.env.GITHUB_REF!=="refs/heads/main"||
  process.env.FIREBASE_PROJECT_ID!=="sales-management-cc116"||
  !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("MAIN_CONTEXT_UNVERIFIED");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getAuth}=require("firebase-admin/auth");
 const {getFirestore}=require("firebase-admin/firestore");
 const app=initializeApp({credential:applicationDefault(),projectId:"sales-management-cc116"});
 const result=await auditOwnerTopology({db:getFirestore(app),auth:getAuth(app)});
 console.log("OWNER_TOPOLOGY_LIVE_READONLY "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_TOPOLOGY_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_TOPOLOGY_READONLY_UNKNOWN");
  process.exitCode=1;
 });
