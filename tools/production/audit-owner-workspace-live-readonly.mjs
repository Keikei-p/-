#!/usr/bin/env node
/**
 * Privacy-preserving LIVE schema preflight of the already deployed
 * getPartnerWorkspace Owner path. Reads only bounded users, companies,
 * members, partnerRelations, partnerWorkTeams and Firebase Auth metadata.
 * Does not sign in, impersonate, read money/count records, or write data.
 */
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
const STOP=code=>{throw Error("STOP_OWNER_WORKSPACE_LIVE_READONLY_"+code)};
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const NAME=/^[\p{L}\p{N} 　・ー（）()_.-]{1,60}$/u;
const MONEY=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const ALLOWED_MEMBER_TYPES=["internal","direct","member","managed"];
const validCompanyName=x=>typeof x==="string"&&x.trim().length>0&&x.trim().length<=80&&!MONEY.test(x);
const validTeamName=x=>typeof x==="string"&&NAME.test(x)&&!MONEY.test(x);
const present=s=>s&&s.exists===true;
const data=s=>s?.data?.()||{};
export function classifyOwnerRoot({uid,user,company,member,authUser,hasCompany,hasMember}){
 const u=user||{},c=company||{},m=member||{};
 if(u.authKind==="partner_code_shared"||c.companyKind==="partner")return "SKIP_PARTNER_OWNER";
 if(!ID.test(uid||"")||u.uid!==uid||u.active!==true||!ID.test(u.companyId||""))
  return "USER_MISMATCH_OR_INACTIVE";
 if(!hasCompany||c.active!==true)return "COMPANY_MISSING_OR_INACTIVE";
 if(!hasMember||m.uid!==uid||m.active!==true||
    (m.companyId!=null&&m.companyId!==u.companyId))
  return "MEMBER_MISSING_OR_INACTIVE";
 if(c.companyKind!=null&&!["internal","direct"].includes(c.companyKind))
  return "COMPANY_KIND_MISMATCH";
 if(c.ownerUid==null||c.ownerUid==="")return "COMPANY_OWNER_UID_MISSING";
 if(c.ownerUid!==uid)return "COMPANY_OWNER_UID_DIFFERENT";
 if(u.companyRole!=="owner"||m.companyRole!=="owner"||
    m.companyRole!==u.companyRole||
    (u.accessKind!=null&&u.accessKind!=="internal")||
    (m.accessKind!=null&&m.accessKind!=="internal")||
    (u.memberType!=null&&!ALLOWED_MEMBER_TYPES.includes(u.memberType))||
    (m.memberType!=null&&!ALLOWED_MEMBER_TYPES.includes(m.memberType)))
  return "MEMBER_OWNER_ROLE_MISMATCH";
 if(!authUser||authUser.uid!==uid||authUser.disabled===true||
    authUser.emailVerified!==true||typeof authUser.email!=="string"||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authUser.email))
  return "AUTH_METADATA_UNVERIFIED";
 return "ROOT_READY_METADATA_ONLY";
}
export function classifyPartnerRelation({hubId,id,relation,company,companyExists,teams}={}){
 const r=relation||{},c=company||{};
 if(!ID.test(hubId||"")||!ID.test(id||"")||
    r.partnerCompanyId!==id||r.hubCompanyId!==hubId)
  return "RELATION_KEY_MISMATCH";
 if(!companyExists||c.hubCompanyId!==hubId||c.companyKind!=="partner"||
    !validCompanyName(c.name))
  return "PARTNER_COMPANY_MALFORMED";
 const active=r.active===true&&r.countSharingApproved===true&&c.active===true;
 if(!active)return "INACTIVE_PARTNER";
 if(!Array.isArray(teams)||teams.length>150||
    teams.some(t=>!ID.test(t.id||"")||t.companyId!==id||
      !validTeamName(t.name)||typeof t.active!=="boolean"))
  return "ACTIVE_TEAM_SCHEMA_MALFORMED";
 return "PARTNER_READY_METADATA_ONLY";
}
function countBy(items){
 const out={};
 for(const key of items)out[key]=(out[key]||0)+1;
 return out;
}
export async function auditOwnerWorkspaceReadiness({db,auth,maxOwners=20,maxRelations=60}={}){
 if(!db||!auth||typeof auth.getUser!=="function"||
    maxOwners!==20||maxRelations!==60)STOP("DEPENDENCIES");
 const query=await db.collection("users").where("companyRole","==","owner").limit(maxOwners+1).get();
 if(!Array.isArray(query?.docs)||query.docs.length>maxOwners)
  STOP("OWNER_SCOPE_EXCEEDED");
 let relationBudget=maxRelations,teamBudget=100;
 const verdicts=[],relations=[];
 for(const userSnap of query.docs){
  const uid=userSnap.id,u=data(userSnap);
  if(!ID.test(uid||"")){verdicts.push("USER_MISMATCH_OR_INACTIVE");continue;}
  if(u.authKind==="partner_code_shared"||
     !ID.test(u.companyId||"")){verdicts.push(u.authKind==="partner_code_shared"?
     "SKIP_PARTNER_OWNER":"USER_MISMATCH_OR_INACTIVE");continue;}
  const [cs,ms]=await Promise.all([
   db.collection("companies").doc(u.companyId).get(),
   db.collection("companies").doc(u.companyId).collection("members").doc(uid).get()
  ]);
  const c=data(cs),m=data(ms);
  if(c.companyKind==="partner"){verdicts.push("SKIP_PARTNER_OWNER");continue;}
  let authUser=null;
  try{authUser=await auth.getUser(uid)}catch{ /* never echo raw provider error */ }
  const status=classifyOwnerRoot({
   uid,user:u,company:c,member:m,authUser,
   hasCompany:present(cs),hasMember:present(ms)
  });
  verdicts.push(status);
  if(status!=="ROOT_READY_METADATA_ONLY")continue;
  const snap=await db.collection("partnerRelations").where("hubCompanyId","==",u.companyId)
   .limit(101).get();
  if(!Array.isArray(snap?.docs)||snap.docs.length>100||
     snap.docs.length>relationBudget)STOP("RELATIONS_SCOPE_EXCEEDED");
  relationBudget-=snap.docs.length;
  if(!snap.docs.length){relations.push("NO_PARTNER_RELATIONS");continue;}
  for(const rel of snap.docs){
   const raw=data(rel);
   const partner=await db.collection("companies").doc(rel.id).get();
   const pc=data(partner);
   const active=raw.active===true&&raw.countSharingApproved===true&&pc.active===true;
   let teams=null;
   if(active&&pc.companyKind==="partner"&&pc.hubCompanyId===u.companyId){
    const teamQuery=await db.collection("companies").doc(rel.id)
     .collection("partnerWorkTeams").limit(101).get();
    if(!Array.isArray(teamQuery?.docs)||teamQuery.docs.length>teamBudget)
     STOP("TEAM_SCOPE_EXCEEDED");
    teamBudget-=teamQuery.docs.length;
    teams=teamQuery.docs.map(x=>({id:x.id,...data(x)}));
   }
   relations.push(classifyPartnerRelation({
    hubId:u.companyId,id:rel.id,relation:raw,company:pc,
    companyExists:present(partner),teams
   }));
  }
 }
 return Object.freeze({
  audit:"OWNER_WORKSPACE_ROOT_METADATA_READ_ONLY",
  tokenLoginTested:false,firestoreWrites:0,authChanges:0,
  financeOriginalsRead:false,countEntryRecordsRead:false,
  ownersScanned:query.docs.length,ownerStatuses:countBy(verdicts),
  relationsScanned:maxRelations-relationBudget,
  partnerStatuses:countBy(relations),
  // Never log UIDs/emails/partner IDs/names or raw Firestore data.
  stoppedEarly:false
 });
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--read-only"||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!=="sales-management-cc116"||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("RUN_CONTEXT");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getAuth}=require("firebase-admin/auth");
 const {getFirestore}=require("firebase-admin/firestore");
 const app=initializeApp({credential:applicationDefault(),projectId:"sales-management-cc116"});
 const report=await auditOwnerWorkspaceReadiness({
  db:getFirestore(app),auth:getAuth(app)
 });
 console.log("OWNER_WORKSPACE_LIVE_READONLY "+JSON.stringify(report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_WORKSPACE_LIVE_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_WORKSPACE_LIVE_READONLY_UNKNOWN");
  process.exitCode=1;
 });
