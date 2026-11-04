"use strict";
// Real Firebase Auth + Firestore SDKs, localhost emulators ONLY.
// Requires firebase emulators:exec --only auth,firestore.
const {test,after}=require("node:test");
const assert=require("node:assert/strict");
const {randomBytes}=require("node:crypto");
const {initializeApp,deleteApp}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {makeAccountErasure}=require("./service.cjs");
const project="demo-sales-account-erasure";
if(process.env.GCLOUD_PROJECT!==project&&process.env.FIREBASE_PROJECT_ID!==project)
 throw Error("STOP_WRONG_FIREBASE_PROJECT");
if(!process.env.FIREBASE_AUTH_EMULATOR_HOST||
   !process.env.FIRESTORE_EMULATOR_HOST||
   process.env.GOOGLE_APPLICATION_CREDENTIALS||
   process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
 throw Error("STOP_EMULATOR_ONLY_MISSING");
if(/sales-management-cc116|nico-factory|googleapis\.com/i.test(
 process.env.FIREBASE_AUTH_EMULATOR_HOST+" "+process.env.FIRESTORE_EMULATOR_HOST))
 throw Error("STOP_PRODUCTION_ENDPOINT");
class CallError extends Error{constructor(code,message){super(message);this.code=code;}}
const app=initializeApp({projectId:project},"erasure-real-emulator");
const auth=getAuth(app),db=getFirestore(app);
const uid=(tag)=>tag+"_"+randomBytes(5).toString("hex");
const origin=()=>"http://"+process.env.FIREBASE_AUTH_EMULATOR_HOST;
async function createUser(u,mail){
 await auth.createUser({uid:u,email:mail,emailVerified:true,password:"LocalPass_2026!x"});
}
async function token(mail){
 const r=await fetch(origin()+"/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo",{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({email:mail,password:"LocalPass_2026!x",returnSecureToken:true})
 });
 const data=await r.json();
 if(!r.ok||!data.idToken)throw Error("emulator_sign_in_failed_"+r.status);
 return data.idToken;
}
function request(u,mail,jwt,data){
 return {auth:{uid:u,token:{email:mail,email_verified:true}},
  rawRequest:{headers:{authorization:"Bearer "+jwt}},data};
}
const service=makeAccountErasure({
 db,getAuth:()=>auth,FieldValue,HttpsError:CallError,enabled:()=>true
});
const records=new Set(),accounts=new Set();
after(async()=>{
 for(const path of records){try{await db.doc(path).delete();}catch{}}
 for(const u of accounts){try{await auth.deleteUser(u);}catch{}}
 await deleteApp(app);
});
async function seedHub(){
 const owner=uid("owner"),person=uid("person"),hub=uid("hub");
 const ownerMail=owner+"@example.test",personMail=person+"@example.test";
 for(const [u,e] of [[owner,ownerMail],[person,personMail]]){
  await createUser(u,e);accounts.add(u);
 }
 const ref=async(path,data)=>{await db.doc(path).set(data);records.add(path);};
 await ref("companies/"+hub,{companyKind:"internal",active:true,ownerUid:owner});
 const leader={uid:owner,companyId:hub,companyRole:"owner",role:"leader",
  name:"検証オーナー",email:ownerMail,active:true,accessKind:"internal"};
 await ref("users/"+owner,leader);
 await ref("companies/"+hub+"/members/"+owner,leader);
 const m={uid:person,companyId:hub,companyRole:"member",role:"member",
  name:"検証担当者",email:personMail,teamId:"legacyTeam",active:true,
  accessKind:"internal",teamHistory:[{effectiveDate:"2026-10-01",
   fromTeamId:"oldTeam",toTeamId:"legacyTeam"}]};
 await ref("users/"+person,m);
 await ref("companies/"+hub+"/members/"+person,m);
 const saved=[
  ["products/"+uid("price"),{companyId:hub,unitPrice:9000}],
  ["records/"+uid("oldrecord"),{companyId:hub,uid:person,teamIdSnapshot:"oldTeam",
   results:{NURO:{count:7,revenuePerUnit:9000}},totalRevenue:63000}],
  ["recordCorrections/"+uid("fix"),{uid:person,oldCount:6,newCount:7}]
 ];
 for(const [path,data] of saved)await ref(path,data);
 const before=await Promise.all(saved.map(async([path])=>(await db.doc(path).get()).data()));
 const jwt=await token(ownerMail);
 return{owner,person,hub,jwt,ownerMail,saved,before};
}
async function assertHistorical(d){
 for(let i=0;i<d.saved.length;i++){
  const actual=(await db.doc(d.saved[i][0]).get()).data();
  assert.deepEqual(actual,d.before[i],"real Firestore historical originals must not change");
 }
}
test("real Firestore transaction + Auth deletion retains immutable old revenue and past team",async()=>{
 const d=await seedHub(),r=data=>request(d.owner,d.ownerMail,d.jwt,data);
 assert.equal((await service.preview(r({action:"preview",targetUid:d.person}))).ready,true);
 const out=await service.confirm(r({action:"confirm",targetUid:d.person,
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"検証担当者"}));
 assert.equal(out.complete,true);
 await assert.rejects(auth.getUser(d.person),e=>e.code==="auth/user-not-found");
 assert.equal((await db.doc("users/"+d.person).get()).exists,false);
 assert.equal((await db.doc("companies/"+d.hub+"/members/"+d.person).get()).exists,false);
 await assertHistorical(d);
 const receipt=(await db.collection("accountErasureJobs")
  .where("requestedByUid","==",d.owner).get()).docs[0];
 assert.equal(receipt.data().status,"complete");
 assert.equal(receipt.data().targetUid,undefined);
 assert.equal(receipt.data().targetName,undefined);
 assert.equal(receipt.data().targetAuthHash,undefined);
 records.add(receipt.ref.path);
});
test("real Auth delete failure leaves job recoverable, then deletes exactly original Auth UID",async()=>{
 const d=await seedHub(),r=data=>request(d.owner,d.ownerMail,d.jwt,data);
 let failDelete=true;
 const controlled={
  getUser:u=>auth.getUser(u),
  verifyIdToken:(jwt,revoke)=>auth.verifyIdToken(jwt,revoke),
  updateUser:(u,opts)=>auth.updateUser(u,opts),
  deleteUser:u=>failDelete?Promise.reject(new Error("simulated-local-auth-error")):auth.deleteUser(u)
 };
 const svc=makeAccountErasure({db,getAuth:()=>controlled,FieldValue,HttpsError:CallError,enabled:()=>true});
 await assert.rejects(svc.confirm(r({action:"confirm",targetUid:d.person,
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"検証担当者"})),e=>e.code==="unavailable");
 assert.equal((await auth.getUser(d.person)).disabled,true);
 const found=await svc.listPending(r({action:"listPending"}));
 assert.deepEqual(found.pending,[{targetUid:d.person,targetName:"検証担当者"}]);
 const receipt=(await db.collection("accountErasureJobs")
  .where("requestedByUid","==",d.owner).get()).docs[0];
 records.add(receipt.ref.path);
 assert.equal(receipt.data().status,"pending");
 failDelete=false;
 const resumed=await svc.confirm(r({action:"confirm",targetUid:d.person,
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"検証担当者"}));
 assert.equal(resumed.complete,true);
 assert.equal((await db.doc(receipt.ref.path).get()).data().status,"complete");
 await assert.rejects(auth.getUser(d.person),e=>e.code==="auth/user-not-found");
 await assertHistorical(d);
});
test("real Firebase SDK guards newly recreated UID during pending deletion",async()=>{
 const d=await seedHub(),r=data=>request(d.owner,d.ownerMail,d.jwt,data);
 let stop=true,attempted=0;
 const controlled={
  getUser:u=>auth.getUser(u),
  verifyIdToken:(jwt,revoke)=>auth.verifyIdToken(jwt,revoke),
  updateUser:(u,opts)=>auth.updateUser(u,opts),
  deleteUser:u=>{attempted++;return stop?Promise.reject(new Error("simulated-failure")):auth.deleteUser(u);}
 };
 const svc=makeAccountErasure({db,getAuth:()=>controlled,FieldValue,HttpsError:CallError,enabled:()=>true});
 await assert.rejects(svc.confirm(r({action:"confirm",targetUid:d.person,
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"検証担当者"})),e=>e.code==="unavailable");
 const receipt=(await db.collection("accountErasureJobs")
  .where("requestedByUid","==",d.owner).get()).docs[0];
 records.add(receipt.ref.path);
 await auth.deleteUser(d.person);
 await auth.createUser({uid:d.person,email:d.person+"@example.test",
  emailVerified:true,password:"LocalPass_2026!x"});
 stop=false;
 const before=attempted;
 await assert.rejects(svc.confirm(r({action:"confirm",targetUid:d.person,
  confirmation:"DELETE_ACCOUNT_ONLY",confirmName:"検証担当者"})),
  e=>e.code==="failed-precondition");
 assert.equal(attempted,before);
 assert.equal((await auth.getUser(d.person)).disabled,false);
 await assertHistorical(d);
});
