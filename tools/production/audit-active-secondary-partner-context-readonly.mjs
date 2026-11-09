#!/usr/bin/env node
/**
 * Bounded metadata-only partner dual-membership audit. At most 26 context
 * documents and 25*3 identity documents may be read, never written.
 * Do not read even one price, sales, correction or revenue goal document.
 * Only safe aggregate counters leave this process. Auth claims are NOT tested.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const PROJECT="sales-management-cc116";
const LIMIT=25;
const ID=/^[a-zA-Z0-9_-]{1,128}$/;
const INTERNAL=new Set(["internal","direct","member","managed"]);
const STOP=reason=>{throw Error("STOP_PARTNER_CONTEXT_READONLY_"+reason);};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const active=x=>obj(x)&&x.active!==false;
const internal=x=>x==null||x==="internal";
export function classifyActiveSecondaryContext(item){
 if(!obj(item)||typeof item.uid!=="string"||!ID.test(item.uid))STOP("BAD_CONTEXT_ROW");
 const ctx=item.context;
 if(!obj(ctx)||ctx.active!==true)return Object.freeze({active:false,risk:false,invalid:false});
 if(ctx.kind!=="partner_secondary"||ctx.uid!==item.uid||
    !ID.test(ctx.primaryCompanyId??"")||
    !ID.test(ctx.partnerCompanyId??"")||
    ctx.primaryCompanyId===ctx.partnerCompanyId)
  return Object.freeze({active:true,risk:false,invalid:true});
 const u=item.user,m=item.member,c=item.company;
 if(!obj(u)||!obj(m)||!obj(c))
  return Object.freeze({active:true,risk:false,invalid:true});
 const primaryMembership=u.companyId===ctx.primaryCompanyId &&
  active(u)&&active(m)&&internal(u.accessKind)&&internal(m.accessKind)&&
  internal(c.companyKind)&&
  INTERNAL.has(u.memberType??"internal")&&
  INTERNAL.has(m.memberType??"internal");
 // The original Firestore Rules allow read of records (including revenue)
 // when isCompanyMember passes, regardless of canViewRevenue. Whether the
 // real Auth email_verified claim passes is deliberately NOT inferred here.
 return Object.freeze({active:true,risk:primaryMembership,invalid:false});
}
export function aggregateSecondaryContextAudit(rows){
 if(!Array.isArray(rows)||rows.length>LIMIT)STOP("READ_SCOPE_EXCEEDED");
 let actives=0,risks=0,invalid=0;
 for(const row of rows){
  const check=classifyActiveSecondaryContext(row);
  if(check.active)actives++;
  if(check.risk)risks++;
  if(check.invalid)invalid++;
 }
 return Object.freeze({
  project:PROJECT,mode:"BOUNDED_PRODUCTION_IDENTITY_METADATA_READ_ONLY",
  contextsScanned:rows.length,activeSecondaryContexts:actives,
  activeSecondaryWithLegacyPrimaryFinancialReadPathPotential:risks,
  activeSecondaryUnknownIdentityContext:invalid,
  sourceRiskProofNotActualClientAccess:true,
  realAccountIdTokenGET_LIST_DenialProven:false,
  originalFinancialDocumentsRead:0,
  productionDocumentsWritten:0,
  firebaseDeploys:0,
  safeToEnableJointRanking:false,
  safeToApplyFinancialFenceWithoutContinuityTest:false
 });
}
async function main(){
 if(process.argv.length!==2||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("UNAPPROVED_RUN_CONTEXT");
 const cfg=JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"));
 if(cfg.projects?.default!==PROJECT)STOP("WRONG_PROJECT");
 let firestore;
 try{
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  const {initializeApp,applicationDefault}=require("firebase-admin/app");
  const {getFirestore}=require("firebase-admin/firestore");
  firestore=getFirestore(initializeApp({credential:applicationDefault(),projectId:PROJECT}));
 }catch{STOP("AUDIT_SDK_OR_IDENTITY_UNAVAILABLE");}
 let contexts;
 try{
  contexts=await firestore.collection("partnerWorkspaceContexts").limit(LIMIT+1).get();
 }catch{STOP("CONTEXT_LIST_UNAVAILABLE");}
 if(contexts.size>LIMIT)STOP("READ_SCOPE_EXCEEDED");
 const rows=[];
 for(const snap of contexts.docs){
  const ctx=snap.data();
  const uid=snap.id;
  if(!ID.test(uid))STOP("CONTEXT_ID_UNTRUSTED");
  if(!obj(ctx)||ctx.active!==true){
   rows.push({uid,context:ctx??null});
   continue;
  }
  if(!ID.test(ctx.primaryCompanyId??"")||
     !ID.test(ctx.partnerCompanyId??"")){
   rows.push({uid,context:ctx});
   continue;
  }
  let u,m,c;
  try{
   [u,m,c]=await Promise.all([
    firestore.collection("users").doc(uid).get(),
    firestore.collection("companies").doc(ctx.primaryCompanyId).collection("members").doc(uid).get(),
    firestore.collection("companies").doc(ctx.primaryCompanyId).get()
   ]);
  }catch{STOP("IDENTITY_METADATA_UNAVAILABLE");}
  rows.push({uid,context:ctx,
   user:u.exists?u.data():null,member:m.exists?m.data():null,
   company:c.exists?c.data():null});
 }
 const report=aggregateSecondaryContextAudit(rows);
 console.log("LIVE_SECONDARY_PARTNER_CONTEXT_SCOPE "+JSON.stringify(report));
 if(report.activeSecondaryWithLegacyPrimaryFinancialReadPathPotential>0)
  console.log("BLOCK_SECONDARY_PARTNER_PRIMARY_FINANCE_READ_PATH_POSSIBLE");
 if(report.activeSecondaryUnknownIdentityContext>0)
  console.log("STOP_SECONDARY_PARTNER_CONTEXT_METADATA_NOT_FULLY_CLASSIFIED");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_PARTNER_CONTEXT_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_PARTNER_CONTEXT_READONLY_UNKNOWN");
  process.exitCode=1;
 });
