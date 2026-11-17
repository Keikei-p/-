import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {historicalBlob} from "./helpers/historical-builder-fixtures.mjs";

const index=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const original=historicalBlob("03e213565a2037c73913602701363476ae0db9fd");
const htmlStart="      <!-- OWNER_PRODUCT_SHARE_INLINE_START:";
const htmlEnd="      <!-- OWNER_PRODUCT_SHARE_INLINE_END -->\n";
const jsStart="// OWNER_PRODUCT_SHARE_INLINE_JS_START:";
const jsEnd="// OWNER_PRODUCT_SHARE_INLINE_JS_END\n\n";
const priorOpen="  resetQuickMenuButtons();\n\n  config.button.setAttribute(";
const guardedOpen=[
  "  // The existing merchant editor stays unchanged. Partner publication is Owner-only.",
  '  if(type==="product"){',
  '    ownerProductShareInline.hidden=!canLoadPartnerRanking();',
  '    if(ownerProductShareInline.hidden)ownerProductShareInline.open=false;',
  '  }',
  ''
].join("\n")+"\n"+priorOpen;
function block(start,end){
 const a=index.indexOf(start),b=index.indexOf(end,a);
 assert(a>=0&&b>a,"missing owner integration marker");
 assert.equal(index.indexOf(start,a+start.length),-1,"duplicate integration marker");
 return index.slice(a,b+end.length);
}
test("exactly three additions to the existing product tab; all original sales and partner app source preserved",()=>{
 const html=block(htmlStart,htmlEnd);
 const script=block(jsStart,jsEnd);
 assert.equal(index.split(guardedOpen).length-1,1);
 const reconstructed=index.replace(html,"").replace(script,"")
  .replace(guardedOpen,priorOpen);
 assert.equal(reconstructed,original,"original 823KB sales page must remain byte identical");
 assert.match(html,/id="ownerProductShareInline"/);
 assert.match(html,/id="ownerProductShareInlineRoot"/);
 assert.match(html,/href="\.\/owner-partner-setup\.html"/);
 assert.match(html,/商材の再登録は不要です/);
 assert.match(index,/id="productList"/);
 assert.match(index,/id="productNameInput"/);
 assert.match(index,/id="addProductButton"/);
});
test("integrated partner publication uses existing SKU-only module with same Firebase auth and Owner guard",()=>{
 const html=block(htmlStart,htmlEnd);
 const js=block(jsStart,jsEnd);
 assert.match(html,/登録済み商材のON\/OFF/);
 assert.match(html,/商材を追加登録する必要はありません/);
 assert.match(js,/if\(!canLoadPartnerRanking\(\)\)/);
 assert.match(js,/const uid=currentUser\.uid/);
 assert.match(js,/currentUser\?\.uid===uid && canLoadPartnerRanking\(\)/);
 assert.match(js,/mountOwnerProductVisibilityDashboard/);
 assert.match(js,/featureEnabled:true,document,root:ownerProductShareInlineRoot/);
 assert.match(js,/auth,functions:partnerCountFunctions,httpsCallable,onAuthStateChanged/);
 assert.match(index,/ownerProductShareInline.hidden=!canLoadPartnerRanking\(\)/);
 for(const forbidden of [
  /getFirestore\s*\(/,/getDoc\s*\(/,/setDoc\s*\(/,/updateDoc\s*\(/,
  /deleteDoc\s*\(/,/writeBatch\s*\(/,/runTransaction\s*\(/,
  /getPartnerWorkspace\s*\(/,/submitPartnerWorkspaceCounts\s*\(/,
  /setOwnerReviewedSkuMapping\s*\(/,/signInWithEmailAndPassword\s*\(/
 ])assert.doesNotMatch(js,forbidden,"no direct writes, finance reads or auth bypass");
 assert.match(html,/OFFにしても過去の実績・件数・履歴は保持/);
});
test("existing module and old dedicated owner publication tab are not removed or redirected",()=>{
 assert.match(index,/id="quickPartnerProductsButton"/);
 assert.match(index,/id="partnerProductsWorkspace"/);
 assert.match(index,/let partnerProductsMountedPanel=null;/);
 assert.match(index,/quickPartnerProductsButton\.onclick=async\(\)=>/);
 assert.match(index,/getPartnerWorkspace/);
 assert.match(index,/function persistDailyRecord/);
});
test("all inline browser modules remain valid JavaScript",()=>{
 const sections=[...index.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)];
 assert(sections.length>=1);
 const dir=mkdtempSync(path.join(tmpdir(),"owner-in-product-"));
 try{
  for(const [i,entry] of sections.entries()){
   const target=path.join(dir,"module-"+i+".mjs");
   writeFileSync(target,entry[1]);
   const result=spawnSync(process.execPath,["--check",target],{encoding:"utf8",timeout:20000});
   assert.equal(result.status,0,result.stderr||"inline module syntax invalid");
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
