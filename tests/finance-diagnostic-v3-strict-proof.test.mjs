import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {originalFour,strictFour} from
 "../staging/finance-diagnostic-v3/build-strict.mjs";

const prev=originalFour(),now=strictFour();
const moduleScript=now.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
const script=moduleScript?.replace(/^import .+?;\s*$/gm,"");
const routes=["products","records","recordCorrections","revenueGoals"];
const BASE="projects/sales-management-cc116/databases/(default)/documents/";

function harness({missingOwnerCollection=""}={}){
 const auth={currentUser:null},dom=new Map(),callers=[];
 const el=id=>{
  if(!dom.has(id))dom.set(id,{
   value:"",hidden:false,disabled:false,textContent:"",className:""
  });
  return dom.get(id);
 };
 let cb;
 const user=(uid)=>({uid,emailVerified:true,
  getIdToken:async fresh=>{assert.equal(fresh,true);return "token-"+uid;}});
 const owner=user("owner"),partner=user("partner");
 const response=(status,body)=>({status,json:async()=>body});
 const requests=[];
 const fetch=async(url,opts)=>{
  const uid=auth.currentUser?.uid;
  requests.push({uid,method:opts.method});
  const path=new URL(url).pathname;
  const company=uid==="owner"?"hub":"partner";
  if(path.endsWith("/users/"+uid)){
   return response(200,{fields:{active:{booleanValue:true},
    companyId:{stringValue:company}}});
  }
  if(path.endsWith("/companies/"+company)){
   return response(200,{fields:uid==="owner"?
    {companyKind:{stringValue:"internal"},ownerUid:{stringValue:"owner"}}:
    {companyKind:{stringValue:"partner"},hubCompanyId:{stringValue:"hub"}}});
  }
  const name=opts.method==="POST"?
    JSON.parse(opts.body).structuredQuery?.from?.[0]?.collectionId:
    routes.find(x=>path.includes("/"+x+"/"));
  if(!routes.includes(name))throw Error("UNKNOWN_QUERY");
  if(uid==="partner")
   return response(403,{error:{code:403,status:"PERMISSION_DENIED"}});
  if(opts.method==="POST"){
   if(name===missingOwnerCollection)return response(200,[]);
   return response(200,[{document:{
    name:BASE+name+"/"+name+"-existing",
    fields:{companyId:{stringValue:"hub"}}
   }}]);
  }
  return response(200,{fields:{companyId:{stringValue:"hub"}}});
 };
 const ctx={
  document:{getElementById:el},
  location:{origin:"https://nico-factory.web.app"},
  URL,Map,Intl,Date,RegExp,Number,JSON,Error,
  initializeApp:()=>({}),
  browserSessionPersistence:{},
  initializeAuth:()=>auth,
  getFunctions:()=>({}),
  httpsCallable:(_f,name)=>async()=>{
   callers.push(name);
   if(name==="getPartnerWorkspace")
    return {data:{role:"owner"}};
   throw Error("unknown callable");
  },
  onAuthStateChanged:(_auth,callback)=>{cb=callback;callback(auth.currentUser);},
  signInWithEmailAndPassword:async()=>({}),
  signOut:async()=>{auth.currentUser=null;cb(null);},
  fetch,
 };
 runInNewContext(script+
  "\nthis.__probe={render};",ctx,{timeout:1000});
 const login=who=>{auth.currentUser=who;cb(who);};
 return {el,login,owner,partner,requests,callers,
  run:()=>el("run").onclick(),render:ctx.__probe.render};
}
test("original four-source remains frozen; strict page modifies only diagnostic presentation",()=>{
 assert.ok(moduleScript);
 assert.notEqual(prev,now);
 assert.match(now,/id="overall">未確認/);
 assert.match(now,/4項目拒否確認/);
 assert.match(now,/このUIDのみ・件数保存は別検証/);
 assert.match(now,/AUTH_CHANGED_DURING_PROBE/);
 assert.throws(()=>strictFour(prev+" "),/SOURCE_CHANGED/);
 assert.equal(readFileSync(new URL("../finance-boundary-check.html",import.meta.url),"utf8")
   .includes('id="overall"'),false);
 for(const id of routes)assert.match(now,new RegExp('id="'+id+'">未確認'));
});
test("single verified partner: four masked deny GET/LIST probes, no finance values",async()=>{
 const h=harness();
 h.login(h.owner);
 await h.run();
 assert.match(h.el("overall").textContent,/Ownerの4項目閲覧正常/);
 h.login(h.partner);
 await h.run();
 assert.equal(h.el("overall").className,"pass");
 assert.match(h.el("overall").textContent,/4項目拒否確認/);
 for(const id of routes){
  assert.equal(h.el(id).className,"pass");
  assert.match(h.el(id).textContent,/LIST・GETともに拒否/);
 }
 assert.ok(h.callers.includes("getPartnerWorkspace"));
 assert.equal(h.requests.filter(x=>x.uid==="partner"&&x.method==="POST").length,4);
 assert.equal(h.requests.filter(x=>x.uid==="partner"&&x.method==="GET").length,6);
});
test("generic internal member denial NEVER receives a success badge",()=>{
 const h=harness();
 for(const role of ["not-owner","partner-candidate","unknown"]){
  h.render("products",{listStatus:"denied",getStatus:"denied"},role);
  assert.notEqual(h.el("products").className,"pass");
 }
 h.render("products",{listStatus:"denied",getStatus:"denied"},"partner-verified");
 assert.equal(h.el("products").className,"pass");
});
test("one missing Owner original makes GET untested and entire partner verdict pending",async()=>{
 const h=harness({missingOwnerCollection:"revenueGoals"});
 h.login(h.owner);
 await h.run();
 h.login(h.partner);
 await h.run();
 assert.equal(h.el("overall").className,"unknown");
 assert.match(h.el("overall").textContent,/判定保留/);
 assert.match(h.el("revenueGoals").textContent,/GET未検証/);
});
test("read-only construction, valid JS module, no persistence or financial output",()=>{
 const check=spawnSync(process.execPath,["--check","--input-type=module"],{
  input:moduleScript,encoding:"utf8",timeout:10000
 });
 assert.equal(check.status,0,check.stderr);
 const scriptSource=readFileSync(new URL(
  "../staging/finance-diagnostic-v3/build-strict.mjs",import.meta.url),"utf8");
 for(const bad of [
  "localStorage","sessionStorage","console.log(","setDoc(","updateDoc(",
  "deleteDoc(","writeBatch(","submitPartnerWorkspaceCounts"
 ])assert.ok(!now.includes(bad),bad);
 assert.match(now,/select:\{fields:\[\{fieldPath:"companyId"\}\]\}/);
 assert.match(now,/masked\(name\+"\/"\+target,\["companyId"\],token\)/);
 assert.match(scriptSource,/STRICT_FOUR_PROOF_SOURCE_CHANGED/);
 assert.match(scriptSource,/STRICT_FOUR_PROOF_READ_ONLY_CONTRACT/);
});
