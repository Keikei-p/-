"use strict";
/**
 * Current EXACT production firestore.rules, tested against ONLY synthetic
 * emulator data. Verifies GET and LIST, not just GET, under fake accounts
 * corresponding to owner, partner owner, partner leader and a moved user.
 * DOES NOT prove the deployed Ruleset is identical or that real accounts
 * have correct classification. The separate metadata GET audit checks that.
 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {initializeTestEnvironment,assertSucceeds,assertFails}=
 require("@firebase/rules-unit-testing");
const {doc,setDoc,getDoc,collection,query,where,getDocsFromServer}=
 require("firebase/firestore");

if(!process.env.FIRESTORE_EMULATOR_HOST||
   !/^(?:localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST))
 throw Error("REFUSE_PRODUCTION_FIRESTORE_CONNECTION");
const projectId="demo-nico-live-finance-priv",hub="hub",partner="partner";
const types=["products","records","recordCorrections","revenueGoals"];
const records=["prod","record","correction","goal"];
let env;
const dbFor=uid=>env.authenticatedContext(uid,{
 email:uid+"@example.test",email_verified:true
}).firestore();
const financePath=(cid,type)=>doc(dbFor("owner"),type,cid+"-"+records[types.indexOf(type)]);
const row=(cid,type)=>({companyId:cid,teamId:"teamA",
 totalCount:4,totalRevenue:400000,unitPrice:100000,
 [type==="revenueGoals"?"targetRevenue":"cashback"]:50000});
const seed=async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,"companies",hub),{
   name:"NICO",active:true,companyKind:"internal",
   ownerUid:"owner",masterUid:"owner"
  });
  await setDoc(doc(db,"companies",partner),{
   name:"合作企業",active:true,companyKind:"partner",
   hubCompanyId:hub,ownerUid:"partnerOwner",masterUid:"partnerOwner"
  });
  const actors=[
   ["owner",hub,"owner","internal","internal"],
   ["partnerOwner",partner,"owner","partner","cooperator"],
   ["partnerLeader",partner,"member","partner","cooperator"],
   ["moved",partner,"owner","partner","cooperator"],
   ["leakyUser",hub,"owner","partner","cooperator"],
   ["leakyMember",hub,"owner","internal","internal"],
   ["leakyType",hub,"owner","internal","internal"]
  ];
  for(const [uid,companyId,companyRole,accessKind,memberType] of actors){
   const member={
    uid,companyId,active:true,role:"leader",companyRole,
    accessKind,memberType,teamId:"teamA",
    canViewRevenue:true,canViewUnitPrice:true
   };
   const user={...member};
   if(uid==="leakyMember")member.accessKind="partner";
   if(uid==="leakyType")member.memberType="cooperator";
   await setDoc(doc(db,"users",uid),user);
   await setDoc(doc(db,"companies",companyId,"members",uid),member);
  }
  // Same-email company switch must not leave access to the old Hub's
  // money even when a legacy internal membership document remains.
  await setDoc(doc(db,"companies",hub,"members","moved"),{
   uid:"moved",companyId:hub,active:true,role:"leader",
   companyRole:"owner",accessKind:"internal",memberType:"internal",
   canViewRevenue:true,canViewUnitPrice:true
  });
  for(const cid of [hub,partner])
   for(const type of types)
    await setDoc(doc(db,type,cid+"-"+records[types.indexOf(type)]),row(cid,type));
 });
};
test.before(async()=>{
 env=await initializeTestEnvironment({
  projectId,firestore:{rules:fs.readFileSync(
   path.join(__dirname,"../firestore.rules"),"utf8")}
 });
 await seed();
});
test.after(async()=>{await env?.cleanup()});
test("six partner/cooperator/ambiguous principals cannot GET or query LIST any money across both companies",async()=>{
 for(const uid of [
  "partnerOwner","partnerLeader","moved","leakyUser",
  "leakyMember","leakyType"
 ]){
  const db=dbFor(uid);
  for(const cid of [hub,partner])for(const type of types){
   await assertFails(getDoc(doc(db,type,cid+"-"+records[types.indexOf(type)])));
   // A scoped LIST must be denied even if attacker knows companyId exactly.
   await assertFails(getDocsFromServer(
    query(collection(db,type),where("companyId","==",cid))
   ));
  }
 }
});
test("unscoped LIST and browser partner private count collections remain denied",async()=>{
 for(const uid of ["partnerOwner","partnerLeader","moved","leakyUser"]){
  const db=dbFor(uid);
  for(const type of types){
   await assertFails(getDocsFromServer(collection(db,type)));
  }
  await assertFails(getDocsFromServer(
   collection(db,"companies",partner,"partnerWorkEntries")
  ));
  await assertFails(getDocsFromServer(
   collection(db,"companies",partner,"partnerPrivateProducts")
  ));
 }
});
test("actual internally classified company owner still GETs and queries LIST its own saved financial data",async()=>{
 const db=dbFor("owner");
 for(const type of types){
  const docId=hub+"-"+records[types.indexOf(type)];
  const data=(await assertSucceeds(getDoc(doc(db,type,docId)))).data();
  assert.equal(data.companyId,hub);
  assert.equal(data.unitPrice,100000);
  const found=await assertSucceeds(getDocsFromServer(
   query(collection(db,type),where("companyId","==",hub))
  ));
  assert.equal(found.docs.length,1,type);
  await assertFails(getDoc(doc(db,type,partner+"-"+records[types.indexOf(type)])));
 }
});
test("test uses current production source and does not write or deploy any real data",()=>{
 const rules=fs.readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");
 assert.match(rules,/get\('companyKind', 'internal'\) == 'internal'/);
 assert.match(rules,/get\('accessKind', 'internal'\) == 'internal'/);
 assert.match(rules,/in \['internal', 'direct', 'member', 'managed'\]/);
 assert.doesNotMatch(__filename,/cloud\.googleapis\.com/);
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST!==undefined,true);
});
