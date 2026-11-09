import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../staging/login-selfcheck-v1/login-self-check.html",import.meta.url),"utf8");
const modules=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
assert.equal(modules.length,1);
const script=modules[0][1].replace(/^import\s*\{[^}]+\}\s*from\s*"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+";\s*$/gm,"");
function load({existing=true,profile,readError=null}={}){
 const elements=new Map();
 const make=()=>({hidden:false,disabled:false,className:"",textContent:"",
  value:"",onclick:null,onsubmit:null});
 const $=id=>{
  if(!elements.has(id))elements.set(id,make());
  return elements.get(id);
 };
 const user={uid:"test_user_1",emailVerified:true};
 const auth={currentUser:null};
 let observer,reads=[],signIns=0,logouts=0,resets=0;
 const context={
  initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>({}),
  onAuthStateChanged:(_auth,callback)=>{observer=callback},
  signInWithEmailAndPassword:async(_auth,email,password)=>{
   signIns++;assert.equal(email,"demo@example.invalid");
   assert.equal(password,"passphrase");
   auth.currentUser=user;observer(user);
  },
  sendPasswordResetEmail:async()=>{resets++},
  sendEmailVerification:async()=>{},
  signOut:async()=>{logouts++;auth.currentUser=null;observer(null)},
  reload:async()=>{},
  doc:(_db,...path)=>{reads.push(path);return path},
  getDocFromServer:async()=>{if(readError)throw readError;return {
   exists:()=>existing,data:()=>profile??{
    uid:user.uid,active:true,companyId:"company_active",accessKind:"internal"
   }
  }},
  document:{getElementById:$},
  console
 };
 vm.runInNewContext(script+"\nglobalThis.__test={classify,inspect,status};",
  context,{filename:"login-self-check.html",timeout:2000});
 return {elements,element:$,auth,user,api:context.__test,observer:u=>observer(u),reads,
  get signIns(){return signIns},get logouts(){return logouts},get resets(){return resets}};
}
test("email sign-in categories exactly match current personal user status; no finance data",()=>{
 const x=load(),base={uid:x.user.uid,active:true,companyId:"company_active"};
 const outcome=(u)=>x.api.classify(x.user,u,true);
 assert.match(outcome({...base,active:false}).message,/利用停止中/);
 assert.match(outcome({...base,companyId:null}).message,/所属設定/);
 assert.match(outcome({...base,uid:"wrong_uid"}).message,/一致を確認できません/);
 assert.match(outcome({...base,companyId:"legacy:part-1"}).message,/自社アプリ/);
 assert.match(x.api.classify(x.user,null,false).message,/初期設定/);
});
test("partner profiles fail closed unless count-only finance-denial markers match",()=>{
 const x=load(),base={uid:x.user.uid,active:true,companyId:"partner_1",
  accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false};
 const r=x.api.classify(x.user,base,true);
 assert.equal(r.kind,"success");
 assert.match(r.message,/件数入力/);
 for(const change of [
  {canViewRevenue:true},{canViewUnitPrice:true},{memberType:"member"},{accessKind:"internal"}
 ]){
  const fail=x.api.classify(x.user,{...base,...change},true);
  assert.equal(fail.kind,"warning");
  assert.match(fail.message,/件数専用権限/);
 }
});
test("confirmed Auth but disabled profile displays stop reason without auto sign-out or data edits",async()=>{
 const x=load({profile:{uid:"test_user_1",companyId:"company_active",active:false}});
 x.auth.currentUser=x.user;
 await x.api.inspect(x.user);
 assert.equal(x.reads.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(x.reads[0])),["users",x.user.uid]);
 assert.equal(x.logouts,0);
 assert.match(x.elements.get("status").textContent,/利用停止中/);
 assert.equal(x.elements.get("loginBox").hidden,true);
 assert.equal(x.elements.get("sessionBox").hidden,false);
});
test("email not yet verified never accesses Firestore",async()=>{
 const x=load();
 x.auth.currentUser={uid:"test_user_1",emailVerified:false};
 await x.api.inspect(x.auth.currentUser);
 assert.equal(x.reads.length,0);
 assert.match(x.elements.get("status").textContent,/メール認証が未完了/);
 assert.equal(x.elements.get("verifyBtn").hidden,false);
});
test("signed-out user only sees generic login state",async()=>{
 const x=load();
 await x.api.inspect(null);
 assert.equal(x.reads.length,0);
 assert.equal(x.elements.get("loginBox").hidden,false);
 assert.equal(x.elements.get("sessionBox").hidden,true);
});
test("a Firestore read failure is never represented as successful membership",async()=>{
 const x=load({readError:{code:"permission-denied"}});
 x.auth.currentUser=x.user;await x.api.inspect(x.user);
 assert.match(x.elements.get("status").textContent,/権限を確認できません/);
 assert.equal(x.elements.get("status").className,"warning");
});
test("login password is cleared immediately; explicit logout only when user requests it",async()=>{
 const x=load();
 x.element("email").value=" DEMO@example.invalid ";
 x.element("password").value="passphrase";
 await x.element("loginForm").onsubmit({preventDefault(){}});
 assert.equal(x.signIns,1);
 assert.equal(x.logouts,0);
 assert.equal(x.element("password").value,"");
 await x.element("logoutBtn").onclick();
 assert.equal(x.logouts,1);
});
test("no admin SDK or direct write, credential collection, other-user lookups or money originals",()=>{
 assert.match(html,/getDocFromServer\(doc\(db,"users",user\.uid\)\)/);
 assert.match(html,/getAuth\(app\)/);
 assert.match(html,/onAuthStateChanged\(auth,user=>/);
 assert.match(html,/noindex,nofollow,noarchive/);
 assert.match(html,/会社コード/);
 assert.doesNotMatch(html,/\b(?:setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|createUserWithEmailAndPassword|createCustomToken|setCustomUserClaims|eval)\s*\(/);
 assert.doesNotMatch(html,/doc\(db,"(?:companies|members|records|products|revenueGoals|recordCorrections)"/);
 assert.doesNotMatch(html,/fetch\s*\(\s*["']https?:\/\//);
 assert.doesNotMatch(html,/localStorage|sessionStorage|console\.log\(/);
});
