import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {proposeSecondaryFinanceFence,originalRules,COLLECTIONS} from
 "../security/secondary-finance-read-fence.mjs";
const current=originalRules(),candidate=proposeSecondaryFinanceFence();

test("future rules proposal makes only 4 finance reads restrictive; source/writes are untouched",()=>{
 assert.equal(COLLECTIONS.length,4);
 assert.equal(readFileSync(new URL("../firebase.json",import.meta.url),"utf8")
  .includes('"rules": "firestore.rules"'),true);
 assert.notEqual(candidate,current);
 assert.equal(candidate.split("activeSecondaryPartnerContext()").length-1,5);
 for(const collection of COLLECTIONS){
  const begin=candidate.indexOf("    match /"+collection+"/");
  const n=candidate.indexOf("\n    match /",begin+1);
  const body=candidate.slice(begin,n<0?undefined:n);
  assert.match(body,/!activeSecondaryPartnerContext\(\)/);
 }
 for(const rule of ["allow create:","allow update:","allow delete:"]){
  assert.equal(candidate.split(rule).length,current.split(rule).length);
 }
 assert.match(candidate,/get\(ref\).data.get\('active', true\) == true/);
 assert.match(candidate,/get\(ref\).data.get\('kind', ''\) != 'internal'/);
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
    ["dual","member",true],["malformed","member",true]
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
   await setDoc(doc(db,"teams","team1"),{companyId:hub,name:"1班",active:true});
   for(const [name,row] of Object.entries(moneyDocs))
    await setDoc(doc(db,name,"original"),row);
  });
  for(const name of COLLECTIONS){
   await assertSucceeds(getDoc(doc(actor("owner"),name,"original")));
   await assertSucceeds(getDoc(doc(actor("ordinary"),name,"original")));
   await assertSucceeds(getDocsFromServer(query(
    collection(actor("ordinary"),name),where("companyId","==",hub)
   )));
   for(const uid of ["dual","malformed"]){
    await assertFails(getDoc(doc(actor(uid),name,"original")));
    await assertFails(getDocsFromServer(query(
     collection(actor(uid),name),where("companyId","==",hub)
    )));
   }
  }
  // Verified unrelated counts-supporting team reads remain possible.
  await assertSucceeds(getDoc(doc(actor("dual"),"teams","team1")));
  // A legacy count save may still be permitted at Rules-level, BUT the UI's
  // prefill read on records is denied. Consequently PRODUCTION CUTOVER BLOCKED
  // until an independently tested count-only form replaces raw GET.
  await assertSucceeds(setDoc(doc(actor("dual"),"records",
   "hub_dual_2026-11-07"),{
     companyId:hub,uid:"dual",memberNameSnapshot:"Member",
     teamId:null,teamNameSnapshot:"",date:"2026-11-07",
     results:{},totalCount:0,totalRevenue:0,
     createdByUid:"dual",updatedByUid:"dual",
     createdAt:serverTimestamp(),updatedAt:serverTimestamp()
   }));
  await assertFails(getDoc(doc(actor("dual"),"records",
   "hub_dual_2026-11-07")));
  let originals={};
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   for(const name of COLLECTIONS)
    originals[name]=(await getDoc(doc(db,name,"original"))).data();
  });
  assert.deepEqual(originals,moneyDocs);
 }finally{await env.cleanup();}
});
