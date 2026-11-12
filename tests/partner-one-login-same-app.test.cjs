"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const vm=require("node:vm");
const load=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const index=load("index.html"),partner=load("partner-workspace.html"),
 legacyCompanyInvite=load("partner-invite.html"),
 service=load("functions-partner-workspace/service.cjs"),
 rules=load("firestore.rules");
test("existing app sign-in is reused for company and member invitations",()=>{
 assert.match(index,/onAuthStateChanged\(\s*auth,/);
 assert.match(index,/const pendingPartnerInvite=partnerMainPendingInvite\(\)/);
 assert.match(index,/await showPartnerInviteAtMain\(user,pendingPartnerInvite\)/);
 assert.match(index,/await openSameAppPartnerWorkspace\(user,partnerWorkspaceId\)/);
 assert.match(index,/partnerCompanyInvite/);
 assert.match(index,/partnerStaffInvite/);
 assert.match(index,/partnerMainAcceptCompanyInvite\(\{token:invite\.token\}\)/);
 assert.match(index,/partnerInlineAccept\(\{token:invite\.token,name,transferCurrentCompany:false\}\)/);
 assert.match(index,/showLegacyFinanceEntryBlocked\(checkedEntry.mode\)/);
 assert.match(index,/if\(mode==="partner"&&auth.currentUser\?\.emailVerified\)/);
 assert.match(index,/void openSameAppPartnerWorkspace\(auth.currentUser\)/);
 assert.match(index,/location\.replace\(url\.href\)/);
 assert.match(legacyCompanyInvite,/target\.searchParams\.set\("partnerCompanyInvite",token\)/);
 assert.match(index,/url\.searchParams\.set\("partnerStaffInvite",response\.token\)/);
 // The pinned legacy workspace remains untouched; new links from the normal
 // app use the unified login, while older URLs remain backwards compatible.
 assert.match(partner,/url\.searchParams\.set\("invite",result\.token\)/);
});
test("verified partner profiles enter the existing count-only app before internal financial rules checks",()=>{
 const body=index.slice(index.indexOf("async function loadUserData("),index.indexOf("/* =====================================================\n   個人テーマ"));
 assert.match(body,/const userSnap =\s*await getDocFromServer\(\s*userRef/);
 const partnerRoute=body.indexOf('currentUserData.accessKind === "partner"');
 const legacyProbe=body.indexOf('await checkLegacyEntryAgainstServer(user)');
 assert.ok(partnerRoute>=0&&legacyProbe>partnerRoute,"partner cannot use internal-company Firestore probe");
 assert.match(body,/currentUserData.canViewRevenue !== false/);
 assert.match(body,/currentUserData.canViewUnitPrice !== false/);
 assert.match(body,/await openSameAppPartnerWorkspace\(user\)/);
 assert.match(body,/showLegacyFinanceEntryBlocked\("blocked"\)/);
});
test("partner view is inside same app but legacy finance children are inaccessible",()=>{
 assert.match(index,/<main id="appScreen">/);
 assert.match(index,/id="partnerInlineWorkspace"/);
 assert.match(index,/#appScreen\[data-partner-count-only="true"\] > :not\(\.user-bar\):not\(#partnerInlineWorkspace\)\{display:none!important\}/);
 assert.match(index,/appScreen\.dataset\.partnerCountOnly="true"/);
 assert.match(index,/stopRealtimeListeners\(\)/);
 assert.match(index,/const partnerInlineManage = httpsCallable\(partnerCountFunctions,"managePartnerWorkspace"\)/);
 assert.match(index,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(index,/partnerInlineData=snap;partnerInlineRender\(\)/);
 assert.match(index,/const snap=\(await readPartnerWorkDay\(payload\)\)\.data/);
 assert.match(index,/await partnerInlineManage\(partnerInlinePayload\(\{action:"addManaged",name,teamId\}\)\)/);
 assert.match(index,/action:"createInvite",email,teamId,role/);
 assert.match(index,/partnerInlineSave\(partnerInlinePayload\(\{/);
 assert.match(index,/verified=\(await readPartnerWorkDay\(partnerInlinePayload\(\{date\}\)\)\)\.data/);
 assert.match(index,/const readback=partnerSavedCountReadbackState\(verified,expected\)/);
 assert.match(index,/result\.version!==expected\.expectedVersion\+1\|\|readback!=="saved"/);
 assert.match(index,/pInline\("pInlineTitle"\)\.textContent="🤝 "\+snap\.companyName/);
 assert.match(index,/snap\.companyName\+"・"\+t\.name/);
 assert.match(index,/id="pInlineRanking"/);
 assert.match(index,/id="pInlineTeams"/);
 assert.match(index,/id="pInlineManagedName"/);
 assert.match(index,/id="pInlineInviteEmail"/);
 assert.doesNotMatch(index.slice(index.indexOf("// NICO partner: same Firebase email sign-in"),index.indexOf("/* =====================================================\n   Auth状態")),/getDocs\(|onSnapshot\(|getFirestore\(|collection\(db,"(?:products|records|recordCorrections|revenueGoals)"/);
});
test("same-app save readback requires the exact persisted identity, version, count and snapshots",()=>{
 const start=index.indexOf("function partnerSavedCountReadbackState(");
 const end=index.indexOf("function partnerCountSaveFailureMessage(",start);
 assert(start>0&&end>start);
 const context=vm.createContext({PARTNER_NURO_CB_TIERS:[0,20000]});
 vm.runInContext(index.slice(start,end),context);
 const expected={date:"2026-11-13",companyName:"検証会社",staffId:"worker",
  expectedVersion:0,categories:["NURO","SBMNP"],counts:{NURO:2,SBMNP:1},
  cbCounts:{NURO:{0:1,20000:1}},privateCounts:{privateOne:2},
  workLocation:"検証現場",workTeamId:"team"};
 const verified={date:expected.date,companyName:expected.companyName,records:[{
  staffId:"worker",version:1,counts:{...expected.counts},cbCounts:structuredClone(expected.cbCounts),
  privateCounts:{...expected.privateCounts},totalCount:3,
  workLocation:expected.workLocation,teamIdSnapshot:"team"}]};
 assert.equal(context.partnerSavedCountReadbackState(verified,expected),"saved");
 const mutations=[
  x=>{x.date="2026-11-12";},x=>{x.companyName="別会社";},
  x=>{x.records[0].staffId="other";},x=>{x.records[0].version=2;},
  x=>{x.records[0].counts.NURO=1;},x=>{x.records[0].counts.SBMNP=1.5;},
  x=>{x.records[0].cbCounts.NURO[20000]=0;},
  x=>{x.records[0].privateCounts.privateOne=1;},x=>{x.records[0].totalCount=4;},
  x=>{x.records[0].workLocation="別現場";},x=>{x.records[0].teamIdSnapshot="other";}
 ];
 for(const mutate of mutations){
  const changed=structuredClone(verified);mutate(changed);
  assert.notEqual(context.partnerSavedCountReadbackState(changed,expected),"saved");
 }
 const unchanged=structuredClone(verified);unchanged.records[0].version=0;
 assert.equal(context.partnerSavedCountReadbackState(unchanged,expected),"not_saved");
 assert.equal(context.partnerSavedCountReadbackState({...verified,records:[]},
  {...expected,expectedVersion:1}),"unknown","a missing correction is not a saved zero");
});

test("same-app save verifies by GET once and never retries or reports unverified success",async()=>{
 const a=index.indexOf("function partnerSavedCountReadbackState(");
 const b=index.indexOf("function partnerCountSaveFailureMessage(",a);
 const start=index.indexOf('function partnerInlineCountsUnchanged(');
 const end=index.indexOf("// Original internal owner sees existing teams PLUS partner-company teams.",start);
 assert(a>0&&b>a&&start>0&&end>start);
 for(const scenario of ["saved","mismatch","ack_missing","lost_response_saved","denied_not_saved","identity_changed"]){
  const date="2026-11-13",calls=[],controls={
   pInlineSave:{},pInlineStaff:{value:"worker"},pInlineDate:{value:date},
   pInlineRecordDate:{value:date},pInlineWorkLocation:{value:"現場"},
   pInlineWorkingTeam:{value:"team"},pInlineCountFields:{querySelectorAll:()=>[]}
  };
  const denial=Object.assign(Error("denied"),{code:"functions/permission-denied"});
  const context=vm.createContext({
   pInline:id=>controls[id],PARTNER_NURO_CB_TIERS:[0,20000],
   auth:{currentUser:{uid:"worker"}},partnerInlineWorkspaceCompany:"partner",
   partnerInlineData:{date,companyName:"検証会社",role:"member",categories:["NURO"],
    staff:[{id:"worker",active:true,teamId:"team"}],teams:[{id:"team",active:true}],records:[]},
   partnerMainValidId:x=>/^[A-Za-z0-9_-]+$/.test(x),
   partnerInlineSelectedCb:()=>({total:2,result:{0:2}}),
   partnerInlinePayload:data=>({...data,workspaceCompanyId:"partner"}),
   partnerInlineRun:(work,options)=>{assert.equal(options.kind,"save");return work();},
   partnerInlineSave:async input=>{
    calls.push("save");assert.equal(input.date,date);assert.equal(input.counts.NURO,2);
    if(scenario==="identity_changed")context.auth.currentUser={uid:"other"};
    if(scenario==="denied_not_saved")throw denial;
    if(scenario==="lost_response_saved")throw Object.assign(Error("timeout"),{code:"functions/unavailable"});
    return {data:{saved:scenario!=="ack_missing",date,staffId:"worker",version:1}};
   },
   readPartnerWorkDay:async input=>{
    calls.push("get");assert.equal(input.date,date);
    return {data:{date,companyName:"検証会社",records:scenario==="denied_not_saved"?[]:[{
     staffId:"worker",version:1,counts:{NURO:scenario==="mismatch"?1:2},
     cbCounts:{NURO:{0:2}},privateCounts:{},totalCount:2,workLocation:"現場",teamIdSnapshot:"team"}]}};
   }
  });
  vm.runInContext(index.slice(a,b)+index.slice(start,end),context);
  if(scenario==="saved"||scenario==="lost_response_saved"){
   assert.match(await controls.pInlineSave.onclick(),/^✅ 実績を登録できました！$/);
  }else{
   await assert.rejects(controls.pInlineSave.onclick(),
    e=>scenario==="denied_not_saved"?e===denial:e.message==="save_verify");
  }
  assert.deepEqual(calls,scenario==="identity_changed"?["save"]:["save","get"],
   "the original draft is reconciled read-only, never resubmitted automatically");
  assert.equal(controls.pInlineWorkLocation.value,"現場");
 }
});
test("company-team presentation only reads owner-authorized money-free API, not writable internal teams",()=>{
 assert.match(index,/id="ownerPartnerTeamGroups"/);
 assert.match(index,/void loadOwnerPartnerCompanyTeams\(\)/);
 assert.match(index,/if\(!auth\.currentUser\|\|!isCurrentCompanyOwner\(\)/);
 assert.match(index,/readPartnerWorkDay\(\{date:partnerMainDate\(\)\}\)/);
 assert.match(index,/Array\.isArray\(result\.registeredCompanies\)/);
 assert.match(index,/company\.name\+"・"\+team\.name/);
 assert.match(index,/協力店の班を読み込めません/);
 assert.doesNotMatch(index.slice(index.indexOf("async function loadOwnerPartnerCompanyTeams("),index.indexOf("async function showPartnerInviteAtMain")),/\b(?:setDoc|updateDoc|writeBatch|addDoc|deleteDoc)\(/);
});
test("server owns partner roles and never returns financial data and scopes management to the verified partner company",()=>{
 assert.match(service,/if\(s\.kind!=="partner"\|\|s\.role==="member"\)fail\(\)/);
 assert.match(service,/if\(op==="addManaged"\)/);
 assert.match(service,/return \{role:s\.role,date,companyName:clean\(s\.companyName\),teamId:s\.teamId,/);
 assert.match(service,/privateProducts:productList/);
 assert.doesNotMatch(service,/\bdb\.collection\("(?:records|products|revenueGoals|recordCorrections)"\)/);
 assert.match(rules,/company\.get\('companyKind', 'internal'\) == 'internal'/);
});

test("partner company list errors are explicit, fail closed and never create a replacement company",()=>{
 const i=index.indexOf("async function loadDirectPartnerInviteCompanies()");
 const e=index.indexOf('document.getElementById("partnerInviteCompanyName").onchange=',i);
 assert(i>0&&e>i);
 const flow=index.slice(i,e);
 assert.match(flow,/code==="functions\/not-found"\|\|code==="functions\/unimplemented"/);
 assert.match(flow,/code==="functions\/permission-denied"/);
 assert.match(flow,/code==="functions\/unauthenticated"/);
 assert.match(flow,/partnerInviteCreateButton"\)\.disabled=true/);
 assert.match(flow,/partnerInviteCompanyName"\)\.replaceChildren\(\)/);
 assert.match(flow,/partner_company_list_unavailable/);
 assert.doesNotMatch(flow,/partnerInlineManage\(|tx\.create\(|setDoc\(/);
 assert.match(index,/if\s*\(!currentUser\?\.emailVerified\s*\|\|/);
});
