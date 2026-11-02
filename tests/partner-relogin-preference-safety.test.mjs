import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const begin=html.indexOf("async function openSameAppPartnerWorkspace(");
const end=html.indexOf("async function partnerInlineRun(work){",begin);
assert.ok(begin>0&&end>begin,"canonical partner login boundaries are present");
const source=html.slice(begin,end);

function harness({existing="",fetchResult=true}={}){
 const user={uid:"verifiedUser",email:"staff@example.com",emailVerified:true};
 const elements=new Map(),prefs=new Map();
 if(existing)prefs.set(user.uid,existing);
 const pInline=id=>{
  if(!elements.has(id))elements.set(id,{
   hidden:true,value:"",textContent:"",style:{},disabled:false
  });
  return elements.get(id);
 };
 let finishFetch;
 const pendingFetch=new Promise(resolve=>{finishFetch=resolve;});
 const calls=[];
 const ctx={
  auth:{currentUser:user},pInline,partnerInlineWorkspaceCompany:"",
  partnerLeaderLastInvitation:null,partnerInlineData:null,
  partnerInlineEditingStaffId:"",
  partnerMainValidId:id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(id),
  stopRealtimeListeners:()=>calls.push("stopRealtimeListeners"),
  rememberPartnerWorkspace:(uid,cid)=>{calls.push("remember");prefs.set(uid,cid);},
  rememberedPartnerWorkspace:uid=>prefs.get(uid)||"",
  clearRememberedPartnerWorkspace:uid=>{calls.push("clear");prefs.delete(uid);},
  partnerMainDate:()=> "2026-11-02",
  mountPartnerCanonicalNavigation:()=>{},
  mountPartnerSafeManagementMenu:()=>{},
  partnerSameAppSelectPanel:()=>{},
  partnerInlineFetch:async()=>{await pendingFetch;return fetchResult;},
  appScreen:{dataset:{},style:{}},
  verificationScreen:{style:{}},companySetupScreen:{style:{}},
  authScreen:{style:{}},
  userName:{textContent:""},userEmail:{textContent:""},
  userRole:{textContent:""},loginStatus:{textContent:""},
  databaseStatus:{textContent:""}
 };
 runInNewContext(source,ctx);
 return {ctx,user,calls,prefs,pInline,finishFetch};
}

test("secondary workspace preference is saved only after server-verified count-only read",async()=>{
 const h=harness();
 const opening=h.ctx.openSameAppPartnerWorkspace(h.user,"partnerA");
 assert.equal(h.prefs.has(h.user.uid),false,"unverified company is not cached");
 assert.equal(h.ctx.appScreen.dataset.partnerCountOnly,"true","financial app remains inaccessible");
 h.finishFetch();
 await opening;
 assert.equal(h.prefs.get(h.user.uid),"partnerA");
 assert.deepEqual(h.calls,["stopRealtimeListeners","remember"]);
});

test("failed read releases stale company preference without switching into finance",async()=>{
 const h=harness({existing:"partnerA",fetchResult:false});
 const opening=h.ctx.openSameAppPartnerWorkspace(h.user,"partnerA");
 assert.equal(h.prefs.get(h.user.uid),"partnerA");
 h.finishFetch();
 await opening;
 assert.equal(h.prefs.has(h.user.uid),false,"old invalid company must not trap next login");
 assert.equal(h.ctx.appScreen.dataset.partnerCountOnly,"true");
 assert.deepEqual(h.calls,["stopRealtimeListeners","clear"]);
});

test("failed old workspace request cannot erase a newly chosen workspace",async()=>{
 const h=harness({existing:"partnerA",fetchResult:false});
 const opening=h.ctx.openSameAppPartnerWorkspace(h.user,"partnerA");
 h.prefs.set(h.user.uid,"partnerB");
 h.finishFetch();
 await opening;
 assert.equal(h.prefs.get(h.user.uid),"partnerB");
 assert.equal(h.calls.includes("clear"),false);
});

test("old request never writes another signed-in user's cached company",async()=>{
 const h=harness({fetchResult:true});
 const opening=h.ctx.openSameAppPartnerWorkspace(h.user,"partnerA");
 h.ctx.auth.currentUser={uid:"otherUser",emailVerified:true};
 h.finishFetch();
 await opening;
 assert.equal(h.prefs.size,0);
 assert.equal(h.calls.includes("remember"),false);
});

test("primary partner login does not set or clear a secondary workspace ID",async()=>{
 const h=harness({fetchResult:true});
 const opening=h.ctx.openSameAppPartnerWorkspace(h.user);
 h.finishFetch();
 await opening;
 assert.equal(h.prefs.size,0);
 assert.equal(h.calls.includes("remember"),false);
 assert.equal(h.calls.includes("clear"),false);
});
