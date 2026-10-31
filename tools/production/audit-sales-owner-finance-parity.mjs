#!/usr/bin/env node
/**
 * Read-only rehearsal of the existing Finance Gateway's Owner view against
 * real Firestore originals. Does not use or grant user auth, deploy anything,
 * mutate any collection, or print a customer, amount, UID or document ID.
 *
 * This is a bounded sample, NOT approval to close legacy client Rules. The
 * browser still directly uses original monetary Firestore collections.
 */
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {safeProducts,safeRecords,safeGoals,approvedPolicy} from
  "../../cloudflare-finance/src/index.js";
import {securePricing} from "../../cloudflare-finance/src/write-plan.js";
import {projectSafeView} from "../../cloudflare-finance/client/finance-browser-contract.mjs";

const PROJECT="sales-management-cc116";
const MAX_PRODUCTS=100, MAX_RECORDS=200, MAX_GOALS=100, MAX_COMPANIES=4;
const abort=reason=>{throw Error("OWNER_FINANCE_PARITY_STOP_"+reason);};
const validId=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
function previousTokyoMonth(date=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(date).map(p=>[p.type,p.value]));
 const month=new Date(Date.UTC(Number(parts.year),Number(parts.month)-2,1));
 return month.toISOString().slice(0,7);
}
function nextMonth(month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))abort("INVALID_MONTH");
 const [y,m]=month.split("-").map(Number);
 return new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
}
/** Throws on any count, revenue, rate, product identity or record mismatch. */
export function verifyOwnerGatewayParity({rawProducts,rawRecords,rawGoals,companyId,policy}){
 if(!policy||!policy.isOwner||policy.isPartner||
    !policy.canViewRevenue||!policy.canViewUnitPrice||policy.companyId!==companyId)
  abort("OWNER_PERMISSIONS");
 if(![rawProducts,rawRecords,rawGoals].every(Array.isArray))abort("BAD_INPUT");
 const products=safeProducts(rawProducts,policy);
 const records=safeRecords(rawRecords,policy,rawProducts);
 const goals=safeGoals(rawGoals,policy);
 let view;
 try{
  view=projectSafeView({products,records,revenueGoals:goals,policy:{
   canViewRevenue:policy.canViewRevenue,canViewUnitPrice:policy.canViewUnitPrice,
   isOwner:policy.isOwner,isPartner:false
  }});
 }catch{abort("CLIENT_CONTRACT");}
 if(view.products.length!==rawProducts.length||
    view.records.length!==rawRecords.length||
    view.revenueGoals.length!==rawGoals.length)abort("INCOMPLETE_OWNER_VIEW");
 const productById=new Map(view.products.map(x=>[x.id,x]));
 if(productById.size!==rawProducts.length)abort("DUPLICATE_PRODUCTS");
 for(const p of rawProducts){
  if(!validId(p.id)||p.companyId!==companyId)abort("FOREIGN_OR_BAD_PRODUCT");
  const item=productById.get(p.id);
  if(!item||item.name!==p.name||item.revenue!==p.revenue)
   abort("PRODUCT_NAME_OR_REVENUE_CHANGED");
  const originalPlans=securePricing(p);
  if(item.pricingOptions.length!==originalPlans.length)
   abort("PRODUCT_PRICE_OPTIONS_MISSING");
  for(let i=0;i<originalPlans.length;i++){
   const a=originalPlans[i],b=item.pricingOptions[i];
   if(a.cashback!==b.cashback||a.revenuePerUnit!==b.revenuePerUnit||
      item.securePlanIds[i]!==a.planId)abort("PRODUCT_UNIT_PRICE_CHANGED");
  }
 }
 const recordById=new Map(view.records.map(x=>[x.id,x]));
 if(recordById.size!==rawRecords.length)abort("DUPLICATE_RECORDS");
 for(const r of rawRecords){
  if(!validId(r.id)||r.companyId!==companyId)abort("FOREIGN_OR_BAD_RECORD");
  const item=recordById.get(r.id);
  if(!item||item.uid!==r.uid||item.teamId!==r.teamId||
      item.date!==r.date||item.totalCount!==r.totalCount||
      item.totalRevenue!==r.totalRevenue)abort("RECORD_TOTALS_OR_IDENTITY_CHANGED");
  const originalValues=Object.values(r.results||{}),shown=Object.values(item.results||{});
  if(originalValues.length!==shown.length)abort("HISTORICAL_LINE_MISSING");
  // Owner may see all original result money, not zeroed or repriced lines.
  for(let i=0;i<originalValues.length;i++){
   const a=originalValues[i],b=shown[i];
   if(a.count!==b.count||
      (a.revenuePerUnit!==undefined && a.revenuePerUnit!==b.revenuePerUnit)||
      (a.cashback!==undefined && a.cashback!==b.cashback))
     abort("HISTORICAL_LINE_AMOUNT_CHANGED");
  }
 }
 const goalById=new Map(view.revenueGoals.map(x=>[x.id,x]));
 if(goalById.size!==rawGoals.length)abort("DUPLICATE_GOALS");
 for(const g of rawGoals){
  const item=goalById.get(g.id);
  if(!item||item.teamId!==g.teamId||item.targetRevenue!==g.targetRevenue)
   abort("OWNER_REVENUE_GOAL_CHANGED");
 }
 return Object.freeze({productsChecked:rawProducts.length,recordsChecked:rawRecords.length,
  revenueGoalsChecked:rawGoals.length,ownerAmountsPreserved:true,
  sampleAvailable:rawRecords.length>0});
}
function rows(snap,limit,label){
 if(snap.size>limit)abort("SCAN_LIMIT_"+label);
 return snap.docs.map(doc=>({id:doc.id,...doc.data()}));
}
/**
 * A single last-month bounded sample. Date range uses Firestore's existing
 * single-field date index: no company+date composite index is required.
 * The query is NOT assumed complete if it reaches the strict cap.
 */
