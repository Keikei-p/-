import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createOwnerRankingConsentPanel,validateOwnerRankingConsentStatus}
 from "../ranking/owner-ranking-consent-panel.mjs";

const makeStatus=(change={})=>({
 schema:"nico-ranking-owner-consent-v1",role:"hub_owner",
 partners:[{partnerCompanyId:"partner",companyName:"協力店A",
  ownApproved:false,otherApproved:false,version:0,canEdit:true,...change}]
});
class Element{
 constructor(tag){this.tagName=tag;this.className="";this.textContent="";
  this.children=[];this.listeners={};this.disabled=false;this.checked=false;}
 appendChild(x){this.children.push(x);return x;}
 replaceChildren(...x){this.children=[...x];}
 addEventListener(kind,callback){
  (this.listeners[kind]??=[]).push(callback);
 }
 async fire(kind){
  for(const callback of this.listeners[kind]||[])await callback();
 }
}
const document={createElement:tag=>new Element(tag)};
const flatten=node=>[node,...node.children.flatMap(flatten)];
const textOf=node=>flatten(node).map(n=>n.textContent).join(" ");
const find=(node,cls)=>flatten(node).find(e=>e.className===cls);

test("only exact count-free owner status contract is accepted",()=>{
 assert.deepEqual(validateOwnerRankingConsentStatus(makeStatus()),makeStatus());
 for(const bad of [
  {role:"member"},
  {partners:[{...makeStatus().partners[0],totalRevenue:125000}]},
  {partners:[{...makeStatus().partners[0],unitPrice:45000}]},
  {partners:[{...makeStatus().partners[0],companyName:"SB光_CB20000"}]},
  {partners:[{...makeStatus().partners[0],partnerCompanyId:"../../hub"}]},
  {partners:[{...makeStatus().partners[0],version:"1"}]},
  {partners:[{...makeStatus().partners[0],version:-1}]},
  {partners:[{...makeStatus().partners[0],canEdit:"true"}]},
  {partners:[makeStatus().partners[0],makeStatus().partners[0]]},
  {role:"partner_owner",partners:[]},
  {schema:"unexpected"}
 ]){
  const value={...makeStatus(),...bad};
  assert.throws(()=>validateOwnerRankingConsentStatus(value),/安全/);
 }
});

test("mobile consent enable requires individual-name disclosure checkbox and server re-read",async()=>{
 const root=new Element("main");
 const operations=[],state=makeStatus();
 const panel=createOwnerRankingConsentPanel({
  document,root,loadStatus:async()=>structuredClone(state),
  saveConsent:async input=>{
   operations.push(input);
   state.partners[0].ownApproved=input.enable;
   state.partners[0].version++;
   return {saved:true,partnerCompanyId:input.partnerCompanyId,
    enabled:input.enable,version:state.partners[0].version};
  }
 });
 assert.equal(await panel.refresh(),true);
 let button=find(root,"ranking-owner-save"),checkbox=find(root,"ranking-owner-checkbox");
 assert.equal(button.disabled,true);
 await button.fire("click");
 assert.equal(operations.length,0);
 checkbox.checked=true;await checkbox.fire("change");
 assert.equal(button.disabled,false);
 await button.fire("click");
 assert.deepEqual(operations,[{
  partnerCompanyId:"partner",enable:true,expectedVersion:0
 }]);
 assert(textOf(root).includes("自社承認済み・相手の承認待ち"));
 assert.equal(find(root,"ranking-owner-checkbox"),undefined,
  "already approved status does not ask to grant again");
 button=find(root,"ranking-owner-save");
 await button.fire("click");
 assert.deepEqual(operations[1],{
  partnerCompanyId:"partner",enable:false,expectedVersion:1
 });
 assert(textOf(root).includes("両社未承認"));
 assert.equal(state.partners[0].version,2);
 checkbox=find(root,"ranking-owner-checkbox");button=find(root,"ranking-owner-save");
 checkbox.checked=true;await checkbox.fire("change");await button.fire("click");
 assert.equal(state.partners[0].version,3);
 assert.equal(state.partners[0].ownApproved,true);
 panel.destroy();assert.equal(root.children.length,0);
});

test("no successful UI after save without updated server state, stale versions or failures",async()=>{
 for(const problem of ["serverStale","responseWrong","throws"]){
  const root=new Element("main");
  const status=makeStatus();
  const panel=createOwnerRankingConsentPanel({
   document,root,loadStatus:async()=>structuredClone(status),
   saveConsent:async args=>{
    if(problem==="throws")throw Error("user sensitive email or pricing");
    if(problem!=="serverStale"){
     status.partners[0].ownApproved=true;
     status.partners[0].version=1;
    }
    return problem==="responseWrong"?{saved:true,enabled:true,
     partnerCompanyId:"other",version:1}:
     {saved:true,enabled:true,partnerCompanyId:args.partnerCompanyId,version:1};
   }
  });
  await panel.refresh();
  const check=find(root,"ranking-owner-checkbox");
  check.checked=true;await check.fire("change");
  await find(root,"ranking-owner-save").fire("click");
  assert.equal(root.children.length,1);
  assert(textOf(root).includes("公開設定を確認できません"));
  assert(!textOf(root).includes("協力店A"));
  assert(!textOf(root).includes("sensitive"));
 }
});

test("do not create Firestore clients, store private material or execute network calls in panel",()=>{
 const source=readFileSync(
  new URL("../ranking/owner-ranking-consent-panel.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/getFirestore|setDoc|updateDoc|deleteDoc|localStorage|sessionStorage|innerHTML|fetch[(]|XMLHttpRequest|indexedDB/);
 assert.match(source,/createOwnerRankingConsentPanel/);
 assert.match(source,/expectedVersion:previousVersion/);
 assert.match(source,/個人名・班名/);
});

test("invalid, forged or financial status clears any previously visible company name",async()=>{
 const root=new Element("main"),status=makeStatus();
 const panel=createOwnerRankingConsentPanel({
  document,root,loadStatus:async()=>structuredClone(status),
  saveConsent:async()=>{throw Error("cannot save");}
 });
 assert.equal(await panel.refresh(),true);
 assert(textOf(root).includes("協力店A"));
 status.partners[0].totalRevenue=12345;
 assert.equal(await panel.refresh(),false);
 assert(!textOf(root).includes("協力店A"));
 assert(!textOf(root).includes("12345"));
});
