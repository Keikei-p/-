import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createPartnerMonthReadOnlyLoader} from
 "../ranking/partner-month-readonly-loader.mjs";
import {createRankOnlyPublication} from "../ranking/rank-only-publication.mjs";

const PROJECT="demo-nico-partner-ranking";
const LOCAL=/^(?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/;
const requireAdmin=createRequire(new URL("../functions-partner-workspace/package.json",import.meta.url));
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const zeros=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
test("real Firebase Admin Firestore emulator: reconciled transactional count read and revocation",{
 skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000
},async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==PROJECT||
    process.env.GCLOUD_PROJECT!==PROJECT||
    !LOCAL.test(process.env.FIRESTORE_EMULATOR_HOST)||
    process.env.GOOGLE_APPLICATION_CREDENTIALS||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error("STOP_PRODUCTION_IDENTITY_OR_REMOTE_FIRESTORE");
 const {initializeApp,deleteApp}=requireAdmin("firebase-admin/app");
 const {getFirestore}=requireAdmin("firebase-admin/firestore");
 const app=initializeApp({projectId:PROJECT},"ranking-only-isolated");
 const db=getFirestore(app);
 const hub="hub",partner="cooperator",team="team1";
 const date="2026-11-07",person="worker";
 const count={...zeros(),NURO:2,"SB光・AIR":1};
 const documentPaths={
  original:"records/immutable-finance-original",
  entry:"companies/"+partner+"/partnerWorkEntries/"+date+"__"+person,
  summary:"companies/"+hub+"/partnerWorkCountDays/"+date+"/reports/"+partner,
  relation:"partnerRelations/"+partner
 };
 const write=(path,data)=>db.doc(path).set(data);
 try{
  await Promise.all([
   write("companies/"+hub,{name:"自社",companyKind:"internal",active:true}),
   write("companies/"+partner,{name:"協力店",companyKind:"partner",
    active:true,hubCompanyId:hub}),
   write(documentPaths.relation,{
    hubCompanyId:hub,partnerCompanyId:partner,active:true,
    countSharingApproved:true,
    combinedRankingApprovedByHub:true,combinedRankingApprovedByPartner:true,
    individualNamesApprovedByHub:true,individualNamesApprovedByPartner:true
   }),
   write("companies/"+partner+"/partnerWorkTeams/"+team,{
    companyId:partner,name:"営業班",active:true
   }),
   write(documentPaths.entry,{
    companyId:partner,hubCompanyId:hub,date,staffId:person,
    counts:count,totalCount:3,version:1,teamIdSnapshot:team,
    staffNameSnapshot:"検証担当",privateCounts:{privateSku:7},
    privateTotalCount:7
   }),
   write(documentPaths.summary,{
    source:"staff-entries-v1",hubCompanyId:hub,partnerCompanyId:partner,
    date,counts:count,totalCount:3
   }),
   write(documentPaths.original,{
    companyId:hub,totalRevenue:120000,unitPrice:30000,cashback:5000
   })
  ]);
  const original=(await db.doc(documentPaths.original).get()).data();
  const ctx={
   serverVerified:true,userActive:true,memberActive:true,companyActive:true,
   reciprocalOwnersApproved:true,individualNamesApproved:true,
   completeSnapshotBudgetApproved:true,hubCompanyId:hub,
   approvedCompanyIds:[hub,partner]
  };
  const read=()=>createPartnerMonthReadOnlyLoader({db})({
   hubCompanyId:hub,partnerCompanyId:partner,month:"2026-11",context:ctx
  });
  const source=await read();
  assert.equal(source.records.length,1);
  assert.equal(source.records[0].totalCount,3);
  assert.deepEqual(source.lines.map(x=>x.count),[2,1]);
  assert(!JSON.stringify(source).includes("privateSku"));
  assert(!JSON.stringify(source).includes("totalRevenue"));
  assert.deepEqual((await db.doc(documentPaths.original).get()).data(),original);
  // Current server-side mutual approval is checked AGAIN, not from a
  // possibly stale browser or cached context.
  await db.doc(documentPaths.relation).update({
   combinedRankingApprovedByPartner:false
  });
  await assert.rejects(read(),/INCOMPLETE/);
  assert.deepEqual((await db.doc(documentPaths.original).get()).data(),original);
 }finally{await deleteApp(app);}
});
