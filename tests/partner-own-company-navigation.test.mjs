import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
function section(a,b,source=html){
 const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
 assert(i>=0&&j>i,"missing source boundaries: "+a);
 return source.slice(i,j);
}
function makeStorage(){
 const map=new Map();
 return {
  map,
  setItem:(key,value)=>map.set(key,value),
  getItem:key=>map.get(key)||null,
  removeItem:key=>map.delete(key)
 };
}
function context(){
 const storage=makeStorage(),ctx={sessionStorage:storage,
  partnerMainValidId:x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x)};
 runInNewContext(section('const ownCompanyPreferenceKey=','function partnerMainPendingInvite(){'),ctx);
 return {storage,ctx};
}
function route({own=false,remembered="partnerA",explicit="",serverCompany="partnerA"}={}){
 const calls=[],user={uid:"userA"};
 const rctx={
  URL, location:{href:"https://nico-factory.web.app/"+(explicit?"?workspaceCompanyId="+explicit:"")},
  auth:{currentUser:user},
  partnerMainPendingInvite:()=>null,
  partnerMainOwnCompanyPreferred:()=>own,
  rememberedPartnerWorkspace:()=>remembered,
  partnerMainValidId:s=>typeof s==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(s),
  partnerMainDate:()=>"2026-11-02",
  readPartnerWorkDay:async()=>{calls.push("resolve");return {data:{
   scope:"partner_workspace_lookup",workspaceCompanyId:serverCompany}};},
  openSameAppPartnerWorkspace:async(_user,cid)=>{calls.push("partner:"+cid);},
  enterApplication:async()=>{calls.push("own");},
  showLegacyFinanceEntryBlocked:()=>{calls.push("blocked");},
  showPartnerInviteAtMain:async()=>{calls.push("invite");},
  console:{info:()=>{}}
 };
 const tail='await enterApplication(\\n        user\\n      );';
 const start=html.indexOf('const pendingPartnerInvite=partnerMainPendingInvite();',html.indexOf('onAuthStateChanged('));
 const end=html.indexOf(tail.replaceAll('\\n','\n'),start);
 assert(start>0&&end>start);
 const source=html.slice(start,end+tail.replaceAll('\\n','\n').length);
 runInNewContext("this.route=async function(user){"+source+"}",rctx);
 return {calls,run:()=>rctx.route(user)};
}

test("self-company preference is UID scoped and remains only during session",()=>{
 const {ctx,storage}=context();
 ctx.preferOwnCompanyUntilLogout("userA");
 assert.equal(ctx.partnerMainOwnCompanyPreferred("userA"),true);
 assert.equal(ctx.partnerMainOwnCompanyPreferred("userB"),false);
 assert.equal(storage.map.get("nico-partner-own-company:userA"),"1");
 ctx.clearOwnCompanyPreference("userA");
 assert.equal(ctx.partnerMainOwnCompanyPreferred("userA"),false);
 ctx.preferOwnCompanyUntilLogout("bad/user");
 assert.equal(storage.map.size,0);
});

test("explicit return to internal company does not immediately rediscover partner login",async()=>{
 const r=route({own:true,remembered:"partnerA"});
 await r.run();
 assert.deepEqual(r.calls,["own"]);
});

test("normal repeat login still resolves secondary partner membership on another device",async()=>{
 const r=route({own:false,remembered:"",serverCompany:"partnerA"});
 await r.run();
 assert.deepEqual(r.calls,["resolve","partner:partnerA"]);
});

test("direct verified partner workspace selection overrides a temporary own-company preference",async()=>{
 const r=route({own:true,explicit:"partnerB"});
 await r.run();
 assert.deepEqual(r.calls,["partner:partnerB"]);
});

test("original-company button remembers the conscious choice before safe page reload",()=>{
 const button=section('pInline("pInlineReturnToOwnCompany").onclick=','async function openSameAppPartnerWorkspace(');
 const calls=[],ctx={
  auth:{currentUser:{uid:"userA"}},
  pInline:id=>{assert.equal(id,"pInlineReturnToOwnCompany");return {onclick:null};},
  clearRememberedPartnerWorkspace:uid=>calls.push("clear:"+uid),
  preferOwnCompanyUntilLogout:uid=>calls.push("prefer-own:"+uid),
  location:{origin:"https://nico-factory.web.app",replace:url=>calls.push("navigate:"+url)},
  URL
 };
 runInNewContext(button,ctx);
 ctx.pInline("pInlineReturnToOwnCompany").onclick();
 assert.deepEqual(calls,["clear:userA","prefer-own:userA","navigate:https://nico-factory.web.app/"]);
});
test("successful authorized partner view removes the temporary original-company override",()=>{
 const login=section('async function openSameAppPartnerWorkspace(','async function partnerInlineRun(work){');
 assert.match(login,/if\(loaded===true\)\{\s*clearOwnCompanyPreference\(user.uid\)/);
 assert.match(html,/if\(currentUser\?\.uid\)clearOwnCompanyPreference\(currentUser.uid\)/);
 assert.match(login,/stopRealtimeListeners\(\)/);
 assert.doesNotMatch(login,/getDocs\(|onSnapshot\(|getFirestore\(/);
});
