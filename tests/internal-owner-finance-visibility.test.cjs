"use strict";
// Guard against accidentally hiding INTERNAL owner's revenue and unit prices
// when partner-company count-only access is changed. No production connection.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const workspace=fs.readFileSync(path.join(__dirname,"../partner-workspace.html"),"utf8");
const rules=fs.readFileSync(path.join(__dirname,"../firestore.rules"),"utf8");

function getFunction(name){
 const prefix="function "+name+"(";
 const i=html.indexOf(prefix);
 assert(i>=0,"missing existing production function: "+name);
 assert.equal(html.indexOf(prefix,i+prefix.length),-1,"duplicate function "+name);
 const close=html.indexOf("\n}",i);
 assert(close>i,"unclosed production function "+name);
 return html.slice(i,close+2);
}
const helpers=["getEffectiveMasterUid","isCurrentCompanyMaster","isCurrentCompanyOwner",
 "canCurrentUserViewRevenue","canCurrentUserViewProductRevenue","canCurrentUserViewUnitPrice",
 "isMemberMaster","memberRevenuePermissionEnabled","memberUnitPricePermissionEnabled",
 "applyRevenueVisibility"];
const makeUI=()=>({
 monthlyCard:{style:{display:"none"}},
 monthlyRevenue:{closest(selector){assert.equal(selector,".summary-card");return this.__card;},__card:null},
 salesAnalysisToggle:{style:{display:"none"}},
 individualRankingToggle:{style:{display:"none"}},
 revenueChartToggle:{style:{display:"none"}},
 teamRankingRevenueButton:{style:{display:"none"}},
 teamRankingRevenueProgressButton:{style:{display:"none"}},
 salesAnalysisContent:{hidden:false},individualRankingContent:{hidden:false},revenueChartContent:{hidden:false}
});
function evaluate({uid="owner",company={ownerUid:uid,masterUid:uid,companyKind:"internal"},
 profile={uid,companyId:"c",companyRole:"owner",canViewRevenue:false,canViewUnitPrice:false}}={}){
 const ui=makeUI();
 ui.monthlyRevenue.__card=ui.monthlyCard;
 const scope={currentUser:{uid},currentCompanyData:company,currentUserData:profile,
  teamRankingMode:"revenue",...ui};
 const ctx=vm.createContext(scope);
 vm.runInContext(helpers.map(getFunction).join("\n\n"),ctx,{timeout:2000});
 return ctx;
}
test("internal owner ALWAYS sees revenue, product revenue and unit price regardless of legacy missing or false flags",()=>{
 for(const flags of [{},{canViewRevenue:false,canViewUnitPrice:false},
 {canViewRevenue:true,canViewUnitPrice:true}]){
  const profile={uid:"owner",companyId:"c",companyRole:"owner",...flags};
  for(const company of [
   {ownerUid:"owner",masterUid:"owner",companyKind:"internal"},
   {ownerUid:"owner",companyKind:"internal"},
   {ownerUid:"owner",companyKind:"direct"},
   {ownerUid:"owner"}
  ]){
   const ctx=evaluate({profile,company});
   assert.equal(ctx.isCurrentCompanyOwner(),true);
   assert.equal(ctx.canCurrentUserViewRevenue(),true);
   assert.equal(ctx.canCurrentUserViewProductRevenue(),true);
   assert.equal(ctx.canCurrentUserViewUnitPrice(),true);
   assert.equal(ctx.memberRevenuePermissionEnabled({uid:"owner",companyRole:"owner",canViewRevenue:false}),true);
   assert.equal(ctx.memberUnitPricePermissionEnabled({uid:"owner",companyRole:"owner",canViewUnitPrice:false}),true);
  }
 }
});
test("a master with legacy role still sees finance, non-owner sees it only on explicit grant",()=>{
 const master=evaluate({uid:"master",company:{ownerUid:"owner",masterUid:"master",companyKind:"internal"},
  profile:{uid:"master",companyId:"c",companyRole:"member",canViewRevenue:false,canViewUnitPrice:false}});
 assert.equal(master.isCurrentCompanyMaster(),true);
 assert.equal(master.canCurrentUserViewRevenue(),true);
 assert.equal(master.canCurrentUserViewUnitPrice(),true);
 const base={uid:"leader",companyId:"c",companyRole:"member",role:"leader"};
 const company={ownerUid:"owner",masterUid:"owner",companyKind:"internal"};
 for(const [permissions,expected] of [
  [{},[false,false,false]],
  [{canViewRevenue:false,canViewUnitPrice:true},[false,false,false]],
  [{canViewRevenue:true,canViewUnitPrice:false},[true,true,false]],
  [{canViewRevenue:true,canViewUnitPrice:true},[true,true,true]]
 ]){
  const ctx=evaluate({uid:"leader",company,profile:{...base,...permissions}});
  assert.deepEqual([ctx.canCurrentUserViewRevenue(),ctx.canCurrentUserViewProductRevenue(),
   ctx.canCurrentUserViewUnitPrice()],expected);
 }
});
test("actual revenue dashboard elements are not hidden for the internal owner",()=>{
 const ctx=evaluate();
 ctx.applyRevenueVisibility();
 for(const key of ["monthlyCard","salesAnalysisToggle","individualRankingToggle",
  "revenueChartToggle","teamRankingRevenueButton","teamRankingRevenueProgressButton"])
  assert.equal(ctx[key].style.display,"",key+" disappeared for owner");
 assert.equal(ctx.teamRankingMode,"revenue");
 const member=evaluate({uid:"leader",company:{ownerUid:"owner",companyKind:"internal"},
  profile:{uid:"leader",companyId:"c",companyRole:"member",canViewRevenue:false,canViewUnitPrice:false}});
 member.applyRevenueVisibility();
 for(const key of ["monthlyCard","salesAnalysisToggle","individualRankingToggle",
  "revenueChartToggle","teamRankingRevenueButton","teamRankingRevenueProgressButton"])
  assert.equal(member[key].style.display,"none",key+" leaked financial UI");
 assert.equal(member.teamRankingMode,"progress");
 for(const key of ["salesAnalysisContent","individualRankingContent","revenueChartContent"])
  assert.equal(member[key].hidden,true,key);
});
test("existing owner product-price editor and historical revenue data pathways remain enabled",()=>{
 const currentUI=getFunction("updateCurrentUserUI");
 const dashboard=getFunction("renderDashboard");
 const graph=getFunction("renderRevenueChart");
 assert.match(currentUI,/managementProductButton\.style\.display\s*=\s*canViewRevenue\s*&&\s*canCurrentUserViewUnitPrice\(\)/);
 assert.match(currentUI,/applyRevenueVisibility\(\)/);
 assert.match(dashboard,/applyRevenueVisibility\(\)/);
 assert.match(graph,/if\s*\(\s*!canCurrentUserViewRevenue\(\)/);
 assert.match(dashboard,/monthlyRevenue\.textContent/);
 assert.match(html,/id="monthlyRevenue"/);
 assert.match(html,/id="managementProductButton"/);
 assert.match(html,/id="revenueChartToggle"/);
 // No changing the historical product pricing computation or sales records.
 assert.match(html,/function currentCatalogRevenuePerUnit\(/);
 assert.match(html,/function getDisplayRecordResults\(/);
});
test("existing login allows legitimate internal owner and blocks partner from legacy finance UI",async()=>{
 const {classifyLegacySalesEntrypoint}=await import("../legacy-finance-entry-guard.mjs");
 const identity={uid:"internalOwner",companyId:"internal",active:true,companyRole:"owner",role:"leader"};
 const request={
  uid:identity.uid,authEmailVerified:true,
  user:{...identity,canViewRevenue:false,canViewUnitPrice:false},
  member:{...identity,canViewRevenue:false,canViewUnitPrice:false},
  company:{active:true,companyKind:"internal",ownerUid:identity.uid}
 };
 assert.equal(classifyLegacySalesEntrypoint(request).mode,"internal");
 for(const mutation of [
  r=>r.company.companyKind="partner",
  r=>r.user.accessKind="partner",
  r=>r.member.memberType="cooperator"
 ]){
  const clone=structuredClone(request);
  mutation(clone);
  assert.equal(classifyLegacySalesEntrypoint(clone).mode,"partner");
 }
 assert.match(html,/const checkedEntry=await checkLegacyEntryAgainstServer\(user\);/);
 assert.match(html,/if\s*\(checkedEntry\.mode!=="internal"\)/);
 assert.match(html,/showLegacyFinanceEntryBlocked\(checkedEntry\.mode\)/);
 assert.match(workspace,/submitPartnerWorkspaceCounts/);
 assert.doesNotMatch(workspace,/firebase-firestore\.js|getFirestore\(|revenuePerUnit|unitPrice|totalRevenue/);
});
test("this protection cannot deploy or alter production Firestore Rules",()=>{
 assert.match(rules,/match \/products\/\{productId\}/);
 assert.match(rules,/match \/records\/\{recordId\}/);
 assert.match(rules,/function isCompanyMember\(companyId\)/);
 const release=fs.readFileSync(path.join(__dirname,"../.github/workflows/firebase-production-deploy.yml"),"utf8");
 assert.match(release,/workflow_dispatch:/);
 assert.doesNotMatch(release,/\n\s+push:/);
});
