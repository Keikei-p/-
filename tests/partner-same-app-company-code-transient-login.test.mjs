/**
 * A transient company-code GET error is not identity revocation.
 * Preserve the isolated opaque login for an explicit retry, while making all
 * count writes and prior company dashboards inaccessible. No live credentials.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const start=html.indexOf("onAuthStateChanged(\n  auth,\n  async user => {");
const end=html.indexOf("/* =====================================================\n   ユーザー情報読み込み",start);
assert(start>=0&&end>start,"original sign-in callback must be present");
const source=html.slice(start,end);
function fixture({mode="transient",busy=false,code=true}={}){
 const calls=[],nodes={pInlineSave:{disabled:false}};
 const box=()=>({style:{display:"none"}});
 const ctx=vm.createContext({
  auth:{currentUser:null},
  partnerEmailLinkPending:false,partnerEmailLinkBusy:false,
  partnerEmailLinkPasswordState:null,
  nicoMainCodeLoginBusy:busy,
  partnerMainCodeToken:code?"C".repeat(43):"",
  partnerMainCodeActive:()=>!!ctx.partnerMainCodeToken&&!ctx.auth.currentUser,
  partnerMainCodeForget:()=>{calls.push("forget");ctx.partnerMainCodeToken="";},
  openSameAppCompanyCodeWorkspace:async()=>{
   calls.push("code-get");
   if(mode==="invalid")ctx.partnerMainCodeToken="";
   return mode==="success";
  },
  onAuthStateChanged:(_auth,handler)=>{ctx.callback=handler},
  pInline:id=>nodes[id],
  loginStatus:{textContent:""},databaseStatus:{textContent:""},
  currentUser:null,currentUserData:null,currentCompanyData:null,
  clearOwnCompanyPreference:()=>calls.push("clearOwnCompanyPreference"),
  resetPartnerInline:()=>calls.push("resetPartnerInline"),
  partnerRankingRequestGeneration:0,
  partnerRankingDailyCache:new Map([["old-company","data"]]),
  partnerRankingState:null,partnerRankingActiveKey:"old",
  document:{getElementById:()=>null,addEventListener:(name,handler)=>{
   assert.equal(name,"visibilitychange");assert.equal(typeof handler,"function");
  }},
  directPartnerLastInvitation:null,
  applyThemeSettings:()=>{},
  defaultThemeSettings:{},
  pendingInvitationData:null,
  verificationScreen:box(),companySetupScreen:box(),
  authScreen:box(),appScreen:box()
 });
 vm.runInContext(source,ctx);
 return {ctx,calls,nodes,run:()=>ctx.callback(null)};
}
test("temporary code GET outage retains isolated login but disables count submit",async()=>{
 const x=fixture();
 await x.run();
 assert(x.ctx.partnerMainCodeToken.length===43);
 assert.deepEqual(x.calls,["code-get"]);
 assert.equal(x.nodes.pInlineSave.disabled,true);
 assert.match(x.ctx.loginStatus.textContent,/ログイン情報は保持/);
 assert.match(x.ctx.databaseStatus.textContent,/未確認/);
 assert(!x.calls.includes("resetPartnerInline"));
 assert(!x.calls.includes("forget"));
 assert.equal(x.ctx.partnerRankingDailyCache.has("old-company"),true,
  "do not unexpectedly mutate the existing app during recovery");
});
test("invalid session is still revoked and old count/dashboard state cleared",async()=>{
 const x=fixture({mode:"invalid"});
 await x.run();
 assert.equal(x.ctx.partnerMainCodeToken,"");
 assert(x.calls.includes("resetPartnerInline"));
 assert.equal(x.ctx.partnerRankingDailyCache.size,0);
 assert.equal(x.ctx.authScreen.style.display,"block");
 assert.equal(x.ctx.appScreen.style.display,"none");
 assert.equal(x.ctx.loginStatus.textContent,"未ログイン");
});
test("successful code login stays in count-only main app without resetting data",async()=>{
 const x=fixture({mode:"success"});
 await x.run();
 assert.deepEqual(x.calls,["code-get"]);
 assert(x.ctx.partnerMainCodeToken.length===43);
 assert.equal(x.nodes.pInlineSave.disabled,false,
  "only actual successful preflight/GET inside workspace may decide save enablement");
});
test("busy login never clears pending code; no-code logout keeps the original behavior",async()=>{
 const busy=fixture({busy:true});await busy.run();
 assert.deepEqual(busy.calls,[]);
 assert(busy.ctx.partnerMainCodeToken.length===43);
 const signedOut=fixture({code:false});await signedOut.run();
 assert.deepEqual(signedOut.calls,["resetPartnerInline"]);
 assert.equal(signedOut.ctx.authScreen.style.display,"block");
 assert.equal(signedOut.ctx.partnerRankingDailyCache.size,0);
});

test("Refresh recovers a temporarily unavailable code workspace only after verified count GET",async()=>{
 const begin=html.indexOf("async function partnerInlineFetch(){");
 const stop=html.indexOf('pInline("pInlineReturnToOwnCompany").onclick=',begin);
 assert(begin>0&&stop>begin);
 const fetchSource=html.slice(begin,stop);
 const date="2026-11-21",saveControl={disabled:true};
 const ctx=vm.createContext({
  partnerInlineNonce:0,partnerOptionalVerifiedGoal:null,
  partnerOptionalTabGeneration:0,partnerInlineData:null,
  partnerInlineWorkspaceCompany:"",
  partnerInlineIdentity:()=> "code-session-epoch:1",
  partnerMainCodeActive:()=>true,
  partnerMainCountRead:async req=>{
   assert.equal(req.date,date);
   return {data:{date,companyName:"協力店A",role:"owner",
    teams:[],staff:[],categories:["NURO"],records:[],enabledCategories:["NURO"]}};
  },
  pInline:id=>id==="pInlineDate"?{value:date}:id==="pInlineSave"?saveControl:undefined,
  partnerInlineStatus:()=>{},
  partnerInlineRender:()=>{saveControl.disabled=false},
  refreshPartnerPublishedTabNavigation:()=>{},
  loginStatus:{textContent:"件数サービスの応答待ち"},
  databaseStatus:{textContent:"件数API未確認"},
  partnerSameAppSelectedPanel:"record",
  partnerOptionalPublicationProtectionActive:()=>false
 });
 vm.runInContext(fetchSource,ctx);
 assert.equal(await vm.runInContext("partnerInlineFetch()",ctx),true);
 assert.equal(ctx.loginStatus.textContent,"ログイン済み・協力店");
 assert.equal(ctx.databaseStatus.textContent,"件数API接続済み");
 assert.equal(saveControl.disabled,false);
 assert.equal(ctx.partnerInlineNonce,1);
});

test("original Owner auth pathway and server-side money gates are untouched",()=>{
 assert.match(source,/if \(user\) \{/);
 assert.match(source,/await enterApplication\(\s*user\s*\)/);
 assert.match(source,/if\(partnerMainCodeActive\(\)\)\{/);
 assert.match(source,/pInline\("pInlineSave"\)\.disabled=true/);
 assert.doesNotMatch(source,/\b(setDoc|updateDoc|deleteDoc|writeBatch|firebase deploy)\b/);
});
