import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const service=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const scope=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
test("one canonical sales app hosts eight count-only navigation slots without mounting finance panels",()=>{
 assert.match(html,/<main id="appScreen">/);
 const nav=scope('id="partnerSameAppNavigation"','id="partnerPanelMembers"');
 for(const p of ["record","individual","product","team","detail","daily","history","members"])
  assert.match(nav,new RegExp('data-partner-panel="'+p+'"'));
 for(const id of ["partnerPanelRecord","partnerPanelRankings","partnerPanelDetail",
  "partnerPanelDaily","partnerPanelHistory","partnerPanelMembers"])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] > :not\(\.user-bar\):not\(#partnerInlineWorkspace\)\{display:none!important\}/);
 assert.match(html,/function partnerSameAppSelectPanel\(name\)/);
 assert.match(html,/stopRealtimeListeners\(\)/);
});
test("original owner team-detail dashboard groups count-only partner teams by company",()=>{
 for(const id of ["allTeamsOverviewContent","allTeamsOverviewList","ownerPartnerDashboardDetails",
  "ownerPartnerDashboardList","ownerPartnerDashboardDate","ownerPartnerDashboardRefresh"])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 const section=scope("let ownerPartnerDashboardNonce=0;","async function showPartnerInviteAtMain(");
 assert.match(section,/if\(!canLoadPartnerRanking\(\)\)/);
 assert.match(section,/readPartnerWorkDay\(\{date,partnerCompanyId:company.partnerCompanyId\}\)/);
 assert.match(section,/info\?\.scope!=="shared_counts_only"/);
 assert.match(section,/for\(const team of info.teams\)/);
 assert.match(section,/for\(const \[key,n\] of Object.entries\(team.counts\)\)/);
 for(const bad of ["getDoc(","getDocs(","collection(db,","setDoc(","updateDoc(","deleteDoc("])
  assert.ok(!section.includes(bad),bad);
});
test("partner count-only server never reads original finance documents or exposes their prices",()=>{
 assert.doesNotMatch(service,/\bdb\.collection\("(?:products|records|recordCorrections|revenueGoals)"\)/);
 const part=scope("const partnerCountFunctions =","/* =====================================================\n   DOM");
 assert.match(part,/httpsCallable\(partnerCountFunctions,"getPartnerWorkspace"\)/);
 assert.match(part,/httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(service,/scope:"shared_counts_only"/);
 assert.match(service,/staffNameSnapshot/);
 assert.match(service,/row\.members\.push\(\{name:safeName,totalCount:item.total,counts:\{\.\.\.item.counts\}\}\)/);
});
test("owner finance view and employee login remain intact; partner invite has Firebase verification then password",()=>{
 assert.match(html,/function canCurrentUserViewRevenue\(/);
 assert.match(html,/function canCurrentUserViewRevenueForTeam\(/);
 assert.match(html,/await signInWithEmailAndPassword\(/);
 assert.match(html,/sendSignInLinkToEmail\(auth,latest.email,partnerInviteAuthSettings\(latest\)\)/);
 assert.match(html,/await signInWithEmailLink\(auth,email,location.href\)/);
 assert.match(html,/await updatePassword\(user,pass\)/);
 assert.match(html,/partnerInlineAccept\(\{token:invite.token,name,transferCurrentCompany:false\}\)/);
});
