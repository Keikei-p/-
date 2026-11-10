#!/usr/bin/env node
/**
 * LIVE GET ONLY: profile and product prerequisites for the six deployed
 * Owner settings callables. Only narrow non-finance document field projections,
 * Auth metadata (no tokens), and sanitized aggregate flags are returned.
 * No sign-in, impersonation, writing, sales counts, history or finance reads.
 */
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
const PROJECT="sales-management-cc116";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONEY=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|unitPrice|cashback)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const STOP=x=>{throw Error("STOP_OWNER_SETTING_IDENTITY_READONLY_"+x);};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const snap=x=>x?.exists===true&&typeof x.data==="function"?x.data():null;
const safeName=x=>typeof x==="string"&&x.trim().length>0&&
 x.trim().length<=80&&!MONEY.test(x);
const summary=arr=>Object.freeze(Object.fromEntries(
 [...new Set(arr)].sort().map(label=>[label,arr.filter(x=>x===label).length])));
export function classifyOwnerSettingIdentity({ownerUid,companyId,kind,
 user,member,company,context,authUser}={}){
 if(!id(ownerUid)||!id(companyId)||!obj(company)||
    company.ownerUid!==ownerUid||company.active!==true)
  return "COMPANY_OWNER_LINK_INVALID";
 if(!obj(user)||user.uid!==ownerUid||user.companyId!==companyId||
    user.companyRole!=="owner"||user.active!==true||
    !obj(member)||member.uid!==ownerUid||member.companyRole!=="owner"||
    member.active!==true||
    (member.companyId!=null&&member.companyId!==companyId))
  return "OWNER_USER_OR_MEMBER_ROLE_INVALID";
 if(obj(context)&&context.active!==false)
  return "ACTIVE_SECONDARY_CONTEXT_BLOCKED";
 if(!obj(authUser)||authUser.uid!==ownerUid||
    authUser.disabled===true||authUser.emailVerified!==true||
    typeof authUser.email!=="string"||
    !EMAIL.test(authUser.email))
  return "OWNER_AUTH_METADATA_UNVERIFIED";
 if(typeof user.email==="string"&&
    user.email.trim().toLowerCase()!==authUser.email.trim().toLowerCase())
  return "OWNER_EMAIL_MISMATCH";
 if(user.authKind==="partner_code_shared"||
    member.authKind==="partner_code_shared")
  return "SHARED_CODE_OWNER_NOT_ALLOWED";
 if(kind==="hub"){
  if(!["internal","direct",null,undefined].includes(company.companyKind)||
     user.accessKind==="partner"||member.accessKind==="partner"||
     user.memberType==="cooperator"||member.memberType==="cooperator")
   return "HUB_OWNER_COMPANY_OR_ACCESS_INVALID";
 }else if(kind==="partner"){
  if(company.companyKind!=="partner"||
     !id(company.hubCompanyId)||
     user.accessKind!=="partner"||member.accessKind!=="partner"||
     user.memberType!=="cooperator"||member.memberType!=="cooperator"||
     user.canViewRevenue!==false||member.canViewRevenue!==false||
     user.canViewUnitPrice!==false||member.canViewUnitPrice!==false)
   return "PARTNER_OWNER_FINANCE_ISOLATION_OR_ROLE_INVALID";
 }else STOP("KIND_UNRECOGNIZED");
 return "OWNER_SETTING_ROLE_METADATA_READY";
}
export function classifyHubProductCatalog(rows,hubId){
 if(!Array.isArray(rows)||rows.length>1000||!id(hubId))
  STOP("CATALOG_BOUNDED_SCOPE");
 let active=0,invalid=0,retired=0;
 const seen=new Set();
 for(const item of rows){
  const data=snap(item);
  if(!id(item?.id)||seen.has(item.id)||!obj(data)||
     data.companyId!==hubId||!safeName(data.name)||
     (data.active!=null&&typeof data.active!=="boolean"))
   invalid++;
  else if(data.active!==false)active++;
  else retired++;
  if(id(item?.id))seen.add(item.id);
 }
 return Object.freeze({
  total:rows.length,active,retired,invalid,
  readableByOwner:invalid===0,
  actionableForFirstPublication:invalid===0&&active>0
 });
}
export async function auditOwnerSettingIdentityReadOnly({db,auth}={}){
 if(!db?.collection||typeof auth?.getUser!=="function")STOP("DEPS");
 const companies=await db.collection("companies")
  .select("companyKind","ownerUid","active","hubCompanyId")
  .limit(201).get();
 if(!Array.isArray(companies?.docs)||companies.docs.length>200)
  STOP("COMPANY_BUDGET");
 const hubs=companies.docs.filter(x=>{
  const d=snap(x);
  return d&&d.active!==false&&d.companyKind!=="partner";
 });
 if(hubs.length!==1)STOP("EXPECTED_SINGLE_HUB");
 const hub=hubs[0],hc=snap(hub),hubId=hub.id;
 if(!id(hubId)||!id(hc?.ownerUid))STOP("HUB_SCOPE");
 const relations=await db.collection("partnerRelations")
  .where("hubCompanyId","==",hubId)
  .select("hubCompanyId","partnerCompanyId","active","countSharingApproved")
  .limit(101).get();
 if(!Array.isArray(relations?.docs)||relations.docs.length>100)
  STOP("RELATION_BUDGET");
 const approved=relations.docs.filter(x=>{
  const rel=snap(x);
  return rel?.active===true&&rel.countSharingApproved===true&&
   rel.hubCompanyId===hubId&&rel.partnerCompanyId===x.id;
 });
 if(approved.length>30)STOP("APPROVED_PARTNER_BUDGET");
 const ownerReports=[];
 const lookup=async({id:companyId,company,kind})=>{
  const uid=company?.ownerUid;
  if(!id(companyId)||!id(uid)){
   ownerReports.push(kind==="hub"?"HUB_OWNER_UID_MISSING":"PARTNER_OWNER_UID_MISSING");
   return;
  }
  const users=db.collection("users").doc(uid);
  const member=db.collection("companies").doc(companyId).collection("members").doc(uid);
  const context=db.collection("partnerWorkspaceContexts").doc(uid);
  const [u,m,c]=await Promise.all([
   users.get(),member.get(),context.get()
  ]);
  let au=null;
  try{au=await auth.getUser(uid);}catch{ /* No raw provider messages */ }
  const result=classifyOwnerSettingIdentity({
   ownerUid:uid,companyId,kind,company,
   user:snap(u),member:snap(m),context:snap(c),authUser:au
  });
  ownerReports.push((kind==="hub"?"HUB_":"PARTNER_")+result);
 };
 await lookup({id:hubId,company:hc,kind:"hub"});
 for(const rel of approved){
  const id=rel.id;
  const partner=await db.collection("companies").doc(id)
   .get();
  const p=snap(partner);
  if(!obj(p)||p.companyKind!=="partner"||
     p.hubCompanyId!==hubId||p.active!==true){
   ownerReports.push("PARTNER_COMPANY_RELATION_INVALID");
   continue;
  }
  await lookup({id,company:p,kind:"partner"});
 }
 const productSnap=await db.collection("products")
  .where("companyId","==",hubId)
  .select("companyId","name","active")
  .limit(1001).get();
 if(!Array.isArray(productSnap?.docs)||productSnap.docs.length>1000)
  STOP("PRODUCT_BUDGET");
 const products=classifyHubProductCatalog(productSnap.docs,hubId);
 const statuses=summary(ownerReports);
 const hubReady=statuses.HUB_OWNER_SETTING_ROLE_METADATA_READY===1;
 const partnerReady=statuses.PARTNER_OWNER_SETTING_ROLE_METADATA_READY||0;
 const ready=hubReady&&products.actionableForFirstPublication;
 return Object.freeze({
  project:PROJECT,mode:"LIVE_READ_ONLY_NO_DEPLOY",
  hubOwnerMetadataReady:hubReady,
  partnerOwnersMetadataReady:partnerReady,
  approvedPartners:approved.length,
  hubProductsTotal:products.total,
  hubProductsActive:products.active,
  hubProductsRetired:products.retired,
  hubProductsMalformed:products.invalid,
  hubProductCatalogReadyForFirstOwnerToggle:products.actionableForFirstPublication,
  hubOwnerPageCanLoadFromStoredSchema:hubReady&&products.readableByOwner,
  ownerStatuses:statuses,
  nextStep:!hubReady?"FIX_OWNER_PROFILE_SCHEMA_WITHOUT_CHANGING_HISTORY":
   !products.actionableForFirstPublication?
   "REVIEW_HUB_PRODUCT_CATALOG_WITHOUT_CHANGING_MASTERS":
   partnerReady!==approved.length?
   "FIX_PARTNER_OWNER_PROFILE_OR_FINANCE_DENIAL_BEFORE_CONSENT":
   "OWNER_MANUALLY_REVIEW_SKU_PUBLICATION_AND_RECIPROCAL_CONSENT",
  liveLoginTokenTested:false,
  realPartnerFinanceGetListDeniedVerified:false,
  realPartnerCountSaveVerified:false,
  safeToEnableJointRanking:false,
  financeOrCountOriginalReads:0,
  productionDocumentWrites:0,
  productionAuthChanges:0,
  productionDeploys:0
 });
}
async function main(){
 if(process.argv.length!==2||
    process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    process.env.GITHUB_REF!=="refs/heads/main"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)
  STOP("RUNTIME");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {initializeApp,applicationDefault}=require("firebase-admin/app");
 const {getAuth}=require("firebase-admin/auth");
 const {getFirestore}=require("firebase-admin/firestore");
 const app=initializeApp({credential:applicationDefault(),projectId:PROJECT});
 const result=await auditOwnerSettingIdentityReadOnly({
  db:getFirestore(app),auth:getAuth(app)
 });
 console.log("NICO_OWNER_SETTING_IDENTITY_READINESS "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error(/^STOP_OWNER_SETTING_IDENTITY_READONLY_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_OWNER_SETTING_IDENTITY_READONLY_UNVERIFIED");
  process.exitCode=1;
 });
