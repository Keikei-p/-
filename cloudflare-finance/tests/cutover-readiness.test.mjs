import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const get=f=>readFileSync(path.join(root,f),"utf8");
const live=get("index.html");
const liveRules=get("firestore.rules");
const preview=get("cloudflare-finance/preview/index.html");
const stagedRules=get("cloudflare-finance/finance-locked.rules");
const gateway=get("cloudflare-finance/src/index.js");
const cfg=get("cloudflare-finance/wrangler.toml");

function requireText(source,text,label){
  assert.ok(source.includes(text),label+" missing");
}
function sourceBlock(source,begin,end){
  const at=source.indexOf(begin);
  assert.ok(at>=0,"missing "+begin);
  const finish=end?source.indexOf(end,at+begin.length):source.length;
  assert.ok(finish>at,"missing end of "+begin);
  return source.slice(at,finish);
}

test("Live sales UI remains untouched by protected-preview cutover",()=>{
  assert.ok(!live.includes("SAFE_FINANCE_CUTOVER"));
  assert.ok(!live.includes("makeProtectedSalesBridge"));
  assert.ok(liveRules.includes("match /records/{recordId}"));
  // The existing UI remains usable until BOTH hosts are proved compatible.
  requireText(preview,"const SAFE_FINANCE_CUTOVER = false;","preview is locked");
  requireText(preview,'const SAFE_FINANCE_ENDPOINT = "";',"preview endpoint is blank");
  requireText(cfg,'FINANCE_GATEWAY_ENABLED = "disabled"',"gateway read lock");
  requireText(cfg,'FINANCE_WRITE_ENABLED = "disabled"',"gateway write lock");
  requireText(cfg,'FINANCE_WRITE_APPROVAL = "NOT_APPROVED"',"dual-host backup gate");
  requireText(cfg,'FINANCE_COST_APPROVAL = "NOT_APPROVED"',"Blaze cost gate");
});

test("Production cutover must not accidentally re-enable legacy raw financial listeners",()=>{
  const listeners=sourceBlock(preview,"function startRealtimeListeners() {","function stopRealtimeListeners(");
  requireText(listeners,"if (SAFE_FINANCE_CUTOVER) {","secure data subscription branch");
  requireText(listeners,"makeProtectedSalesBridge({","secure gateway bridge");
  requireText(listeners,"if (!SAFE_FINANCE_CUTOVER) {","legacy records fenced when secure");
  requireText(listeners,"SAFE_FINANCE_CUTOVER ? null : revenueGoalsCollectionQuery()","legacy revenue goals fenced");
  const load=sourceBlock(preview,"async function loadProducts(","/* =====================================================\n   メンバー");
  requireText(load,"if(SAFE_FINANCE_CUTOVER)","secure initial product load");
  requireText(load,"projectSafeView(await getSafeFinancialView({","secure early-view projection");
  const loadRecords=sourceBlock(preview,"async function loadRecords()","/* =====================================================\n   月選択肢");
  requireText(loadRecords,"if(SAFE_FINANCE_CUTOVER)","secure records refresh");
});

test("Count saves and record deletions are always intercepted in protected mode",()=>{
  const saveAt=preview.indexOf("// Preview protected path: do not directly read/write monetary Firestore.");
  const legacyAt=preview.indexOf("const recordRef =",saveAt);
  assert.ok(saveAt>=0 && legacyAt>saveAt);
  const protectedSave=preview.slice(saveAt,legacyAt);
  requireText(protectedSave,"if(SAFE_FINANCE_CUTOVER)","protected save first");
  requireText(protectedSave,"await safeFinanceBridge.submit({","count-only server submit");
  assert.match(protectedSave,/showSuccess\("実績を安全に保存しました。"\);\s*return;/);
  const remove=sourceBlock(preview,"async function deleteRecord(","function formatDateJapanese(");
  const marker=remove.indexOf("if(SAFE_FINANCE_CUTOVER)");
  const oldDelete=remove.indexOf("await deleteDoc(");
  assert.ok(marker>=0 && oldDelete>marker);
  assert.match(remove.slice(marker,oldDelete),/showError\("履歴保護中のため/);
  assert.match(remove.slice(marker,oldDelete),/return;/);
});

test("Protected gateway fails closed rather than silently using raw Firestore",()=>{
  requireText(gateway,'FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS"',"Blaze read/write guard");
  assert.ok(gateway.split('FINANCE_COST_APPROVAL!=="OWNER_APPROVED_BLAZE_COSTS"').length>=3,
    "read and write endpoints must each enforce cost review");
  requireText(stagedRules,"match /records/{recordId}","locked records must exist");
  requireText(stagedRules,"match /products/{productId}","locked products must exist");
  requireText(stagedRules,"match /recordCorrections/{correctionId}","locked history must exist");
});
