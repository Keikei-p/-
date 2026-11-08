import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createRequire} from "node:module";
import {buildCandidateFromRepo}
 from "../tools/ranking/build-owner-settings-workspace-candidate.mjs";
const require=createRequire(import.meta.url);
const {JSDOM}=require("jsdom");

const wait=()=>new Promise(resolve=>setTimeout(resolve,12));
const safeUser=uid=>({
 uid,email:uid+"@example.test",emailVerified:true,
 getIdToken:async()=>"signed-local-emulator-token"
});
function setup({
 ownerStatus={schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
  partners:[{
   partnerCompanyId:"partner",companyName:"協力店A",
   ownApproved:false,otherApproved:false,version:0,canEdit:true
  }]},
 deferStatus=false
}={}){
 const html=buildCandidateFromRepo();
 const dom=new JSDOM(html,{url:"https://nico-factory.web.app/partner-workspace.html",
  runScripts:"outside-only",pretendToBeVisual:true});
 const {window}=dom,ctx=dom.getInternalVMContext();
 const auth={currentUser:null};
 const calls=[];
 const initial=structuredClone(ownerStatus),status=structuredClone(initial);
 let statusResolve;
 const promise=deferStatus?new Promise(resolve=>{statusResolve=resolve;}):null;
 const callback={};
 Object.assign(window,{
  initializeApp:()=>({}),
  getAuth:()=>auth,
  getFunctions:()=>({}),
  onAuthStateChanged:(_auth,cb)=>{callback.onAuth=cb;return()=>{};},
  signInWithEmailAndPassword:async()=>{},
  createUserWithEmailAndPassword:async()=>{},
  signOut:async()=>{auth.currentUser=null;},
  sendEmailVerification:async()=>{},
  sendPasswordResetEmail:async()=>{},
  setPersistence:async()=>{},
  browserSessionPersistence:{},
  httpsCallable:(_f,name)=>async(data={})=>{
   calls.push({name,data:structuredClone(data)});
   if(name==="getRankingOwnerConsentStatus"){
    if(promise)await promise;
    return {data:structuredClone(status)};
   }
   if(name==="setRankingOwnerConsent"){
    const item=status.partners.find(p=>p.partnerCompanyId===data.partnerCompanyId);
    assert(item,"only existing partner may be edited");
    assert.equal(item.version,data.expectedVersion);
    item.ownApproved=data.enable;
    item.version++;
    return {data:{saved:true,partnerCompanyId:data.partnerCompanyId,
      enabled:data.enable,version:item.version}};
   }
   throw Error("No live Firebase Functions can be called in DOM tests: "+name);
  }
 });
 const mod=html.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert(mod,"one pre-existing app module");
 const imports=mod[1].match(/^import .* from "https:\/\/www[.]gstatic[.]com\/firebasejs\/[^"]+";$/gm);
 assert.equal(imports?.length,3,"all remote Firebase module imports are fully mocked");
 const js=mod[1].replace(/^import .* from "https:\/\/www[.]gstatic[.]com\/firebasejs\/[^"]+";$/gm,"");
 new vm.Script(js,{filename:"nico-partner-staging-real-dom.js"}).runInContext(ctx);
 const expression=source=>vm.runInContext(source,ctx);
 return {
  window,dom,auth,calls,status,callback,expression,
  resolveStatus:()=>statusResolve?.(),
  close:()=>dom.window.close()
 };
}
test("real DOM: verified hub owner opens same-dashboard approval tab using Callable, not Firestore",async()=>{
 const x=setup();
 try{
  x.auth.currentUser=safeUser("hubOwner");
  x.expression('data={role:"hub"}; $("tabRankingSettings").hidden=!rankingOwnerAllowed();');
  const nav=x.window.document.getElementById("tabRankingSettings");
  assert.equal(nav.hidden,false);
  nav.click();await wait();
  const content=x.window.document.getElementById("rankingOwnerContent");
  assert.equal(x.window.document.getElementById("rankingOwnerBox").hidden,false);
  assert.match(content.textContent,/合同ランキングの公開設定/);
  assert.match(content.textContent,/協力店A/);
  assert.deepEqual(x.calls.map(y=>y.name),["getRankingOwnerConsentStatus"]);
  assert.equal(x.calls[0].data&&Object.keys(x.calls[0].data).length,0);
  assert.equal(x.window.document.getElementById("tabDashboard").getAttribute("aria-pressed"),"false");
 }finally{x.close();}
});
test("real DOM: owner can approve, revoke and approve again only after explicit individual name checkbox",async()=>{
 const x=setup();
 try{
  x.auth.currentUser=safeUser("hubOwner");
  x.expression('data={role:"hub"}; $("tabRankingSettings").hidden=!rankingOwnerAllowed();');
  x.window.document.getElementById("tabRankingSettings").click();await wait();
  const root=x.window.document.getElementById("rankingOwnerContent");
  let button=root.querySelector(".ranking-owner-save"),check=root.querySelector(".ranking-owner-checkbox");
  assert.equal(button.disabled,true);
  check.checked=true;
  check.dispatchEvent(new x.window.Event("change",{bubbles:true}));
  assert.equal(button.disabled,false);
  button.click();await wait();
  assert.equal(x.status.partners[0].version,1);
  assert.equal(x.status.partners[0].ownApproved,true);
  assert.match(root.textContent,/自社承認済み/);
  button=root.querySelector(".ranking-owner-save");
  button.click();await wait();
  assert.equal(x.status.partners[0].version,2);
  assert.equal(x.status.partners[0].ownApproved,false);
  check=root.querySelector(".ranking-owner-checkbox");
  check.checked=true;check.dispatchEvent(new x.window.Event("change",{bubbles:true}));
  root.querySelector(".ranking-owner-save").click();await wait();
  assert.equal(x.status.partners[0].version,3);
  assert.equal(x.calls.filter(z=>z.name==="setRankingOwnerConsent").length,3);
  assert.deepEqual(x.calls.filter(z=>z.name==="setRankingOwnerConsent")
   .map(z=>z.data),[
    {partnerCompanyId:"partner",enable:true,expectedVersion:0},
    {partnerCompanyId:"partner",enable:false,expectedVersion:1},
    {partnerCompanyId:"partner",enable:true,expectedVersion:2}
   ]);
  assert(!root.textContent.includes("unitPrice"));
  assert(!root.textContent.includes("cashback"));
 }finally{x.close();}
});
test("real DOM: member, shared company-code login and secondary workspace do not open consent",async()=>{
 for(const [label,setupScript] of [
  ["member",'data={role:"member"};'],
  ["shared_code",'data={role:"owner"};activeCodeSession="company-code-only";'],
  ["secondary",'data={role:"owner"};workspaceCompanyId="other-company";'],
  ["unverified",'data={role:"owner"};auth.currentUser.emailVerified=false;']
 ]){
  const x=setup();
  try{
   x.auth.currentUser=safeUser("owner");
   x.expression(setupScript+
    ' $("tabRankingSettings").hidden=!rankingOwnerAllowed();');
   const tab=x.window.document.getElementById("tabRankingSettings");
   assert.equal(tab.hidden,true,label);
   tab.click();await wait();
   assert.equal(x.calls.length,0,label);
   assert.equal(x.window.document.getElementById("rankingOwnerBox").hidden,true,label);
  }finally{x.close();}
 }
});
test("real DOM: auth change clears old owner's pending approval and hides tab before stale response",async()=>{
 const x=setup({deferStatus:true});
 try{
  x.auth.currentUser=safeUser("hubOwner");
  x.expression('data={role:"hub"}; $("tabRankingSettings").hidden=!rankingOwnerAllowed();');
  x.window.document.getElementById("tabRankingSettings").click();await wait();
  assert.equal(x.calls.filter(y=>y.name==="getRankingOwnerConsentStatus").length,1);
  x.auth.currentUser=null;
  await x.callback.onAuth(null);
  x.resolveStatus();await wait();
  assert.equal(x.window.document.getElementById("tabRankingSettings").hidden,true);
  assert.equal(x.window.document.getElementById("rankingOwnerBox").hidden,true);
  assert.equal(x.window.document.getElementById("rankingOwnerContent").children.length,0);
  assert(!x.window.document.body.textContent.includes("協力店A"));
  assert.equal(x.calls.filter(y=>y.name==="setRankingOwnerConsent").length,0);
 }finally{x.close();}
});
test("real DOM: switching away from consent to existing count-entry tab closes stale panel",async()=>{
 const x=setup();
 try{
  x.auth.currentUser=safeUser("owner");
  x.expression('data={role:"owner"}; $("tabRankingSettings").hidden=!rankingOwnerAllowed();');
  x.window.document.getElementById("tabRankingSettings").click();await wait();
  const content=x.window.document.getElementById("rankingOwnerContent");
  assert.match(content.textContent,/協力店A/);
  x.window.document.getElementById("tabRecords").click();await wait();
  assert.equal(content.children.length,0);
  assert.equal(x.window.document.getElementById("recordsBox").hidden,false);
  assert.equal(x.window.document.getElementById("rankingOwnerBox").hidden,true);
 }finally{x.close();}
});
