import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {proposeSecondaryFinanceFence,originalRules,COLLECTIONS} from
 "../security/secondary-finance-read-fence.mjs";
const current=originalRules(),candidate=proposeSecondaryFinanceFence();

test("future candidate narrows financial reads and writes only; production sources are untouched",()=>{
 assert.equal(COLLECTIONS.length,4);
 assert.equal(readFileSync(new URL("../firebase.json",import.meta.url),"utf8")
  .includes('"rules": "firestore.rules"'),true);
 assert.notEqual(candidate,current);
 assert.equal(candidate.split("activeSecondaryPartnerContext()").length-1,13);
 for(const collection of COLLECTIONS){
  const begin=candidate.indexOf("    match /"+collection+"/");
  const n=candidate.indexOf("\n    match /",begin+1);
  const body=candidate.slice(begin,n<0?undefined:n);
  assert.match(body,/!activeSecondaryPartnerContext\\(\\)/);
  const writeOps=collection==="recordCorrections"?["create"]:["create","update"];
  for(const op of writeOps){
   assert.match(body,new RegExp("allow "+op+": if !activeSecondaryPartnerContext\\(\\)"),
    collection+" "+op+" must reject dual financial browser write");
  }
  if(collection==="records")
   assert.match(body,/allow get: if !activeSecondaryPartnerContext\\(\\)/);
 }
 for(const rule of ["allow create:","allow update:","allow delete:"]){
  assert.equal(candidate.split(rule).length,current.split(rule).length);
 }
 assert.match(candidate,/get\(ref\).data.get\('active', true\) != false/);
 assert.doesNotMatch(candidate,/get\(ref\).data.get\('kind'/);
 assert.throws(()=>proposeSecondaryFinanceFence(current+" "),/BASE_RULES_CHANGED/);
 assert.doesNotMatch(candidate,/firebase deploy|FIREBASE_SERVICE_ACCOUNT_JSON/);
});
test("the source is never registered as live Firebase Rules or callable",()=>{
 const manifest=JSON.parse(readFileSync(new URL("../firebase.json",import.meta.url),"utf8"));
 assert.equal(manifest.firestore.rules,"firestore.rules");
 assert.ok(!readFileSync(new URL("../.github/workflows/firebase-production-deploy.yml",
  import.meta.url),"utf8").includes("secondary-finance-read-fence"));
});
test("real Rules emulator denies active partner-secondary raw GET and LIST but preserves all Originals",{
 skip:!process.env.FIRESTORE_EMULATOR_HOST
},async()=>{
 const {initializeTestEnvironment,assertSucceeds,assertFails}=
  await import("@firebase/rules-unit-testing");
 const {doc,setDoc,getDoc,collection,query,where,getDocsFromServer,serverTimestamp}=
  await import("firebase/firestore");
 const env=await initializeTestEnvironment({
  projectId:"demo-nico-secondary-finance-fence",firestore:{rules:candidate}
 });
 const hub="hub",partner="partner";
 const moneyDocs=Object.fromEntries(COLLECTIONS.map((name,i)=>[name,{
  companyId:hub,teamId:"t1",unitPrice:40000+i,totalRevenue:120000+i,
  cashback:20000+i,sourceMarker:"unchanged-"+i,
  ...(name==="records"?{uid:"dual",date:"2026-11-01",
   results:{p:{count:1,revenuePerUnit:40000}},totalCount:1}:{}),
  ...(name==="recordCorrections"?{before:{totalRevenue:100000},after:{totalRevenue:120000}}:{}),
  ...(name==="revenueGoals"?{targetRevenue:500000,month:"2026-11"}:{})
 }]));
 const actor=id=>env.authenticatedContext(id,{
  email:id+"@example.test",email_verified:true
 }).firestore();
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await setDoc(doc(db,"companies",hub),{companyKind:"internal",
    active:true,ownerUid:"owner",masterUid:"owner"});
   await setDoc(doc(db,"companies",partner),{companyKind:"partner",
    active:true,hubCompanyId:hub,ownerUid:"otherOwner"});
   const users=[
    ["owner","owner",false],["ordinary","member",false],
    ["dual","member",true],["malformed","member",true],
    ["internalKind","member",true],["stringFlag","member",true],
    ["missingFlag","member",true],["inactive","member",true]
   ];
   for(const [id,role] of users){
    const profile={uid:id,companyId:hub,companyRole:role,
     role:role==="owner"?"leader":"member",active:true,accessKind:"internal",
     memberType:"direct",teamId:"t1",canViewRevenue:role!=="owner",
     canViewUnitPrice:role!=="owner"};
    await setDoc(doc(db,"users",id),profile);
    await setDoc(doc(db,"companies",hub,"members",id),profile);
   }
   await setDoc(doc(db,"partnerWorkspaceContexts","dual"),{
    uid:"dual",kind:"partner_secondary",active:true,
    hubCompanyId:hub,primaryCompanyId:hub,partnerCompanyId:partner
   });
   await setDoc(doc(db,"partnerWorkspaceContexts","malformed"),{
    uid:"malformed",kind:"unexpected",active:true,primaryCompanyId:hub
   });
   await setDoc(doc(db,"partnerWorkspaceContexts","internalKind"),{
    uid:"internalKind",kind:"internal",active:true,primaryCompanyId:hub
   });
   await setDoc(doc(db,"partnerWorkspaceContexts","stringFlag"),{
    uid:"stringFlag",kind:"partner_secondary",active:"false",primaryCompanyId:hub
   });
   await setDoc(doc(db,"partnerWorkspaceContexts","missingFlag"),{
    uid:"missingFlag",kind:"partner_secondary",primaryCompanyId:hub
   });
   await setDoc(doc(db,"partnerWorkspaceContexts","inactive"),{
    uid:"inactive",kind:"partner_secondary",active:false,primaryCompanyId:hub
   });
   await setDoc(doc(db,"teams","team1"),{companyId:hub,name:"1班",active:true});
   for(const [name,row] of Object.entries(moneyDocs))
    await setDoc(doc(db,name,"original"),row);
  });
  for(const name of COLLECTIONS){
   await assertSucceeds(getDoc(doc(actor("owner"),name,"original")));
   await assertSucceeds(getDoc(doc(actor("ordinary"),name,"original")));
   // revenueGoals is intentionally team-scoped for non-Owners. Require
   // the existing approved team filter; never relax production Rules.
   const filters=name==="revenueGoals"?
    [where("companyId","==",hub),where("teamId","==","t1")]:
    [where("companyId","==",hub)];
   await assertSucceeds(getDocsFromServer(query(
    collection(actor("ordinary"),name),...filters
   )));
   await assertSucceeds(getDoc(doc(actor("inactive"),name,"original")));
   await assertSucceeds(getDocsFromServer(query(
    collection(actor("inactive"),name),...filters
   )));
   for(const uid of ["dual","malformed","internalKind","stringFlag","missingFlag"]){
    await assertFails(getDoc(doc(actor(uid),name,"original")));
    await assertFails(getDocsFromServer(query(
     collection(actor(uid),name),...filters
    )));
   }
  }
  // Verified unrelated counts-supporting team reads remain possible.
  await assertSucceeds(getDoc(doc(actor("dual"),"teams","team1")));
  // A secondary user must not create a money-bearing raw record either.
  // Preserve the old internal member's legitimate write path (same fixture).
  // This is NOT a live test of the partner's separate Callable count save.
  const recordData=user=>({
     companyId:hub,uid:user,memberNameSnapshot:"Member",
     teamId:null,teamNameSnapshot:"",date:"2026-11-07",
     results:{},totalCount:0,totalRevenue:0,
     createdByUid:user,updatedByUid:user,
     createdAt:serverTimestamp(),updatedAt:serverTimestamp()
   });
  await assertFails(setDoc(doc(actor("dual"),"records",
    "hub_dual_2026-11-07"),recordData("dual")));
  await assertFails(getDoc(doc(actor("dual"),"records",
    "hub_dual_2026-11-07")));
  await assertSucceeds(setDoc(doc(actor("ordinary"),"records",
    "hub_ordinary_2026-11-07"),recordData("ordinary")));
  const ordinaryRow=await assertSucceeds(getDoc(doc(actor("ordinary"),"records",
    "hub_ordinary_2026-11-07")));
  assert.equal(ordinaryRow.data().totalCount,0);
  let originals={};
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   for(const name of COLLECTIONS)
    originals[name]=(await getDoc(doc(db,name,"original"))).data();
  });
  assert.deepEqual(originals,moneyDocs);
 }finally{await env.cleanup();}
});
