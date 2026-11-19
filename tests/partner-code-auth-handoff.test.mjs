import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const start=html.indexOf("async function enterIsolatedCompanyCodeSession(result){");
const end=html.indexOf('\n$("companyCodeLoginForm").onsubmit=',start);
assert(start>0&&end>start,"Safe company-code handoff must be present before both login forms");
const source=html.slice(start,end);
const TOKEN="C".repeat(43);
function setup({emailSignedIn=true,signoutError=false,signoutLeavesIdentity=false}={}){
 const events=[];
 const auth={currentUser:emailSignedIn?{uid:"old-disabled-email"}:null};
 const sessionStorage={setItem(k,v){events.push(["store",k,v]);}};
 const context=vm.createContext({
  auth,activeCodeSession:null,companyCodeSession:false,
  codeCountSessionEpoch:0,codeCountGoalByMonth:new Map([["2026-11","100"]]),pendingPartnerSaveReceipts:new Map(),countLoadId:0,countDayCache:new Map(),
  resetPartnerPublishedCountPanels:()=>events.push(["reset"]),
  clearCountOnlyDashboard:()=>events.push(["clear"]),
  signOut:async()=>{
   events.push(["signout"]);
   if(signoutError)throw Error("signout_failed");
   if(!signoutLeavesIdentity)auth.currentUser=null;
  },
  sessionStorage,
  refresh:async()=>{
   events.push(["refresh"]);
   assert.equal(auth.currentUser,null,"old Firebase identity must not share a code session");
   assert.equal(context.activeCodeSession,TOKEN);
   assert.equal(context.companyCodeSession,true);
  }
 });
 const run=vm.runInContext(source+"\nenterIsolatedCompanyCodeSession",context);
 return {run,events,context,auth};
}
test("both company-code login and activation use one fail-closed handoff",()=>{
 assert.equal((html.match(/await enterIsolatedCompanyCodeSession\(result\);/g)||[]).length,2);
 assert.equal((html.match(/activeCodeSession=result\.sessionToken/g)||[]).length,0);
 assert.match(source,/await signOut\(auth\)/);
 assert.match(source,/if\(auth\.currentUser\)throw Error\("old_email_session_still_active"\)/);
 assert(!/deleteUser\(|updateDoc\(|setDoc\(|firebase deploy/.test(source));
});
test("switching from old email signs out before enabling count-only code token",async()=>{
 const x=setup();
 await x.run({sessionToken:TOKEN});
 assert.equal(x.auth.currentUser,null);
 assert.equal(x.context.activeCodeSession,TOKEN);
 assert.equal(x.context.codeCountGoalByMonth.size,0);
 assert.deepEqual(x.events.map(y=>y[0]),["signout","reset","clear","store","refresh"]);
 assert.deepEqual(x.events[3],["store","nicoPartnerCodeSession",TOKEN]);
 assert.equal(x.context.codeCountSessionEpoch,1);
 assert.equal(x.context.countLoadId,1);
});
test("sign-out failure cannot retain mixed email and company-code identities",async()=>{
 for(const cfg of [{signoutError:true},{signoutLeavesIdentity:true}]){
  const x=setup(cfg);
  await assert.rejects(x.run({sessionToken:TOKEN}));
  assert.equal(x.context.activeCodeSession,null);
  assert.equal(x.context.companyCodeSession,false);
  assert.equal(x.events.some(y=>y[0]==="store"||y[0]==="refresh"),false);
 }
});
test("code-only sign-in does not call old email sign-out or mix financial permissions",async()=>{
 const x=setup({emailSignedIn:false});
 await x.run({sessionToken:TOKEN});
 assert.deepEqual(x.events.map(e=>e[0]),["reset","clear","store","refresh"]);
 assert.equal(x.auth.currentUser,null);
});
test("invalid code session is never stored or activated",async()=>{
 const x=setup();
 await assert.rejects(x.run({sessionToken:"bad"}),/invalid_code_session/);
 assert.deepEqual(x.events,[]);
 assert.equal(x.context.activeCodeSession,null);
});
