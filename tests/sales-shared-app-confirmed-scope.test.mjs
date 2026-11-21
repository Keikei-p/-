import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
import {proposeSecondaryFinanceFence,originalRules} from
  "../security/secondary-finance-read-fence.mjs";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const file=name=>readFileSync(join(root,name),"utf8");
const spec=file("docs/SALES_SHARED_APP_CONFIRMED_SCOPE_20261120.md");
const html=file("index.html");
const workspace=file("partner-workspace.html");
const partnerService=file("functions-partner-workspace/service.cjs");
const countSource=file("functions-ranking-approvals/ranking/partner-workspace-count-source.mjs");
const repoFinanceRules=file("firestore.rules");
const firebase=JSON.parse(file("firebase.json"));

test("2026-11-20 approved one-app design is the protected integration scope",()=>{
  assert.match(spec,/自社ダッシュボードは完成品/);
  assert.match(spec,/アプリは1つ、実績入力の場所も同じ/);
  assert.match(spec,/別の入力アプリ・別ダッシュボードを新規設計しない/);
  assert.match(spec,/以前の「自社・協力店で別ダッシュボードを新規開発する」提案より優先する/);
  assert.match(spec,/一切表示しない・APIで返さない・Firestoreで読ませない/);
  assert.match(spec,/移行・再投入・リセット・二重計上を行わない/);
  assert.match(spec,/自社の金融表示や保存・計算を削除\/停止しない/);
});

test("existing completed internal dashboard, prices and owner money view stay intact",()=>{
  for(const name of ["renderDashboard","getDisplayRecordResults",
    "currentCatalogRevenuePerUnit","canCurrentUserViewRevenue",
    "canCurrentUserViewUnitPrice","applyRevenueVisibility"]){
    assert.ok(html.includes("function "+name+"("),"missing completed internal logic: "+name);
  }
  for(const id of ["monthlyRevenue","managementProductButton","revenueChartToggle"]){
    assert.ok(html.includes('id="'+id+'"'),"missing existing self dashboard: "+id);
  }
  assert.match(html,/monthlyRevenue\.textContent/);
});

test("partner uses the SAME index and existing count-only callable, no new app",()=>{
  assert.match(html,/partnerInlineWorkspace/);
  assert.match(html,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
  assert.match(html,/getPartnerWorkspace/);
  assert.match(html,/NICO_PARTNER_TAB_UI_ENABLED = false/);
  assert.match(html,/NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false/);
  assert.match(html,/NICO_SAME_APP_JOINT_HTTP_ENABLED = false/);
  assert.match(workspace,/submitPartnerWorkspaceCounts/); // old links remain usable
});

test("legacy partner counts, private products and audit history remain readable for projection",()=>{
  for(const v of ["partnerWorkEntries","privateCounts","privateTotalCount"]){
    assert.ok(partnerService.includes(v),"missing existing partner ledger: "+v);
    assert.ok(countSource.includes(v),"lost existing count read-only projection: "+v);
  }
  assert.match(partnerService,/partnerWorkAudits/);
  assert.match(spec,/一意な完全一致/);
  assert.match(spec,/光\/AIR合算ルール/);
});

test("partner clients have no direct finance SDK route, internal route remains unchanged",()=>{
  assert.doesNotMatch(workspace,/firebase-firestore\.js|getFirestore\(|revenuePerUnit|unitPrice|totalRevenue/);
  assert.doesNotMatch(partnerService,/\bdb\.collection\((?:"|'|`)(?:products|records|recordCorrections|revenueGoals)(?:"|'|`)/);
  assert.match(repoFinanceRules,/match \/products\/\{productId\}/);
  assert.match(repoFinanceRules,/match \/records\/\{recordId\}/);
  assert.match(repoFinanceRules,/match \/recordCorrections\/\{correctionId\}/);
  assert.match(repoFinanceRules,/match \/revenueGoals\/\{goalId\}/);
  assert.equal(firebase.firestore.rules,"firestore.rules");
});

test("actual PR Firebase Rules match the exact reviewed money-denial candidate",()=>{
  const current=file("firestore.rules"),baseline=originalRules();
  assert.notEqual(current,baseline,"old secondary finance gap is still present");
  assert.equal(current,proposeSecondaryFinanceFence(baseline),
    "only the 4 reviewed finance collections may be narrowed");
  assert.equal(firebase.firestore.rules,"firestore.rules");
  assert.match(current,/function activeSecondaryPartnerContext\(\)/);
  for(const collection of ["products","records","recordCorrections","revenueGoals"]){
    const start=current.indexOf("match /"+collection+"/{");
    const end=current.indexOf("\n    match /",start+7);
    const body=current.slice(start,end<0?undefined:end);
    assert.match(body,/&& !activeSecondaryPartnerContext\(\)/,collection);
  }
});

test("confirmed scope is NOT a live denial proof or deploy authorization",()=>{
  assert.match(spec,/実アカウントでの金額完全遮断と件数連携は未証明/);
  assert.match(spec,/証拠が揃うまで本番切替を成功扱いしない/);
});
