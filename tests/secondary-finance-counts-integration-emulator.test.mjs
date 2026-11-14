import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {proposeSecondaryFinanceFence,COLLECTIONS} from
 "../security/secondary-finance-read-fence.mjs";

const PROJECT="demo-nico-secondary-finance-fence";
const HOST=/^(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]{2,5}$/;
const requireAdmin=createRequire(new URL("../functions-partner-workspace/package.json",import.meta.url));
const requireService=createRequire(import.meta.url);

// NOTE: signed-in users and ID tokens here are fictional. This DOES NOT
// establish real-user Firebase Auth / production counts or finance denial.
test("isolated REAL Firestore emulator: secondary user preserves count save/correction while four finance originals stay denied",{
 skip:!process.env.FIRESTORE_EMULATOR_HOST,
 timeout:120000
},async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==PROJECT)
  throw Error("STOP_NOT_DEMO_FIREBASE_PROJECT");
 if(process.env.GCLOUD_PROJECT!==PROJECT)
  throw Error("STOP_NOT_DEMO_GCLOUD_PROJECT");
 if(!HOST.test(process.env.FIRESTORE_EMULATOR_HOST))
  throw Error("STOP_NOT_LOCAL_FIRESTORE_EMULATOR");
 const {initializeApp,deleteApp}=requireAdmin("firebase-admin/app");
 const {getFirestore,FieldValue,Timestamp}=requireAdmin("firebase-admin/firestore");
 const {makeWorkspace,KEYS}=requireService("../functions-partner-workspace/service.cjs");
 const {initializeTestEnvironment,assertFails,assertSucceeds}=
  await import("@firebase/rules-unit-testing");
 const {collection,doc,getDoc,query,where,getDocsFromServer}=
  await import("firebase/firestore");
 const env=await initializeTestEnvironment({
  projectId:PROJECT,firestore:{rules:proposeSecondaryFinanceFence()}
 });
 // Repeated local runs use a fresh synthetic fixture. The strict demo
 // project and loopback emulator guards above run before this operation.
 await env.clearFirestore();
 const app=initializeApp({projectId:PROJECT},"isolated-dual-count-finance");
 const db=getFirestore(app);
 const hub="hubCount",partner="partnerCount",worker="dualCount",
  owner="ownerCount",team="teamCount",date="2026-11-07";
 const now=Date.parse("2026-11-08T12:00:00+09:00");
 const write=(path,row)=>db.doc(path).set(row);
 const docs=Object.fromEntries(COLLECTIONS.map((name,i)=>[name,{
  companyId:hub,teamId:team,unitPrice:15000+i,
  totalRevenue:24000+i,cashback:7000+i,marker:"immutable-finance-"+name
 }]));
 const ownerProfile={uid:owner,companyId:hub,companyRole:"owner",
  role:"leader",active:true,accessKind:"internal",memberType:"direct",
  email:owner+"@example.test",teamId:team};
 const internalProfile={uid:worker,companyId:hub,companyRole:"member",
  role:"member",active:true,accessKind:"internal",memberType:"direct",
  email:worker+"@example.test",teamId:team,
  canViewRevenue:true,canViewUnitPrice:true};
 const partnerMember={uid:worker,companyId:partner,companyRole:"member",
  role:"member",active:true,accessKind:"partner",memberType:"cooperator",
  email:worker+"@example.test",teamId:team,
  canViewRevenue:false,canViewUnitPrice:false,canCreateInvite:false};
 const request=(uid,data)=>({auth:{
  uid,token:{email:uid+"@example.test",email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+uid.repeat(30)}},
  data
 });
 const authUser=(uid)=>({uid,email:uid+"@example.test",
  emailVerified:true,disabled:false});
 const getAuth=()=>({
  getUser:async uid=>authUser(uid),
  verifyIdToken:async token=>({
   uid:token.startsWith(worker)?worker:owner,
   email:(token.startsWith(worker)?worker:owner)+"@example.test",
   email_verified:true
  })
 });
 class HttpsError extends Error{
  constructor(code,message){super(message);this.code=code;}
 }
 const service=makeWorkspace({db,getAuth,FieldValue,Timestamp,HttpsError,
  enabled:()=>true,now:()=>now});
 const browser=uid=>env.authenticatedContext(uid,{
  email:uid+"@example.test",email_verified:true
 }).firestore();

 try{
  await Promise.all([
   write("companies/"+hub,{companyKind:"internal",active:true,
    ownerUid:owner,masterUid:owner,name:"自社"}),
   write("companies/"+partner,{companyKind:"partner",active:true,
    hubCompanyId:hub,ownerUid:"partnerOwner",name:"協力店"}),
   write("users/"+owner,ownerProfile),
   write("users/"+worker,internalProfile),
   write("companies/"+hub+"/members/"+owner,ownerProfile),
   write("companies/"+hub+"/members/"+worker,internalProfile),
   write("companies/"+partner+"/members/"+worker,partnerMember),
   write("partnerWorkspaceContexts/"+worker,{
    uid:worker,kind:"partner_secondary",active:true,primaryCompanyId:hub,
    partnerCompanyId:partner,hubCompanyId:hub,
    role:"member",teamId:team,emailLower:(worker+"@example.test").toLowerCase()
   }),
   write("partnerRelations/"+partner,{
    active:true,countSharingApproved:true,hubCompanyId:hub,
    partnerCompanyId:partner
   }),
   write("companies/"+partner+"/partnerWorkTeams/"+team,{
    companyId:partner,name:"件数検証班",active:true
   }),
   write("companies/"+partner+"/partnerWorkStaff/"+worker,{
    uid:worker,companyId:partner,name:"検証担当",kind:"account",
    role:"member",teamId:team,active:true
   }),
   ...COLLECTIONS.map(name=>write(name+"/counts-integration-original",docs[name]))
  ]);
  const before={};
  for(const name of COLLECTIONS)
   before[name]=(await db.doc(name+"/counts-integration-original").get()).data();

  const partnerBrowser=browser(worker),ownerBrowser=browser(owner);
  for(const name of COLLECTIONS){
   const path=name+"/counts-integration-original";
   await assertFails(getDoc(doc(partnerBrowser,path)));
   await assertSucceeds(getDoc(doc(ownerBrowser,path)));
   const conditions=[where("companyId","==",hub)];
   if(name==="revenueGoals")conditions.push(where("teamId","==",team));
   await assertFails(getDocsFromServer(query(
    collection(partnerBrowser,name),...conditions
   )));
  }
  const data={date,workspaceCompanyId:partner};
  const initial=await service.view(request(worker,data));
  assert.equal(initial.role,"member");
  assert.equal(initial.records.length,0);
  const empty=Object.fromEntries(KEYS.map(k=>[k,0]));
  const create=await service.submit(request(worker,{
   ...data,staffId:worker,counts:{...empty,NURO:2},expectedVersion:0
  }));
  assert.equal(create.saved,true);
  assert.equal(create.version,1);
  const saved=await service.view(request(worker,data));
  assert.deepEqual(saved.records.map(r=>[r.staffId,r.counts.NURO,r.version]),
   [[worker,2,1]]);
  const corrected=await service.submit(request(worker,{
   ...data,staffId:worker,counts:{...empty,NURO:3,"SB光・AIR":1},
   expectedVersion:1
  }));
  assert.equal(corrected.saved,true);
  assert.equal(corrected.version,2);
  await assert.rejects(service.submit(request(worker,{
   ...data,staffId:worker,counts:{...empty,NURO:99},expectedVersion:1
  })),e=>e.code==="aborted");
  const after=await service.view(request(worker,data));
  assert.deepEqual(after.records.map(x=>[
   x.version,x.counts.NURO,x.counts["SB光・AIR"],x.totalCount
  ]),[[2,3,1,4]]);
  const hubCounts=await service.view(request(owner,{date}));
  assert.equal(hubCounts.role,"hub");
  assert.equal(hubCounts.partners.length,1);
  assert.equal(hubCounts.partners[0].totalCount,4);
  const history=await db.doc("companies/"+partner+
   "/partnerWorkAudits/"+date+"__"+worker+"__v2").get();
  assert.equal(history.exists,true);
  assert.equal(history.data().previousCounts.NURO,2);
  // Use the real Admin transaction/query path: an equal grand total must
  // not let a normal save carry a corrupted SKU allocation into history.
  const summaryRef=db.doc("companies/"+hub+
   "/partnerWorkCountDays/"+date+"/reports/"+partner);
  const entryRef=db.doc("companies/"+partner+
   "/partnerWorkEntries/"+date+"__"+worker);
  const nextAuditRef=db.doc("companies/"+partner+
   "/partnerWorkAudits/"+date+"__"+worker+"__v3");
  const summaryBefore=(await summaryRef.get()).data();
  const entryBefore=(await entryRef.get()).data();
  const inconsistent={...summaryBefore,counts:{
   ...summaryBefore.counts,NURO:2,"SB光・AIR":2
  }};
  await summaryRef.set(inconsistent);
  await assert.rejects(service.submit(request(worker,{
   ...data,staffId:worker,counts:{...empty,NURO:4,"SB光・AIR":1},
   expectedVersion:2
  })),e=>e.code==="data-loss");
  assert.deepEqual((await entryRef.get()).data(),entryBefore);
  assert.deepEqual((await summaryRef.get()).data(),inconsistent);
  assert.equal((await nextAuditRef.get()).exists,false);
  assert.deepEqual((await history.ref.get()).data(),history.data());
  await summaryRef.set(summaryBefore); // Restore this synthetic fixture only.

  // The same isolated real database also exercises the guarded hub Owner
  // correction path with an OFF historical SKU. Auth identities here are
  // still fictional; this does not establish production sign-in continuity.
  await Promise.all([
   write("companies/"+hub+"/rankingProductVisibility/shared",{
    hubCompanyId:hub,ownerUid:owner,version:1,
    enabledHubProductIds:["nuro"],partnerOverrides:{}}),
   write("companies/"+hub+"/rankingSkuMappings/shared",{
    hubCompanyId:hub,ownerUid:owner,reviewedByUid:owner,active:true,version:1,
    bindings:[
     {companyId:partner,productId:"partnerSku01",hubProductId:"nuro"},
     {companyId:partner,productId:"partnerSku05",hubProductId:"legacyLightAir"}]}),
   write("companies/"+hub+"/rankingCountPublicCatalog/shared",{
    schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:hub,
    ownerUid:owner,version:1,products:[
     {id:"nuro",companyId:hub,name:"NURO",active:true},
     {id:"legacyLightAir",companyId:hub,
      name:"SB光・AIR（旧合算・未分類）",active:true}]})
  ]);
  const ownerService=makeWorkspace({db,getAuth,FieldValue,Timestamp,
   HttpsError,enabled:()=>true,submissionPublicationEnabled:()=>true,
   ownerCorrectionEnabled:()=>true,now:()=>now});
  const preview=await ownerService.view(request(owner,{
   date,partnerCompanyId:partner,includeOwnerCorrectionEntries:true
  }));
  assert.deepEqual(preview.ownerCorrectionEntries.enabledCategories,["NURO"]);
  assert.equal(preview.ownerCorrectionEntries.records[0].counts["SB光・AIR"],0);
  const ownerCorrection=await ownerService.submit(request(owner,{
   date,staffId:worker,ownerPartnerCompanyId:partner,
   counts:{...empty,NURO:5},expectedVersion:2
  }));
  assert.equal(ownerCorrection.saved,true);
  assert.equal(ownerCorrection.version,3);
  assert.equal(Object.hasOwn(ownerCorrection,"privateTotalCount"),false);
  const ownerSaved=(await entryRef.get()).data();
  assert.equal(ownerSaved.counts.NURO,5);
  assert.equal(ownerSaved.counts["SB光・AIR"],1);
  assert.equal(ownerSaved.totalCount,6);
  assert.equal(ownerSaved.updatedByUid,owner);
  assert.equal(ownerSaved.teamIdSnapshot,entryBefore.teamIdSnapshot);
  const ownerAudit=(await nextAuditRef.get()).data();
  assert.equal(ownerAudit.previousCounts.NURO,3);
  assert.equal(ownerAudit.previousCounts["SB光・AIR"],1);
  assert.equal(ownerAudit.updatedByUid,owner);
  assert.equal((await summaryRef.get()).data().totalCount,6);
  assert.deepEqual((await history.ref.get()).data(),history.data());
  const originalRecords=await db.doc("records/counts-integration-original").get();
  assert.equal(originalRecords.data().totalRevenue,before.records.totalRevenue);
  for(const name of COLLECTIONS){
   const actual=(await db.doc(name+"/counts-integration-original").get()).data();
   assert.deepEqual(actual,before[name],name+" money source changed");
   await assertFails(getDoc(doc(partnerBrowser,
    name+"/counts-integration-original")));
  }
 }finally{
  await env.cleanup();
  await deleteApp(app);
 }
});
