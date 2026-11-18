#!/usr/bin/env node
/**
 * Exact one-time production migration: already reviewed 2 historical
 * self-company "つばさ" count lines -> existing "つばさ電気" product.
 * No document deletion, other-product changes, team/date/user changes,
 * count/revenue/CB/rate changes, product updates or partner writes.
 * 2 records + 2 immutable before/after correction audits commit ATOMICALLY.
 */
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {planTsubasaElectricReclassification} from
  "./plan-tsubasa-electric-reclassification.mjs";
import {LIMITS} from "./inspect-tsubasa-electric-reclassification-readonly.mjs";

const PROJECT="sales-management-cc116";
const PREVIEW_MAIN="6429862066b06982c4d4c80005ee9a35f4402f96";
const fail=r=>{throw Error("STOP_TSUBASA_ATOMIC_"+r);};
const id=x=>typeof x==="string"&&/^[A-Za-z0-9_:-]{1,200}$/.test(x);
const exactPlan=p=>p.affectedRecords===2&&p.movedLines===2&&p.movedCount===2&&
  p.mergedLines===0&&p.deletes===0&&p.otherProductChanges===0&&
  new Set(p.updates.map(u=>u.teamId)).size===2;
const auditId=(companyId,recordId)=>"tsubasa_electric_20261118_"+
  createHash("sha256").update(companyId+"\0"+recordId).digest("hex").slice(0,40);
const auditValue=(doc,results)=>({
  memberNameSnapshot:doc.memberNameSnapshot??"",
  teamId:doc.teamId??null,
  teamNameSnapshot:doc.teamNameSnapshot??"",
  workLocation:doc.workLocation??"",
  results,
  totalCount:doc.totalCount,
  totalRevenue:doc.totalRevenue,
  reportStatus:doc.reportStatus??"submitted"
});

