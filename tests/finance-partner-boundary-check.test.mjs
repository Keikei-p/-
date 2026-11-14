import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const html=readFileSync(new URL("../finance-partner-boundary-check.html",import.meta.url),"utf8");
const matches=html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(matches,"new separate partner diagnostic contains a module");
const browser=matches[1].replace(/^import \{[^\n]+\} from "[^"]+";\s*$/gm,"");
const response=(status,body)=>({status,json:async()=>body});
const base="projects/sales-management-cc116/databases/(default)/documents/";
test("new scoped diagnostic never writes, shares existing user session or leaks money",()=>{
 assert.match(html,/initializeAuth\(app,\{persistence:browserSessionPersistence\}\)/);
 assert.match(html,/mask\.fieldPaths/);
 assert.match(html,/select:\{fields:\[\{fieldPath:"companyId"\}\]\}/);
 for(const coll of ["products","records","recordCorrections","revenueGoals"]){
  assert.match(html,new RegExp('id="'+coll+'"'),"must show "+coll+" result");
  assert(html.includes('"'+coll+'"'),"four-collection masked read must include "+coll);
 }
 assert.match(html,/const FINANCE_COLLECTIONS=Object.freeze\(/);
 assert.doesNotMatch(html,/setDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(|localStorage|sessionStorage|console\.log\(/);
 assert.doesNotMatch(html,/totalRevenue|cashbackOptions|revenuePerUnit|submitPartnerWorkspaceCounts/);
});
test("fresh partner owner with company GET denied can prove same-hub finance GET/LIST denied after verified Hub handoff",async()=>{
 const hub="company_internal",partner="partner_actual";
 const owner={uid:"owner_u2",emailVerified:true,getIdToken:async()=>"hub-token"};
 const verifiedPartner={uid:"partner_u3",emailVerified:true,getIdToken:async()=>"partner-token"};
 const auth={currentUser:owner},cb=[];
 const elements=new Map(),calls=[],rawFinance=[];
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   value:"",disabled:false,hidden:false,textContent:"",className:""
  });
  return elements.get(id);
 };
 const get=async(url,opts)=>{
  const token=opts.headers?.Authorization?.replace("Bearer ","");
  const pathname=new URL(url).pathname;
  if(pathname.endsWith("/users/owner_u2"))
   return response(200,{fields:{active:{booleanValue:true},
    companyId:{stringValue:hub}}});
  if(pathname.endsWith("/users/partner_u3"))
   return response(200,{fields:{active:{booleanValue:true},
    companyId:{stringValue:partner}}});
  if(pathname.endsWith("/companies/"+hub))
   return response(200,{fields:{companyKind:{stringValue:"internal"},
    ownerUid:{stringValue:owner.uid}}});
  if(pathname.endsWith("/companies/"+partner))
   return response(403,{error:{code:403,status:"PERMISSION_DENIED"}});
  const name=opts.method==="POST"?
    JSON.parse(opts.body)?.structuredQuery?.from?.[0]?.collectionId:
    pathname.includes("/products/")?"products":"records";
  rawFinance.push({token,name,method:opts.method,body:opts.body,url});
  if(token==="partner-token")
   return response(403,{error:{code:403,status:"PERMISSION_DENIED"}});
  if(opts.method==="POST")
   return response(200,[{document:{name:base+name+"/"+name+"-sample",
    fields:{companyId:{stringValue:hub}}}}]);
  return response(200,{fields:{companyId:{stringValue:hub}}});
 };
 const scope=(_functions,name)=>async(input)=>{
  if(name!=="getPartnerWorkspace")throw Error("NO_FALLBACK_ALLOWED");
  calls.push({caller:auth.currentUser.uid,input});
  const date=input.date;
  if(auth.currentUser===owner)return {data:{
   role:"hub",date,registeredCompanies:[
    {partnerCompanyId:partner,name:"協力店A",active:true}
   ]
  }};
  if(auth.currentUser===verifiedPartner)return {data:{
   role:"owner",date,categories:["NURO","Air"]
  }};
  throw Error("Unexpected actor");
 };
 const context={console:{log:()=>{throw Error("NO_LOG")}},
  document:{getElementById:el},location:{origin:"https://nico-factory.web.app"},
  URL,Intl,Date,Map,Set,RegExp,JSON,Error,Number,
  initializeApp:()=>({}),initializeAuth:()=>auth,
  browserSessionPersistence:{kind:"session"},
  getFunctions:()=>({}),httpsCallable:scope,
  onAuthStateChanged:(_a,callback)=>{cb.push(callback);callback(auth.currentUser)},
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:get};
 runInNewContext(browser,context);
 await el("run").onclick();
 assert.match(el("products").textContent,/Owner閲覧許可/);
 assert.match(el("records").textContent,/Owner閲覧許可/);
 assert.equal(calls.length,1);
 assert.equal(calls[0].caller,owner.uid);
 assert.equal(calls[0].input.date.length,10);
 const first=rawFinance.slice();
 assert.equal(first.length,8);
 assert.equal(new Set(first.filter(x=>x.method==="POST").map(x=>x.name)).size,4);
 assert(first.every(x=>x.token==="hub-token"));
 auth.currentUser=verifiedPartner;
 cb[0](verifiedPartner);
 await el("run").onclick();
 assert.match(el("identity").textContent,/協力店所属をFunctionsで照合済み/);
 assert.match(el("products").textContent,/LIST・GETともに拒否/);
 assert.match(el("records").textContent,/LIST・GETともに拒否/);
 assert.match(el("recordCorrections").textContent,/LIST・GETともに拒否/);
 assert.match(el("revenueGoals").textContent,/LIST・GETともに拒否/);
 assert.match(el("counts").textContent,/協力店件数の読取成功/);
 assert.equal(calls.length,2);
 assert.equal(calls[1].caller,verifiedPartner.uid);
 assert.equal(rawFinance.length,16);
 assert(rawFinance.slice(8).every(x=>x.token==="partner-token"));
 assert.equal(rawFinance.slice(8).filter(x=>x.method==="GET").length,4);
 assert(rawFinance.slice(8).every(x=>x.url.includes(
  "firestore.googleapis.com/v1/projects/sales-management-cc116")));
 assert.equal(el("status").textContent.includes("本番承認"),true);
});
test("unrelated partner, unverified Hub inventory or forged workspace never produce finance success",async()=>{
 const htmlSource=readFileSync(new URL("../finance-partner-boundary-check.html",import.meta.url),"utf8");
 assert.match(htmlSource,/Array\.isArray\(ownerHandoff\.partnerIds\)/);
 assert.match(htmlSource,/ownerHandoff\.partnerIds\.includes\(account\.company\)/);
 assert.match(htmlSource,/reply\?\.role==="hub"&&reply\?\.date===date/);
 assert.match(htmlSource,/new Set\(partnerIds\)\.size===partnerIds\.length/);
 assert.match(htmlSource,/ownerHandoff=null;/);
 assert.match(htmlSource,/ownerHandoff\.company!==account\.company/);
 assert.match(htmlSource,/ownerHandoff\?\.company===account\.company/);
 assert.doesNotMatch(htmlSource,/localStorage|sessionStorage|console\.log\(/);
});
