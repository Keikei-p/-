"use strict";
/**
 * EMULATOR ONLY / NO DEPLOY / NO PRODUCTION WRITES
 *
 * Real production risk: a user in a secondary partner workspace can still be
 * an active primary internal company member. Current Rules correctly trust
 * the active internal identity (including money-bearing raw collections),
 * regardless of that same user's PARTNER secondary workspace.
 *
 * This is a documented RELEASE BLOCKER, never a claim that it is already fixed.
 * Simulate a future explicit, approved transition with the archive retained,
 * then prove old finance documents survive and old financial access is denied.
 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {
 initializeTestEnvironment,assertSucceeds,assertFails
}=require("@firebase/rules-unit-testing");
const {
 doc,setDoc,getDoc,query,collection,where,getDocsFromServer
}=require("firebase/firestore");

if(!/^(?:localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||""))
 throw Error("REFUSE_ANY_NON_EMULATOR_DATABASE");
if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!=="demo-nico-secondary-handoff")
 throw Error("REFUSE_UNEXPECTED_PROJECT");
const SOURCE=fs.readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
const blob=Buffer.from(SOURCE,"utf8");
const sha=crypto.createHash("sha1")
 .update(Buffer.from("blob "+blob.length+"\0")).update(blob).digest("hex");
assert.equal(sha,"d9f4df6a2ac0f8b5720534a2461ec66b94379190");

const hub="hub",partner="partner",uid="secondary",owner="hubOwner";
const tables=["products","records","recordCorrections","revenueGoals"];
const idFor=table=>hub+"-"+table;
const sourceDocs=Object.fromEntries(tables.map((table,i)=>[table,{
 companyId:hub,teamId:"teamA",sourceMarker:"untouched-old-finance-"+i,
 totalCount:3,totalRevenue:45000+i,unitPrice:15000+i,cashback:6000+i,
 ...(table==="revenueGoals"?{targetRevenue:100000}:{}),
 ...(table==="recordCorrections"?{before:{totalRevenue:30000},
  after:{totalRevenue:45000}}:{})
}]));
let env;
const authDb=user=>env.authenticatedContext(user,{
 email:user+"@example.test",email_verified:true
}).firestore();
const readOriginals=async()=>env.withSecurityRulesDisabled(async ctx=>{
 const db=ctx.firestore(),original={};
 for(const table of tables)
  original[table]=(await getDoc(doc(db,table,idFor(table)))).data();
 return original;
});
test.before(async()=>{
 env=await initializeTestEnvironment({
  projectId:"demo-nico-secondary-handoff",firestore:{rules:SOURCE}
 });
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,"companies",hub),{
   companyKind:"internal",active:true,ownerUid:owner,masterUid:owner
  });
  await setDoc(doc(db,"companies",partner),{
   companyKind:"partner",active:true,hubCompanyId:hub,
   ownerUid:"partnerOwner",masterUid:"partnerOwner"
  });
  await setDoc(doc(db,"users",owner),{
   uid:owner,companyId:hub,companyRole:"owner",role:"leader",
   active:true,accessKind:"internal",memberType:"direct",teamId:"teamA"
  });
  await setDoc(doc(db,"companies",hub,"members",owner),{
   uid:owner,companyId:hub,companyRole:"owner",role:"leader",
   active:true,accessKind:"internal",memberType:"direct",teamId:"teamA",
   canViewRevenue:true,canViewUnitPrice:true
  });
  await setDoc(doc(db,"users",uid),{
   uid,companyId:hub,companyRole:"member",role:"member",
   active:true,accessKind:"internal",memberType:"direct",teamId:"teamA",
   canViewRevenue:false,canViewUnitPrice:false
  });
  await setDoc(doc(db,"companies",hub,"members",uid),{
   uid,companyId:hub,companyRole:"member",role:"member",
   active:true,accessKind:"internal",memberType:"direct",teamId:"teamA",
   canViewRevenue:false,canViewUnitPrice:false
  });
  await setDoc(doc(db,"companies",partner,"members",uid),{
   uid,companyId:partner,companyRole:"member",role:"member",
   active:true,accessKind:"partner",memberType:"cooperator",teamId:"partnerTeam",
   canViewRevenue:false,canViewUnitPrice:false
  });
  await setDoc(doc(db,"partnerWorkspaceContexts",uid),{
   uid,kind:"partner_secondary",active:true,
   primaryCompanyId:hub,partnerCompanyId:partner,
   hubCompanyId:hub,role:"member",teamId:"partnerTeam",
   emailLower:uid+"@example.test"
  });
  await setDoc(doc(db,"partnerRelations",partner),{
   hubCompanyId:hub,partnerCompanyId:partner,active:true,
   countSharingApproved:true
  });
  for(const table of tables)
   await setDoc(doc(db,table,idFor(table)),sourceDocs[table]);
 });
});
test.after(async()=>{await env?.cleanup()});

test("known LIVE blocker: secondary partner identity still reads old internal finance despite both flags false",async()=>{
 const db=authDb(uid);
 for(const table of ["products","records","recordCorrections"]){
  const row=(await assertSucceeds(getDoc(doc(db,table,idFor(table))))).data();
  assert.equal(row.sourceMarker,sourceDocs[table].sourceMarker);
  await assertSucceeds(getDocsFromServer(
   query(collection(db,table),where("companyId","==",hub))
  ));
 }
 // Revenue goals have an additional grant, so this narrower denial does NOT
 // compensate for the three raw finance collection exposures.
 await assertFails(getDoc(doc(db,"revenueGoals",idFor("revenueGoals"))));
});

test("staged approved primary transition preserves all old originals but denies old GET and LIST",async()=>{
 const originals=await readOriginals();
 // This is a synthetic representation of a future approved SERVER-SIDE
 // transaction, not a migration implementation or live-user update.
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  const oldProfile=(await getDoc(doc(db,"users",uid))).data();
  const oldMember=(await getDoc(doc(db,"companies",hub,"members",uid))).data();
  await setDoc(doc(db,"partnerHistoricalTransfers",uid),{
   uid,sourceCompanyId:hub,destinationCompanyId:partner,
   originalUser:oldProfile,originalMember:oldMember,
   archivalPurpose:"synthetic-only-never-deploy"
  });
  await setDoc(doc(db,"users",uid),{
   uid,companyId:partner,companyRole:"member",role:"member",
   active:true,accessKind:"partner",memberType:"cooperator",teamId:"partnerTeam",
   canViewRevenue:false,canViewUnitPrice:false
  });
  await setDoc(doc(db,"companies",hub,"members",uid),{active:false},{merge:true});
  await setDoc(doc(db,"partnerWorkspaceContexts",uid),{active:false},{merge:true});
 });
 assert.deepEqual(await readOriginals(),originals,
  "Even the emulator-only hypothetical transfer must preserve all four original documents");
 const db=authDb(uid);
 for(const table of tables){
  await assertFails(getDoc(doc(db,table,idFor(table))));
  await assertFails(getDocsFromServer(
   query(collection(db,table),where("companyId","==",hub))
  ));
 }
 await assertFails(getDoc(doc(db,"partnerHistoricalTransfers",uid)));
 const retained=await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  return {
   archive:(await getDoc(doc(db,"partnerHistoricalTransfers",uid))).data(),
   oldMember:(await getDoc(doc(db,"companies",hub,"members",uid))).data(),
   partnerMember:(await getDoc(doc(db,"companies",partner,"members",uid))).data()
  };
 });
 assert.deepEqual(retained.archive.originalUser.companyId,hub);
 assert.equal(retained.archive.originalMember.active,true);
 assert.equal(retained.oldMember.active,false);
 assert.equal(retained.partnerMember.active,true);
});

test("separate internal Owner still reads historical finance after hypothetical transfer",async()=>{
 const db=authDb(owner);
 for(const table of tables){
  const row=(await assertSucceeds(getDoc(doc(db,table,idFor(table))))).data();
  assert.equal(row.sourceMarker,sourceDocs[table].sourceMarker);
  if(table==="revenueGoals"){
   await assertSucceeds(getDocsFromServer(query(collection(db,table),
    where("companyId","==",hub),where("teamId","==","teamA"))));
  }else{
   await assertSucceeds(getDocsFromServer(query(collection(db,table),
    where("companyId","==",hub))));
  }
 }
});

test("this suite proves only LOCAL synthetic behavior, never authorizes a live transfer",()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST!==undefined,true);
 assert.equal(sha,"d9f4df6a2ac0f8b5720534a2461ec66b94379190");
 assert.equal(SOURCE.includes("partnerWorkspaceContexts"),false,
  "Current original rules do not check the partner secondary context");
 assert.equal(SOURCE.includes("sameCompany(resource.data.companyId)"),true);
});
