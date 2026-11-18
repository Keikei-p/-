#!/usr/bin/env node
/**
 * Production read-only inventory for the exact self-company historical move:
 * つばさ -> つばさ電気. NEVER calls set/update/delete/batch/commit.
 * Avoids printing UIDs, record IDs, company IDs, prices and record contents.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {planTsubasaElectricReclassification} from "./plan-tsubasa-electric-reclassification.mjs";

const PROJECT="sales-management-cc116";
const fail=reason=>{throw Error("STOP_TSUBASA_READONLY_"+reason);};
const id=x=>typeof x==="string"&&/^[A-Za-z0-9_:-]{1,200}$/.test(x);
export const LIMITS=Object.freeze({companies:30,products:1000,records:10000});

export async function auditTsubasaReadOnly({db}={}) {
  if(typeof db?.runTransaction!=="function"||typeof db?.collection!=="function")
    fail("DB_UNAVAILABLE");
  return db.runTransaction(async tx=>{
    // Read every active hub company, never interpret a partner's sales as ours.
    const companies=await tx.get(db.collection("companies")
      .select("companyKind","active","ownerUid").limit(LIMITS.companies+1));
    if(companies.docs.length>LIMITS.companies) fail("COMPANY_INVENTORY_TRUNCATED");
    const own=companies.docs.filter(s=>s.data().companyKind!=="partner" &&
      s.data().active!==false && id(s.data().ownerUid));
    if(own.length!==1) fail("EXACT_ONE_HUB_REQUIRED");
    const companyId=own[0].id;
    const [products,records]=await Promise.all([
      tx.get(db.collection("products").where("companyId","==",companyId)
        .select("companyId","name","active","revenue","pricingOptions","cashbackOptions")
        .limit(LIMITS.products+1)),
      tx.get(db.collection("records").where("companyId","==",companyId)
        .select("companyId","uid","teamId","date","results","totalCount","totalRevenue")
        .limit(LIMITS.records+1))
    ]);
    if(products.docs.length>LIMITS.products || records.docs.length>LIMITS.records)
      fail("INVENTORY_TRUNCATED");
    const plan=planTsubasaElectricReclassification({
      companyId,
      products:products.docs.map(s=>({id:s.id,...s.data()})),
      records:records.docs.map(s=>({id:s.id,...s.data()}))
    });
    // Redacted summary only, no records, finance fields, IDs or PII in CI.
    return Object.freeze({
      project:PROJECT,mode:"LIVE_GET_ONLY_NO_WRITES",
      companyScope:"EXACT_ONE_ACTIVE_INTERNAL_COMPANY",
      productsInspected:products.docs.length,
      historicalRecordsInspected:records.docs.length,
      affectedRecords:plan.affectedRecords,
      movedLines:plan.movedLines,
      movedCount:plan.movedCount,
      mergedLines:plan.mergedLines,
      affectedTeams:new Set(plan.updates.map(u=>u.teamId)).size,
      unaffectedRecords:records.docs.length-plan.affectedRecords,
      allDatesAndTotalRevenuePreserved:true,
      otherProductsPreserved:true,
      productionWrites:0,productionDeletes:0,
      readyForApply:false,
      blockedUntil:"BACKUP_AND_APPROVED_ATOMIC_AUDIT_EXECUTOR"
    });
  },{readOnly:true});
}

async function main(){
  if(process.env.GITHUB_ACTIONS!=="true" ||
     process.env.GITHUB_REPOSITORY!=="Keikei-p/-" ||
     process.env.GITHUB_REF!=="refs/heads/main" ||
     process.env.GITHUB_EVENT_NAME!=="push" ||
     process.env.FIREBASE_PROJECT_ID!==PROJECT ||
     process.env.NICO_TSUBASA_RECLASS_MODE!=="READ_ONLY" ||
     process.env.NICO_TSUBASA_RECLASS_APPLY ||
     !process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"))
       .projects.default!==PROJECT) fail("RUNTIME");
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  const {initializeApp,applicationDefault}=require("firebase-admin/app");
  const {getFirestore}=require("firebase-admin/firestore");
  initializeApp({credential:applicationDefault(),projectId:PROJECT});
  const report=await auditTsubasaReadOnly({db:getFirestore()});
  console.log("NICO_TSUBASA_READONLY "+JSON.stringify(report));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    const message=error?.message||"";
    const safe=/^STOP_(?:TSUBASA_READONLY|TSUBASA_RECLASS)_[A-Z_]+$/.test(message)
      ? message : "STOP_TSUBASA_READONLY_UNVERIFIED";
    console.error(safe);
    process.exitCode=1;
  });