export async function inspectOwnerFinance({db,asOf=new Date()}){
 if(!db||typeof db.collection!=="function")abort("MISSING_DB");
 const month=previousTokyoMonth(asOf),end=nextMonth(month);
 const cs=await db.collection("companies").limit(MAX_COMPANIES+1).get();
 if(cs.size>MAX_COMPANIES)abort("COMPANY_SCAN_LIMIT");
 const internal=cs.docs.filter(x=>x.data().active!==false &&
  (x.data().companyKind==null||x.data().companyKind==="internal"));
 if(!internal.length)abort("NO_INTERNAL_COMPANY");
 let reviewed=0,productsChecked=0,recordsChecked=0,revenueGoalsChecked=0;
 for(const companyDoc of internal){
  const company=companyDoc.data(),cid=companyDoc.id,uid=company.ownerUid;
  if(!validId(cid)||!validId(uid))abort("OWNER_ID_NOT_VERIFIED");
  const [us,ms,ps,rs,gs]=await Promise.all([
   db.collection("users").doc(uid).get(),
   db.collection("companies").doc(cid).collection("members").doc(uid).get(),
   db.collection("products").where("companyId","==",cid).limit(MAX_PRODUCTS+1).get(),
   db.collection("records").where("date",">=",month+"-01")
     .where("date","<",end+"-01").limit(MAX_RECORDS+1).get(),
   db.collection("revenueGoals").where("companyId","==",cid).limit(MAX_GOALS+1).get()
  ]);
  if(!us.exists||!ms.exists)abort("OWNER_PROFILE_NOT_FOUND");
  const user=us.data(),member=ms.data();
  if(user.companyId!==cid||user.active===false||member.active===false||
     (member.uid!=null&&member.uid!==uid)||
     (member.companyId!=null&&member.companyId!==cid))
   abort("OWNER_PROFILE_INCONSISTENT");
  let policy;
  try{policy=approvedPolicy(user,{uid,...member},company,uid,month+"-28");}
  catch{abort("OWNER_POLICY_REJECTED");}
  if(!policy.isOwner||!policy.canViewRevenue||!policy.canViewUnitPrice)
   abort("OWNER_AMOUNT_ACCESS_MISSING");
  const products=rows(ps,MAX_PRODUCTS,"PRODUCTS");
  const records=rows(rs,MAX_RECORDS,"RECORDS")
    .filter(x=>x.companyId===cid);
  const goals=rows(gs,MAX_GOALS,"GOALS");
  const result=verifyOwnerGatewayParity({
   rawProducts:products,rawRecords:records,rawGoals:goals,companyId:cid,policy});
  reviewed++;
  productsChecked+=result.productsChecked;
  recordsChecked+=result.recordsChecked;
  revenueGoalsChecked+=result.revenueGoalsChecked;
 }
 return Object.freeze({project:PROJECT,mode:"READ_ONLY",month,
  ownerCompaniesChecked:reviewed,productsChecked,recordsChecked,revenueGoalsChecked,
  dataWrites:0,authSignIns:0,originalsMutated:false,
  ownerFinanceSampleVerified:reviewed>0&&recordsChecked>0,
  partnerFinancialDenialVerified:false,
  legacyBrowserGatewayOnlyVerified:false,
  approvedForProductionCutover:false});
}
async function main(){
 if(process.env.NICO_OWNER_FINANCE_AUDIT_MODE!=="READ_ONLY"||
    process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.GOOGLE_APPLICATION_CREDENTIALS)abort("APPROVED_ENV_REQUIRED");
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault,initializeApp}=require("firebase-admin/app");
 const {getFirestore}=require("firebase-admin/firestore");
 initializeApp({credential:applicationDefault(),projectId:PROJECT});
 const result=await inspectOwnerFinance({db:getFirestore()});
 console.log("NICO_OWNER_FINANCE_READONLY_PARITY "+JSON.stringify(result));
 if(!result.ownerFinanceSampleVerified)
  console.log("OWNER_FINANCE_SAMPLE_INSUFFICIENT: no live last-month records, no cutover");
 console.log("PRODUCTION_GATE_STILL_BLOCKED: legacy browser raw finance / partner ACL / backup restore");
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(e=>{
  console.error(String(e?.message||"").startsWith("OWNER_FINANCE_PARITY_STOP_")?
    e.message:"OWNER_FINANCE_PARITY_STOP_UNEXPECTED");
  process.exitCode=1;
 });
}
