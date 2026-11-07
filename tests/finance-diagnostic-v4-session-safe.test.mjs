import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {strictFour} from "../staging/finance-diagnostic-v3/build-strict.mjs";
import {sessionSafeFour} from "../staging/finance-diagnostic-v4/build-session-safe.mjs";
const source=sessionSafeFour();
const code=source.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
const runnable=code?.replace(/^import .+?;\s*$/gm,"");
const names=["products","records","recordCorrections","revenueGoals"];
const root="projects/sales-management-cc116/databases/(default)/documents/";
function harness({holdOwnerFinance=false,missingOwnerCollection=""}={}){
 const auth={currentUser:null},els=new Map(),calls=[];
 const el=id=>{
  if(!els.has(id))els.set(id,{
   value:"",hidden:false,disabled:false,textContent:"",className:""
  });
  return els.get(id);
 };
 let onAuth,release,started;
 const hold=holdOwnerFinance?new Promise(resolve=>{release=resolve;}):null;
 const encountered=new Promise(resolve=>{started=resolve;});
 const person=uid=>({uid,emailVerified:true,getIdToken:async fresh=>{
  assert.equal(fresh,true);return "token-"+uid;
 }});
 const owner=person("owner"),partner=person("partner");
 const reply=(status,body)=>({status,json:async()=>body});
 const fetch=async(url,options)=>{
  const uid=auth.currentUser?.uid,parsed=new URL(url);
  const company=uid==="owner"?"hub":"partner";
  calls.push({uid,method:options.method,path:parsed.pathname});
  if(parsed.pathname.endsWith("/users/"+uid))
   return reply(200,{fields:{active:{booleanValue:true},companyId:{stringValue:company}}});
  if(parsed.pathname.endsWith("/companies/"+company))
   return reply(200,{fields:uid==="owner"?
    {companyKind:{stringValue:"internal"},ownerUid:{stringValue:"owner"}}:
    {companyKind:{stringValue:"partner"},hubCompanyId:{stringValue:"hub"}}});
  const name=options.method==="POST"?
   JSON.parse(options.body)?.structuredQuery?.from?.[0]?.collectionId:
   names.find(n=>parsed.pathname.includes("/"+n+"/"));
  if(!names.includes(name))throw Error("unexpected probe path");
  if(uid==="owner"&&holdOwnerFinance&&options.method==="POST"&&name==="products"){
   started();
   await hold;
  }
  if(uid==="partner")return reply(403,{error:{code:403,status:"PERMISSION_DENIED"}});
  if(options.method==="POST"){
   if(name===missingOwnerCollection)return reply(200,[]);
   return reply(200,[{document:{name:root+name+"/"+name+"-existing",
    fields:{companyId:{stringValue:"hub"}}}}]);
  }
  return reply(200,{fields:{companyId:{stringValue:"hub"}}});
 };
 const env={
  document:{getElementById:el},
  location:{origin:"https://nico-factory.web.app"},
  URL,Map,Intl,Date,RegExp,Number,JSON,Error,
  initializeApp:()=>({}),browserSessionPersistence:{},
  initializeAuth:()=>auth,getFunctions:()=>({}),
  httpsCallable:(_f,name)=>async()=>{
   if(name==="getPartnerWorkspace")return {data:{role:"owner"}};
   throw Error("unknown callable");
  },
  onAuthStateChanged:(_auth,callback)=>{onAuth=callback;callback(auth.currentUser);},
  signInWithEmailAndPassword:async()=>({}),
  signOut:async()=>{auth.currentUser=null;onAuth(null);},
  fetch
 };
 const vm=awaitImportVm();
 vm.runInNewContext(runnable,env,{timeout:1000});
 const login=u=>{auth.currentUser=u;onAuth(u);};
 return {owner,partner,login,el,calls,run:()=>el("run").onclick(),
  logout:()=>el("logout").onclick(),encountered,release};
}
function awaitImportVm(){
 // Imported without any browser or network APIs.
 return {runInNewContext:(s,ctx,options)=>requireVm(s,ctx,options)};
}
import {runInNewContext as requireVm} from "node:vm";
test("source modification is narrowly scoped to status epoch; validated script and read-only requests",()=>{
 assert.notEqual(source,strictFour());
 assert.throws(()=>sessionSafeFour(strictFour()+" " ),/UNREVIEWED_INPUT/);
 assert.ok(code);
 const syntax=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:code,encoding:"utf8",timeout:10000
 });
 assert.equal(syntax.status,0,syntax.stderr);
 assert.match(code,/probeEpoch\+\+/);
 assert.match(code,/STALE_AUTH_PROBE/);
 assert.match(code,/getIdToken\(true\)/);
 assert.match(code,/mask.fieldPaths/);
 assert.match(code,/idToken|token/);
 assert.doesNotMatch(code,/localStorage|sessionStorage|console\.log\(|\b(?:setDoc|updateDoc|deleteDoc|writeBatch|fetch\("https:\/\/evil)/);
 for(const n of ["identity",...names,"counts","overall"])
  assert.match(source,new RegExp('id="'+n+'"'));
});
test("Owner proof is cleared visibly on logout; a different account cannot inherit pass badges",async()=>{
 const h=harness();
 h.login(h.owner);
 await h.run();
 assert.match(h.el("overall").textContent,/Ownerの4項目閲覧正常/);
 assert.equal(h.el("overall").className,"pass");
 h.el("workspace").value="outdatedCompany";
 await h.logout();
 for(const n of ["identity",...names,"counts","overall"]){
  assert.equal(h.el(n).textContent,"未確認",n);
  assert.equal(h.el(n).className,"unknown",n);
 }
 assert.equal(h.el("workspace").value,"");
 h.login(h.partner);
 for(const n of ["identity",...names,"counts","overall"]){
  assert.equal(h.el(n).textContent,"未確認",n);
  assert.equal(h.el(n).className,"unknown",n);
 }
 await h.run();
 assert.match(h.el("overall").textContent,/4項目拒否確認/);
 assert.equal(h.el("overall").className,"pass");
 for(const n of names)assert.match(h.el(n).textContent,/LIST・GETともに拒否/);
 assert.equal(h.calls.filter(c=>c.uid==="partner"&&c.method==="POST").length,4);
});
test("sign-out DURING outstanding finance read cannot resurrect stale success badges",async()=>{
 const h=harness({holdOwnerFinance:true});
 h.login(h.owner);
 const run=h.run();
 await h.encountered;
 await h.logout();
 h.release();
 await run;
 for(const n of ["identity",...names,"counts","overall"])
  assert.notEqual(h.el(n).className,"pass",n);
 assert.equal(h.el("overall").textContent,"未確認");
 assert.equal(h.el("overall").className,"unknown");
});
test("changing UID DURING outstanding Owner probe never claims Owner or partner finance success",async()=>{
 const h=harness({holdOwnerFinance:true});
 h.login(h.owner);
 const run=h.run();
 await h.encountered;
 h.login(h.partner);
 h.release();
 await run;
 for(const n of ["identity",...names,"counts","overall"])
  assert.notEqual(h.el(n).className,"pass",n);
 assert.equal(h.el("overall").textContent,"未確認");
});
test("missing prior Owner record still cannot promote partner denial to full verified GET",async()=>{
 const h=harness({missingOwnerCollection:"revenueGoals"});
 h.login(h.owner);await h.run();
 h.login(h.partner);await h.run();
 assert.equal(h.el("overall").className,"unknown");
 assert.match(h.el("revenueGoals").textContent,/GET未検証/);
});
