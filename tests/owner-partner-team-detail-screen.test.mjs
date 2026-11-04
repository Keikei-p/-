import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
function segment(from,to){
 const i=html.indexOf(from),j=html.indexOf(to,i);
 assert.ok(i>=0&&j>i,"missing boundary: "+from);
 return html.slice(i,j);
}

test("original sales team's own overview and owner financial views remain separate",()=>{
 assert.match(html,/function renderAllTeamsOverview\(/);
 assert.match(html,/function renderSelectedTeamMemberDetail\(/);
 assert.match(html,/function canCurrentUserViewRevenue\(/);
 assert.match(html,/function canCurrentUserViewRevenueForTeam\(/);
 assert.equal((html.match(/id="ownerPartnerDashboardDetails"/g)||[]).length,1);
 assert.equal((html.match(/id="allTeamsOverviewList"/g)||[]).length,1);
 const panel=segment('id="allTeamsOverviewContent"','id="productSummaryContent"');
 assert.ok(panel.indexOf('id="allTeamsOverviewList"')<panel.indexOf('id="ownerPartnerDashboardDetails"'));
 assert.ok(panel.includes("id=\"ownerPartnerDashboardSummary\""));
 assert.ok(panel.includes("id=\"ownerPartnerDashboardList\""));
 assert.ok(panel.includes("id=\"ownerSharedRankingsRefresh\""));
 assert.ok(panel.includes("<details"),"advanced combined ranks remain available");
});

test("owner team tab automatically fetches company counts while allowing manual refresh",()=>{
 const view=segment('// Owner-only, on-demand counts from the existing isolated callable.',
  'async function showPartnerInviteAtMain(user,invite){');
 for(const marker of [
  'async function loadOwnerPartnerDetails(){',
  'allTeamsOverviewToggle.addEventListener("click"',
  '!allTeamsOverviewContent.hidden&&canLoadPartnerRanking()',
  'pInline("ownerPartnerDashboardRefresh").onclick=()=>void refreshOwnerCountManagement()',
  'ownerPartnerDashboardDate',
  'const response=(await readPartnerWorkDay({date})).data',
  'report.totalCount+"件"',
  '未報告',
  'reports.has(item.partnerCompanyId)',
  'reports.keys()',
 ]) assert.ok(view.includes(marker),"missing "+marker);
 assert.ok(view.includes('pInline("ownerPartnerDashboardDate").value===date'));
 assert.match(view,/currentUser\?\.uid===uid/);
 assert.match(view,/response.date!==date/);
});

test("every disclosed team and person count is validated before display",()=>{
 const view=segment('// Owner-only, on-demand counts from the existing isolated callable.',
  'async function showPartnerInviteAtMain(user,invite){');
 for(const marker of [
  'readPartnerWorkDay({date,partnerCompanyId:company.partnerCompanyId})',
  'info?.scope!=="shared_counts_only"',
  'info.unreconciledWithCompanyReport===true',
  'team.members.length!==team.reportedStaffCount',
  'personTotal!==person.totalCount',
  'staffTotal!==team.totalCount',
  'productTotal!==team.totalCount',
  'teamTotal!==info.verifiedSharedCount',
  'partnerMainAppendRow(member,key,n+"件")',
  'partnerMainAppendRow(products,key,n+"件")',
  'loaded=true',
 ]) assert.ok(view.includes(marker),"missing "+marker);
 for(const forbidden of ['getDoc(', 'getDocs(', 'collection(db,','setDoc(', 'updateDoc(', 'deleteDoc(',
  'totalRevenue','unitPrice','revenuePerUnit','localStorage'])
  assert.ok(!view.includes(forbidden),"unsafe access "+forbidden);
 assert.match(server,/partnerTeamDetails=\{/);
 assert.match(server,/scope:"shared_counts_only"/);
 assert.match(server,/staffNameSnapshot/);
 assert.match(server,/summaryRef\(s.hubId,date,s.cid\)/);
});

test("partner dashboard count entry, direct rankings and permissions are unchanged",()=>{
 assert.match(html,/function partnerInlineRenderCounts\(\)/);
 assert.match(html,/id="pInlineCountFields" class="product-input-list"/);
 assert.match(html,/id="partnerSameAppNavigation"/);
 assert.match(html,/function loadSharedDailyStandings\(/);
 assert.match(html,/function canLoadPartnerRanking\(/);
 assert.match(html,/id="ownerPartnerDashboardDetails"[^>]*hidden/);
 assert.match(html,/\.owner-partner-company-list\{display:grid;gap:10px/);
 assert.match(html,/\.owner-partner-summary\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
