/**
 * User-approved production preservation contract (2026-11-21).
 *
 * The original internal NICO SALES app is already complete. Partner users
 * may enter count-only records in the SAME index.html, but absolutely no
 * internal owner/dashboard/record form/finance/ranking UI may be redesigned.
 *
 * Compare original source sections to the exact reviewed production main
 * commit. Any modification is a hard CI failure requiring a separate,
 * explicit owner-approved internal app change. NEVER alter business data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const APPROVED_INTERNAL_MAIN="ff3c024a18c48a0f0b95fa672b860c8dfe98805e";
const current=readFileSync(join(root,"index.html"),"utf8");
const original=execFileSync("git",[
 "show",APPROVED_INTERNAL_MAIN+":index.html"
],{cwd:root,encoding:"utf8",maxBuffer:4*1024*1024,timeout:15000});

function exactlyBetween(source,start,end){
 const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
 assert(i>=0&&j>i,"missing reviewed original sales region: "+start);
 assert.equal(source.indexOf(start,i+1),-1,"duplicate original boundary: "+start);
 return source.slice(i,j);
}
test("the ENTIRE original internal record form and dashboard markup is identical to production",()=>{
 const begin='id="recordManagement"',end='<script type="module">';
 assert.equal(exactlyBetween(current,begin,end),exactlyBetween(original,begin,end),
  "Do not change even the position or appearance of the complete internal sales UI");
});
test("the original internal finance, dashboard and all ranking renderers are byte-identical",()=>{
 const regions=[
  ["function applyRevenueVisibility() {","function renderDashboard() {"],
  ["function renderDashboard() {","</script>"]
 ];
 for(const [start,end] of regions){
  assert.equal(exactlyBetween(current,start,end),exactlyBetween(original,start,end),
   "Original main app renderer/finance must remain unchanged: "+start);
 }
});
test("partners use a separate count-only backend under the SAME main app, not the internal finance writer",()=>{
 assert.match(current,/<main id="appScreen">/);
 assert.match(current,/id="partnerInlineWorkspace"/);
 assert.match(current,/appScreen\.dataset\.partnerCountOnly="true"/);
 assert.match(current,/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/);
 assert.match(current,/const snap=\(await partnerMainCountRead\(payload\)\)\.data/);
 assert.match(current,/partnerMainCountSubmit\(partnerInlinePayload\(\{/);
 assert.doesNotMatch(exactlyBetween(current,
  "async function openSameAppCompanyCodeWorkspace(){",
  "// Existing Firebase email partner behavior remains untouched."),
  /\b(?:setDoc|updateDoc|deleteDoc|addDoc)\(/,
  "company-code routing is only a read-only count UI bootstrap");
});

test("partner form uses internal layout shells and retains the existing count controls",()=>{
 const code=exactlyBetween(current,"function mountPartnerRecordLayout(){","// Clone the eleven button styles");
 const node=(localName="div",className="")=>({localName,className,dataset:{},style:{},children:[],
  selectors:new Map(),querySelector(key){return this.selectors.get(key)??null;},
  contains(child){return this===child||this.children.some(item=>item.contains(child));},
  append(...items){this.children.push(...items);}
 });
 const source=node("div","record-card"),panel=node(),card=node("div","p-inline-card record-card");
 card.replaceWith=replacement=>panel.selectors.set(":scope > .record-card",replacement);
 panel.selectors.set(":scope > .record-card",card);
 const grid=node("div","record-grid");
 grid.append(node("div","form-group"),node("div","form-group"));
 for(const [selector,element] of [
  [":scope > .record-grid",grid],[":scope > .record-title",node("div","record-title")],
  [":scope > .section-title",node("div","section-title")],
  [":scope > .record-total",node("div","record-total")],
  [".record-total-label",node("div","record-total-label")]
 ])source.selectors.set(selector,element);
 const count=node(),amount=node();count.parentElement=node();amount.value="非公開の売上";
 source.append(grid,count.parentElement,amount);
 const description=node("div","record-description"),teamGroup=node("div","form-group");
 const ids={recordManagement:source,partnerPanelRecord:panel,recordTotalCount:count};
 for(const id of ["pInlineRecordDate","pInlineStaff","pInlineWorkLocation"]){
  const label=node("label"),input=node("input");input.value="入力中の値";
  card.selectors.set('label[for="'+id+'"]',label);ids[id]=input;card.append(label,input);
 }
 ids.pInlineWorkingTeam=node("select");ids.pInlineWorkingTeam.parentElement=teamGroup;
 teamGroup.append(ids.pInlineWorkingTeam);card.append(teamGroup,description);
 card.selectors.set(":scope > .record-description",description);
 for(const id of ["pInlineCountFields","pInlineEntryTotals","pInlineSave","pInlineZero",
  "pInlineClear","pInlineVersion","pInlineSaveStatus"]){
  ids[id]=node();card.append(ids[id]);
 }
 ids.saveRecordButton=node("button","record-save-button");
 ids.noResultButton=node("button","record-clear-button");
 ids.clearRecordButton=node("button","record-clear-button");
 const install=new Function("pInline","document",`return (${code.trim()});`)(
  id=>ids[id],{createElement:name=>node(name)});
 assert.equal(install(),true);
 const shared=panel.querySelector(":scope > .record-card");
 assert.equal(shared.className,source.className);
 assert.equal(shared.children[2].children[0].contains(ids.pInlineWorkingTeam),true);
 assert.equal(shared.children[2].children[1].contains(ids.pInlineWorkLocation),true);
 assert.equal(shared.contains(ids.pInlineCountFields),true);
 assert.equal(shared.contains(ids.pInlineSave),true);
 assert.equal(ids.pInlineSave.className,ids.saveRecordButton.className);
 assert.equal(ids.pInlineWorkLocation.value,"入力中の値");
 assert.equal(shared.contains(amount),false);
 assert.deepEqual(source.children,[grid,count.parentElement,amount]);
 assert.equal(install(),true);
 assert.equal(panel.querySelector(":scope > .record-card"),shared);
});
