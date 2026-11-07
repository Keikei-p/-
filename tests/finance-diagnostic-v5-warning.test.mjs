import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {runInNewContext} from "node:vm";
import {sessionSafeFour} from "../staging/finance-diagnostic-v4/build-session-safe.mjs";
import {financeAlertFour} from "../staging/finance-diagnostic-v5/build-finance-alert.mjs";
const candidate=financeAlertFour(),previous=sessionSafeFour();
const script=candidate.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
const plain=script?.replace(/^import .+?;\s*$/gm,"");
const four=["products","records","recordCorrections","revenueGoals"];
function harness(){
 const elements=new Map(),auth={currentUser:null};
 const el=id=>{
  if(!elements.has(id))elements.set(id,{value:"",textContent:"",
   className:"",disabled:false,hidden:false});
  return elements.get(id);
 };
 let callback;
 const person=uid=>({uid,emailVerified:true,
  getIdToken:async fresh=>{assert.equal(fresh,true);return "token-"+uid}});
 const user=(uid)=>person(uid);
 const owner=user("owner"),internal=user("internal");
 const reply=(status,body)=>({status,json:async()=>body});
 const fetch=async(url,options)=>{
  const uid=auth.currentUser?.uid;
  const company="hub",u=new URL(url),route=u.pathname;
  if(route.endsWith("/users/"+uid))
   return reply(200,{fields:{companyId:{stringValue:company},active:{booleanValue:true}}});
  if(route.endsWith("/companies/"+company))
   return reply(200,{fields:{companyKind:{stringValue:"internal"},
    ownerUid:{stringValue:"owner"}}});
  const name=options.method==="POST"?
   JSON.parse(options.body).structuredQuery?.from?.[0]?.collectionId:
   four.find(t=>route.includes("/"+t+"/"));
  if(!four.includes(name))throw Error("UNEXPECTED_FINANCE_PROBE");
  // Confirm a current non-Owner can read the raw finance document.
  // This MUST be marked warning, not merely "membership pending".
  if(options.method==="POST")
   return reply(200,[{document:{
    name:"projects/sales-management-cc116/databases/(default)/documents/"+
     name+"/"+name+"-existing",
    fields:{companyId:{stringValue:company}}
   }}]);
  return reply(200,{fields:{companyId:{stringValue:company}}});
 };
 const ctx={
  document:{getElementById:el},location:{origin:"https://nico-factory.web.app"},
  URL,Date,Intl,Map,RegExp,Number,JSON,Error,
  initializeApp:()=>({}),browserSessionPersistence:{},initializeAuth:()=>auth,
  getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{}}),
  onAuthStateChanged:(_auth,cb)=>{callback=cb;cb(auth.currentUser);},
  signInWithEmailAndPassword:async()=>({}),
  signOut:async()=>{auth.currentUser=null;callback(null);},
  fetch
 };
 runInNewContext(plain+"\nthis.__diagnostic={render};",ctx,{timeout:2000});
 return {el,owner,internal,login:u=>{auth.currentUser=u;callback(u);},
  run:()=>el("run").onclick(),render:ctx.__diagnostic.render};
}
test("exact session-safe baseline, unchanged GET LIST Auth and no browser data persistence",()=>{
 assert.ok(script);
 assert.notEqual(candidate,previous);
 assert.throws(()=>financeAlertFour(previous+" "),/SOURCE_CHANGED/);
 assert.match(candidate,/STALE_AUTH_PROBE/);
 assert.match(candidate,/getIdToken\(true\)/);
 assert.match(candidate,/mask.fieldPaths/);
 assert.match(candidate,/role!=="owner"&&anyMoneyReadable/);
 assert.doesNotMatch(candidate,
  /localStorage|sessionStorage|console\.log\(|\b(?:setDoc|updateDoc|deleteDoc|writeBatch)\s*\(/);
 const syntax=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:script,encoding:"utf8",timeout:10000});
 assert.equal(syntax.status,0,syntax.stderr);
});
test("an active internal non-Owner who can read finance gets an unambiguous WARN, not pending",async()=>{
 const h=harness();
 h.login(h.internal);
 await h.run();
 assert.equal(h.el("overall").className,"warn");
 assert.match(h.el("overall").textContent,/金額原票を読取可能/);
 assert.match(h.el("overall").textContent,/所属を確認/);
 for(const name of four){
  assert.equal(h.el(name).className,"warn");
  assert.match(h.el(name).textContent,/アクセス許可/);
 }
});
test("legitimate Owner continues to get 4 source PASS, not accidental WARN",async()=>{
 const h=harness();
 h.login(h.owner);
 await h.run();
 assert.equal(h.el("overall").className,"pass");
 assert.match(h.el("overall").textContent,/Ownerの4項目閲覧正常/);
});
test("even one allowed operation is visibly dangerous for an unverified partner candidate",()=>{
 const h=harness();
 for(const role of ["not-owner","partner-candidate","partner-verified","unknown"]){
  h.render("products",{listStatus:"allowed",getStatus:"untested"},role);
  assert.equal(h.el("products").className,"warn",role);
  assert.match(h.el("products").textContent,/一部読取許可/);
  h.render("records",{listStatus:"denied",getStatus:"allowed"},role);
  assert.equal(h.el("records").className,"warn",role);
 }
 h.render("products",{listStatus:"denied",getStatus:"denied"},"partner-candidate");
 assert.notEqual(h.el("products").className,"pass");
 h.render("products",{listStatus:"denied",getStatus:"untested"},"partner-verified");
 assert.notEqual(h.el("products").className,"pass");
});