export async function applyExactTwoTsubasaRecords({db,FieldValue}={}) {
  if(typeof db?.runTransaction!=="function" ||
     typeof db?.collection!=="function" ||
     typeof FieldValue?.serverTimestamp!=="function") fail("DEPENDENCY");
  // maxAttempts:1: never re-run this sensitive write after a conflict.
  const committed=await db.runTransaction(async tx=>{
    const companies=await tx.get(db.collection("companies")
      .select("companyKind","active","ownerUid").limit(LIMITS.companies+1));
    if(companies.docs.length>LIMITS.companies) fail("HUB_LIMIT");
    const owned=companies.docs.filter(s=>s.data().companyKind!=="partner" &&
      s.data().active!==false&&id(s.data().ownerUid));
    if(owned.length!==1) fail("OWNER_COMPANY");
    const companyId=owned[0].id,ownerUid=owned[0].data().ownerUid;
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
    const catalog=products.docs.map(s=>({id:s.id,...s.data()}));
    const plan=planTsubasaElectricReclassification({companyId,products:catalog,
      records:records.docs.map(s=>({id:s.id,...s.data()}))});
    if(!exactPlan(plan)) fail("EXACT_TWO_PREVIEW_DRIFT");
    const readbacks=[];
    // ALL reads happen before ANY writes, including unique immutable audit refs.
    for(const change of plan.updates){
      const recordRef=db.collection("records").doc(change.recordId);
      const auditRef=db.collection("recordCorrections")
        .doc(auditId(companyId,change.recordId));
      const [original,priorAudit]=await Promise.all([
        tx.get(recordRef),tx.get(auditRef)
      ]);
      if(!original.exists || priorAudit.exists) fail("AUDIT_CONFLICT_OR_MISSING");
      const data=original.data();
      if(data.companyId!==companyId || data.uid!==change.uid ||
         data.date!==change.date || (data.teamId??null)!==change.teamId ||
         data.totalCount!==change.unchangedTotalCount ||
         data.totalRevenue!==change.unchangedTotalRevenue ||
         !isDeepStrictEqual(data.results,change.expectedResults))
        fail("RECORD_CHANGED");
      readbacks.push({change,recordRef,auditRef,data});
    }
    // Recheck the complete native documents; projection must never hide a row.
    const fullPlan=planTsubasaElectricReclassification({companyId,products:catalog,
      records:readbacks.map(x=>({id:x.change.recordId,...x.data}))});
    if(!exactPlan(fullPlan)) fail("FULL_SOURCE_DRIFT");
    for(let i=0;i<readbacks.length;i++){
      const {change,recordRef,auditRef,data}=readbacks[i];
      const canonical=fullPlan.updates.find(u=>u.recordId===change.recordId);
      if(!canonical || !isDeepStrictEqual(canonical.nextResults,change.nextResults))
        fail("PREVIEW_TRANSACTION_MISMATCH");
      const audit={
        companyId,recordId:recordRef.id,recordUid:data.uid,
        recordDate:data.date,changedByUid:ownerUid,
        changedByName:"自社Owner 商材名統合",
        before:auditValue(data,data.results),
        after:auditValue(data,change.nextResults),
        createdAt:FieldValue.serverTimestamp()
      };
      tx.create(auditRef,audit); // immutable, no overwrite
      tx.update(recordRef,{
        results:change.nextResults,
        updatedAt:FieldValue.serverTimestamp(),
        updatedByUid:ownerUid
      });
    }
    return {companyId,movedCount:2,updatedRecords:2,auditsCreated:2,
      verification:readbacks.map(x=>({id:x.change.recordId,
        expected:x.change.nextResults,previous:x.change.expectedResults,
        count:x.change.unchangedTotalCount,
        revenue:x.change.unchangedTotalRevenue}))};
  },{maxAttempts:1});

  // Postcommit read-only verification: no other records or products are written.
  const checked=await db.runTransaction(async tx=>{
    for(const item of committed.verification) {
      const [record,audit]=await Promise.all([
        tx.get(db.collection("records").doc(item.id)),
        tx.get(db.collection("recordCorrections")
          .doc(auditId(committed.companyId,item.id)))
      ]);
      if(!record.exists||!audit.exists) fail("POSTCOMMIT_MISSING");
      const current=record.data(),proof=audit.data();
      if(current.companyId!==committed.companyId ||
         !isDeepStrictEqual(current.results,item.expected) ||
         current.totalCount!==item.count ||
         current.totalRevenue!==item.revenue ||
         !isDeepStrictEqual(proof.before.results,item.previous) ||
         !isDeepStrictEqual(proof.after.results,item.expected))
        fail("POSTCOMMIT_INTEGRITY");
    }
    return true;
  },{readOnly:true});
  if(checked!==true) fail("POSTCOMMIT_UNVERIFIED");
  return Object.freeze({
    project:PROJECT,status:"EXACT_TWO_MOVED_ATOMIC_AND_VERIFIED",
    updatedRecords:committed.updatedRecords,
    movedCount:committed.movedCount,
    auditDocumentsCreated:committed.auditsCreated,
    originalDatesTeamsCountRevenueAndCbPreserved:true,
    otherDocumentsDeleted:0,
    otherProductsModified:0
  });
}

async function main(){
  if(process.env.GITHUB_ACTIONS!=="true" ||
     process.env.GITHUB_REPOSITORY!=="Keikei-p/-" ||
     process.env.GITHUB_REF!=="refs/heads/main" ||
     process.env.GITHUB_EVENT_NAME!=="push" ||
     process.env.NICO_TSUBASA_EXACT_TWO_APPROVAL!=="EXACT_TWO_AUTHORIZED_NO_OTHER_CHANGES" ||
     process.env.NICO_TSUBASA_REVIEWED_PARENT!==PREVIEW_MAIN ||
     process.env.FIREBASE_PROJECT_ID!==PROJECT ||
     !process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     JSON.parse(readFileSync(new URL("../../.firebaserc",import.meta.url),"utf8"))
       .projects.default!==PROJECT) fail("RUNTIME");
  const require=createRequire(new URL("../../functions/package.json",import.meta.url));
  const {initializeApp,applicationDefault}=require("firebase-admin/app");
  const {getFirestore,FieldValue}=require("firebase-admin/firestore");
  initializeApp({credential:applicationDefault(),projectId:PROJECT});
  console.log("TSUBASA_EXACT_TWO_ATOMIC_STARTED_NO_DELETES");
  const report=await applyExactTwoTsubasaRecords({db:getFirestore(),FieldValue});
  console.log("NICO_TSUBASA_ATOMIC_RESULT "+JSON.stringify(report));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    const message=error?.message||"";
    console.error(/^STOP_(?:TSUBASA_ATOMIC|TSUBASA_RECLASS)_[A-Z_]+$/.test(message)?
      message:"STOP_TSUBASA_ATOMIC_UNVERIFIED");
    process.exitCode=1;
  });
