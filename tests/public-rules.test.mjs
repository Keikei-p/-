import test,{before,after} from "node:test";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,getDoc,setDoc,getDocs,collection,query,where} from "firebase/firestore";

let env;
const company="company-a",other="company-b";
const good={
 companyId:company,sourceId:"r1",uid:"partner",date:"2026-10-27",
 teamId:"t1",totalCount:5,reportStatus:"submitted",
 memberNameSnapshot:"担当者",teamNameSnapshot:"1班",workLocation:"現場A"
};
function context(uid,companyId){
 return env.authenticatedContext(uid,{email:uid+"@example.test",email_verified:true}).firestore();
}
before(async()=>{
 const rules=readFileSync(new URL("../security/firestore.phase1.rules",import.meta.url),"utf8");
 env=await initializeTestEnvironment({projectId:"demo-sales-public-boundary",firestore:{rules}});
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  for(const [cid,uid] of [[company,"partner"],[other,"outsider"]]){
   await setDoc(doc(db,"companies",cid),{name:"test",ownerUid:"owner-"+cid,masterUid:"owner-"+cid,active:true});
   await setDoc(doc(db,"users",uid),{companyId:cid,active:true,role:"leader",companyRole:"member",canViewRevenue:false});
   await setDoc(doc(db,"companies",cid,"members",uid),{uid,companyId:cid,role:"leader",companyRole:"member",active:true,canViewRevenue:false});
  }
  await setDoc(doc(db,"publicRecords","r1"),good);
  await setDoc(doc(db,"publicRecords","leak"),{...good,sourceId:"leak",revenuePerUnit:10000});
  await setDoc(doc(db,"publicRecordLines","line1"),{
   companyId:company,recordId:"r1",sourceId:"line1",uid:"partner",date:"2026-10-27",teamId:"t1",productId:"p1",count:5
  });
  await setDoc(doc(db,"publicProducts","p1"),{companyId:company,sourceId:"p1",name:"光回線",active:true,sortOrder:0});
  await setDoc(doc(db,"publicRankEntries","entry1"),{companyId:company,period:"2026-10",kind:"member",sourceId:"partner",displayName:"担当者",rank:1});
  // Explicit legacy-data test fixture. The existing rules still expose
  // revenue-bearing records within a company: cannot ship phase1 alone.
  await setDoc(doc(db,"records","legacy"),{
   ...good,results:{p1:{count:5,revenuePerUnit:10000}},totalRevenue:50000,createdAt:new Date(),updatedAt:new Date()
  });
 });
});
after(async()=>{if(env)await env.cleanup();});
test("same-company partner can get sanitized record and line",async()=>{
 const db=context("partner",company);
 await assertSucceeds(getDoc(doc(db,"publicRecords","r1")));
 await assertSucceeds(getDoc(doc(db,"publicRecordLines","line1")));
 await assertSucceeds(getDoc(doc(db,"publicProducts","p1")));
 await assertSucceeds(getDoc(doc(db,"publicRankEntries","entry1")));
});
test("different-company member cannot read protected public data",async()=>{
 const db=context("outsider",other);
 await assertFails(getDoc(doc(db,"publicRecords","r1")));
 await assertFails(getDoc(doc(db,"publicRecordLines","line1")));
});
test("extra money field fails the flattened read allowlist",async()=>{
 const db=context("partner",company);
 await assertFails(getDoc(doc(db,"publicRecords","leak")));
});
test("no member can create or update projections from an app client",async()=>{
 const db=context("partner",company);
 await assertFails(setDoc(doc(db,"publicProducts","fake"),{companyId:company,sourceId:"fake",name:"x",active:true,sortOrder:0}));
 await assertFails(setDoc(doc(db,"publicRecords","r1"),{...good,totalCount:100}));
});
test("collection list remains explicitly disabled until safe backend pagination",async()=>{
 const db=context("partner",company);
 await assertFails(getDocs(query(collection(db,"publicRecords"),where("companyId","==",company))));
});
test("known blocker: existing raw financial records still readable by partner",async()=>{
 const db=context("partner",company);
 const docRef=doc(db,"records","legacy");
 const snap=await assertSucceeds(getDoc(docRef));
 if(!snap.exists()||snap.data().totalRevenue!==50000)throw Error("Legacy exposure no longer matches known policy; revisit cutover plan");
});
