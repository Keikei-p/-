import test from "node:test";
import assert from "node:assert/strict";
import {buildOwnerPartnerTabSaveRequest,mountOwnerPartnerTabSettingsPanel}
 from "../ranking/owner-partner-tab-settings-panel.mjs";
import {readFileSync} from "node:fs";
const docData=(revision,published,tabs,saved)=>
 ({schema:"nico-partner-tabs-v1",revision,published,tabs,
   ...(saved===undefined?{}:{saved})});
function fakeDom(){
 const doc={
  createTextNode(value){return {textContent:value,ownerDocument:doc};},
  createElement(tag){return new Node(tag);}
 };
 class Node{
  constructor(tag){this.tagName=tag;this.ownerDocument=doc;this.children=[];
   this.textContent="";this.attributes={};this.disabled=false;this.checked=false;
   this.value="";this.hidden=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this.attributes[name]=value;}
 }
 const root=new Node("div");
 const list=tag=>{
  const nodes=[];
  const walk=node=>{if(node.tagName===tag)nodes.push(node);
   for(const child of node.children||[])walk(child);};
  walk(root);return nodes;
 };
 return {root,list};
}
test("Owner save request uses exact CAS revision and no company override",()=>{
 const policy=docData(7,true,["team"]);
 const req=buildOwnerPartnerTabSaveRequest(policy,["detail","product"],true);
 assert.deepEqual(req,{expectedRevision:7,published:true,tabs:["product","detail"]});
 assert(!("companyId" in req)&&!("ownerUid" in req));
 const off=buildOwnerPartnerTabSaveRequest(policy,["detail"],false);
 assert.deepEqual(off,{expectedRevision:7,published:false,tabs:[]});
 assert.deepEqual(policy,docData(7,true,["team"]));
});
test("both safe release flags OFF: Owner form makes zero callable requests",async()=>{
 const {root,list}=fakeDom();let calls=0;
 const identity={uid:"owner",emailVerified:true};
 const panel=mountOwnerPartnerTabSettingsPanel({
  enabled:false,serverGuardVerified:true,root,
  auth:{currentUser:identity},functions:{},
  httpsCallable:()=>{calls++;return async()=>({});},canOwner:()=>true
 });
 assert.equal(await panel.refresh(),false);
 assert.equal(calls,0);
 assert.equal(panel.ready,false);
 assert(list("button").every(button=>button.disabled));
 const {root:root2}=fakeDom();
 const panel2=mountOwnerPartnerTabSettingsPanel({
  enabled:true,serverGuardVerified:false,root:root2,
  auth:{currentUser:identity},functions:{},
  httpsCallable:()=>{calls++;return async()=>({});},canOwner:()=>true
 });
 assert.equal(await panel2.refresh(),false);assert.equal(calls,0);
});
test("Owner reads, selects, saves and unpublishes all 8 across one shared policy",async()=>{
 const {root,list}=fakeDom();const user={uid:"owner",emailVerified:true};
 let latest=docData(2,true,["product"]),saves=[],reads=0;
 const api=(_functions,name)=>async(payload)=>{
  if(name==="getOwnerPartnerTabPublication"){reads++;return {data:latest};}
  assert.equal(name,"setOwnerPartnerTabPublication");
  saves.push(payload);
  latest=docData(latest.revision+1,payload.published,payload.tabs,true);
  return {data:latest};
 };
 const panel=mountOwnerPartnerTabSettingsPanel({
  enabled:true,serverGuardVerified:true,root,auth:{currentUser:user},
  functions:{},httpsCallable:api,canOwner:()=>true
 });
 assert.equal(await panel.refresh(),true);assert.equal(reads,1);
 const options=list("input");assert.equal(options.length,8);
 assert.equal(options.find(x=>x.value==="product").checked,true);
 assert.equal(options.find(x=>x.value==="detail").checked,false);
 options.find(x=>x.value==="detail").checked=true;
 assert.equal(await panel.persist(true),true);
 assert.deepEqual(saves[0],{expectedRevision:2,published:true,tabs:["product","detail"]});
 assert.deepEqual(panel.policy.tabs,["product","detail"]);
 assert.equal(await panel.persist(false),true);
 assert.deepEqual(saves[1],{expectedRevision:3,published:false,tabs:[]});
 assert.equal(panel.policy.published,false);
 assert(options.every(x=>x.checked===false));
 assert.equal(panel.ready,true);
});
test("Owner role change mid-request cannot activate stale publication",async()=>{
 const {root}=fakeDom(),old={uid:"owner",emailVerified:true},
  auth={currentUser:old};
 let resolveRead;
 const request=new Promise(resolve=>{resolveRead=resolve;});
 const panel=mountOwnerPartnerTabSettingsPanel({
  enabled:true,serverGuardVerified:true,root,auth,functions:{},
  httpsCallable:()=>async()=>request,canOwner:()=>true
 });
 const pending=panel.refresh();
 auth.currentUser={uid:"partner",emailVerified:true};
 resolveRead({data:docData(1,true,["detail"])});
 assert.equal(await pending,false);
 assert.equal(panel.policy,null);
 assert.equal(panel.ready,false);
});
test("unverified Owner or malformed response never permits publication save",async()=>{
 for(const bad of [
  {...docData(1,true,["detail"]),companyId:"another-partner"},
  docData(1,true,["detail","detail"]),
  {...docData(1,true,["goal"]),revenue:1000},
  {...docData(1,true,["unknown"])}
 ]){
  const {root,list}=fakeDom();const user={uid:"owner",emailVerified:true};
  let writes=0;
  const panel=mountOwnerPartnerTabSettingsPanel({
   enabled:true,serverGuardVerified:true,root,auth:{currentUser:user},
   functions:{},canOwner:()=>true,
   httpsCallable:name=>async()=>{
    if(name==="setOwnerPartnerTabPublication"){writes++;throw Error("FORBIDDEN");}
    return {data:bad};
   }
  });
  assert.equal(await panel.refresh(),false);
  assert.equal(panel.ready,false);
  assert(list("button").every(x=>x.disabled));
  assert.equal(await panel.persist(true),false);
  assert.equal(writes,0);
 }
});
test("existing Owner tab and partner input have explicit default OFF UI security gate",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 assert(html.includes('id="ownerPartnerTabPublicationPanel"'));
 assert(html.includes('id="ownerPartnerTabPublicationRoot"'));
 assert(html.includes("const NICO_PARTNER_TAB_UI_ENABLED = false;"));
 assert(html.includes("const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;"));
 assert(html.includes('void refreshOwnerPartnerTabPublicationUI(stillOpen);'));
 assert(html.includes('if(NICO_PARTNER_TAB_UI_ENABLED!==true||'));
 assert(html.includes('NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED!==true)return false;'));
 assert(html.includes("const partnerInlineSave = httpsCallable(partnerCountFunctions,"));
});
