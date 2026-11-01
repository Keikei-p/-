"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
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
 const body=index.slice(index.indexOf("async function loadUserData("),index.indexOf("/* =====================================================\\n   個人テーマ"));
 assert.match(body,/const userSnap =\\s*await getDocFromServer\\(\\s*userRef/);
 const partnerRoute=body.indexOf('currentUserData.accessKind === "partner"');
 const legacyProbe=body.indexOf('await checkLegacyEntryAgainstServer(user)');
 assert.ok(partnerRoute>=0&&legacyProbe>partnerRoute,"partner cannot use internal-company Firestore probe");
 assert.match(body,/currentUserData.canViewRevenue !== false/);
 assert.match(body,/currentUserData.canViewUnitPrice !== false/);
 assert.match(body,/await openSameAppPartnerWorkspace\\(user\\)/);
 assert.match(body,/showLegacyFinanceEntryBlocked\\("blocked"\\)/);
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
 assert.match(index,/const verified=\(await readPartnerWorkDay\(partnerInlinePayload/);
 assert.match(index,/snap\.categories\.some\(key=>saved\.counts\?\.\[key\]!==counts\[key\]\)/);
 assert.match(index,/pInline\("pInlineTitle"\)\.textContent="🤝 "\+snap\.companyName/);
 assert.match(index,/snap\.companyName\+"・"\+t\.name/);
 assert.match(index,/id="pInlineRanking"/);
 assert.match(index,/id="pInlineTeams"/);
 assert.match(index,/id="pInlineManagedName"/);
 assert.match(index,/id="pInlineInviteEmail"/);
 assert.match(index,/pInline\("pInlineInviteRole"\)\.querySelector\('option\[value="leader"\]'\)\.disabled=snap\.role!=="owner"/);
 assert.match(index,/if\(snap\.role==="leader"&&pInline\("pInlineInviteRole"\)\.value==="leader"\)/);
 assert.doesNotMatch(index.slice(index.indexOf("// NICO partner: same Firebase email sign-in"),index.indexOf("/* =====================================================\n   Auth状態")),/getDocs\(|onSnapshot\(|getFirestore\(|collection\(db,"(?:products|records|recordCorrections|revenueGoals)"/);
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
test("server owns partner roles and never returns financial data or permits leaders to invite leaders",()=>{
 assert.match(service,/if\(s\.kind!=="partner"\|\|s\.role==="member"\)fail\(\)/);
 assert.match(service,/if\(op==="addManaged"\)/);
 assert.match(service,/const teamId=s\.role==="owner"\?clean\(d\.teamId\):fresh\.teamId/);
 assert.match(service,/s\.role!=="owner"&&\(d\.role!=="member"\|\|d\.teamId!==s\.teamId\)/);
 assert.match(service,/return \{role:s\.role,date,companyName:clean\(s\.companyName\),teamId:s\.teamId,/);
 assert.match(service,/privateProducts:productList/);
 assert.doesNotMatch(service,/\bdb\.collection\("(?:records|products|revenueGoals|recordCorrections)"\)/);
 assert.match(rules,/company\.get\('companyKind', 'internal'\) == 'internal'/);
});
