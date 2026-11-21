import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const start=html.indexOf("async function openSameAppPartnerWorkspace(user,workspaceCompanyId=\"\"){");
const end=html.indexOf("\n// The callable may commit before",start);
assert.ok(start>0&&end>start,"existing same-app partner login route must remain present");
const source=html.slice(start,end);
const errorStart=html.indexOf("function firebaseErrorMessage(error) {");
const errorEnd=html.indexOf("/* =====================================================\n   認証切り替え",errorStart);
assert.ok(errorStart>0&&errorEnd>errorStart,"original Auth error converter must remain present");
const errorFn=vm.runInNewContext(
 html.slice(errorStart,errorEnd)+"\nfirebaseErrorMessage",{}
);

function scenario({verified=true,readSuccess=true,workspace=""}={}){
 const calls=[],nodes=new Map(),user={uid:"staff-test",email:"staff@example.invalid",
   emailVerified:verified,displayName:"協力店担当"};
 const ui={loginStatus:{textContent:""},databaseStatus:{textContent:""},
   userName:{textContent:""},userEmail:{textContent:""},userRole:{textContent:""},
   appScreen:{style:{display:"none"},dataset:{}},
   verificationScreen:{style:{}},companySetupScreen:{style:{}},authScreen:{style:{}}};
 const context=vm.createContext({
   ...ui,
   auth:{currentUser:user},
   partnerMainValidId:v=>/^[A-Za-z0-9_-]{1,128}$/.test(v||""),
   partnerInlineWorkspaceCompany:"",
   partnerLeaderLastInvitation:null,partnerInlineData:null,
   partnerInlineEditingStaffId:"",
   pInline:id=>{
     if(!nodes.has(id))nodes.set(id,{hidden:true,disabled:false,textContent:"",value:""});
     return nodes.get(id);
   },
   stopRealtimeListeners:()=>calls.push("stop-finance-listeners"),
   partnerMainDate:()=> "2026-11-20",
   mountPartnerCanonicalNavigation:()=>calls.push("mount-common-navigation"),
   mountPartnerSafeManagementMenu:()=>calls.push("mount-count-only-menu"),
   partnerSameAppSelectPanel:v=>calls.push("open-"+v),
   partnerInlineFetch:async()=>{
     calls.push("verify-count-api");
     return readSuccess;
   },
   clearOwnCompanyPreference:()=>calls.push("clear-primary-preference"),
   rememberPartnerWorkspace:(uid,id)=>calls.push("remember-verified-"+id),
   rememberedPartnerWorkspace:() => workspace,
   clearRememberedPartnerWorkspace:()=>calls.push("forget-revoked"),
 });
 const go=vm.runInContext(source+"\nopenSameAppPartnerWorkspace",context);
 return {go,user,ui,nodes,calls,context};
}

test("valid partner email keeps the SAME app shell but only confirms login after callable success",async()=>{
 const s=scenario();
 assert.equal(s.ui.loginStatus.textContent,"");
 await s.go(s.user);
 assert.equal(s.ui.loginStatus.textContent,"ログイン済み・協力店");
 assert.equal(s.ui.databaseStatus.textContent,"件数API接続済み");
 assert.equal(s.ui.appScreen.dataset.partnerCountOnly,"true");
 assert.equal(s.ui.appScreen.style.display,"block");
 assert.deepEqual(s.calls,["stop-finance-listeners",
   "mount-common-navigation","mount-count-only-menu","open-record","verify-count-api"]);
 assert.equal(s.nodes.get("partnerInlineWorkspace").hidden,false);
});

test("unverified count API never labels an authenticated email as authorized to save counts",async()=>{
 const s=scenario({readSuccess:false});
 await s.go(s.user);
 assert.equal(s.ui.loginStatus.textContent,"協力店の件数利用を確認できません");
 assert.equal(s.ui.databaseStatus.textContent,"件数API認証未確認");
 assert(!s.calls.some(x=>x.startsWith("remember-")));
 assert.equal(s.ui.appScreen.dataset.partnerCountOnly,"true",
   "denial must not expose the original finance-capable dashboard");
});

test("verified secondary workspace preference is saved only on a real count API success",async()=>{
 const a=scenario({workspace:"partner-001"});
 await a.go(a.user,"partner-001");
 assert(a.calls.includes("remember-verified-partner-001"));
 const b=scenario({workspace:"partner-001",readSuccess:false});
 await b.go(b.user,"partner-001");
 assert(!b.calls.some(x=>x.startsWith("remember-")));
 assert(b.calls.includes("forget-revoked"));
 assert.equal(b.ui.loginStatus.textContent,"協力店の件数利用を確認できません");
});

test("unverified Firebase email is never marked as logged in to count UI",async()=>{
 const s=scenario({verified:false});
 await s.go(s.user);
 assert.equal(s.ui.loginStatus.textContent,"");
 assert(!s.calls.includes("verify-count-api"));
 assert.equal(s.ui.appScreen.style.display,"none");
});

test("disabled Auth reports actual stop without resetting account or offering finance access",()=>{
 const message=errorFn({code:"auth/user-disabled"});
 assert.match(message,/アカウントは停止されています/);
 assert.match(message,/自動で権限を戻すことはできません/);
 assert.equal(errorFn({code:"auth/invalid-credential"}),
   "メールアドレスまたはパスワードが正しくありません。");
 assert.doesNotMatch(source,/\b(?:setDoc|updateDoc|deleteDoc|createUser|deleteUser)\s*\(/);
 assert.doesNotMatch(source,/\b(?:loadCompanyData|loadProducts|loadRecords)\s*\(/);
});
