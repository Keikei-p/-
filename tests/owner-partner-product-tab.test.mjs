import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");

test("removing only the new tab restores the exact existing production HTML",()=>{
 let original=html.replace(/\r\n/g,"\n");
 const additions=[
  /<link rel="stylesheet" href="\.\/ranking\/owner-product-visibility-panel\.css">\n/,
  /            <button id="quickPartnerProductsButton"[\s\S]*?<\/button>\n\n/,
  /    <section id="partnerProductsWorkspace"[\s\S]*?    <\/section>\n/,
  /^const quickPartnerProductsButton = .*\n/m,
  /^const partnerProductsWorkspace = .*\n/m,
  /^const partnerProductsStatus = .*\n/m,
  /^const partnerProductsPanelRoot = .*\n/m,
  /^  partnerProductsWorkspace,\n/m,
  /^  quickPartnerProductsButton,\n/m,
  /^  quickPartnerProductsButton\.style\.display=.*\n/m,
  /\n\/\/ The existing Firebase Auth, region and Owner ON\/OFF panel are reused\.[\s\S]*?(?=document\.getElementById\("refreshPartnerCompanies"\))/
 ];
 for(const block of additions){
  assert.equal([...original.matchAll(new RegExp(block.source,block.flags+"g"))].length,1,
   "each reviewed tab addition must occur exactly once");
  original=original.replace(block,"");
 }
 const bytes=Buffer.from(original);
 const blob=createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
 assert.equal(blob,"6478197c52cd3a9fd6570e7214ed744e3ac93576",
  "the tab may not remove or modify any part of the already deployed application");
});

test("協力店商材 is a management tab and reuses the actual Owner panel",()=>{
 assert.match(html,/id="quickPartnerProductsButton"[^>]*aria-controls="partnerProductsWorkspace"/);
 assert.match(html,/<span class="quick-menu-icon">📦<\/span>\s*協力店商材/);
 assert.match(html,/id="partnerProductsWorkspace"[^>]*class="management-card"/);
 assert.match(html,/id="partnerProductsPanelRoot"/);
 assert.match(html,/managementWorkspacePanels = \[[\s\S]*partnerProductsWorkspace/);
 assert.match(html,/quickMenuButtons = \[[\s\S]*quickPartnerProductsButton/);
 assert.match(html,/showManagementWorkspace\(partnerProductsWorkspace\)/);
 assert.match(html,/owner-product-visibility-panel\.css/);
 assert.match(html,/import\(\s*"\.\/ranking\/owner-product-visibility-dashboard-mount\.mjs"/);
 assert.equal(html.split('id="quickPartnerProductsButton"').length-1,1);
 assert.equal(html.split('id="partnerProductsWorkspace"').length-1,1);
 assert.equal(html.split('id="partnerProductsPanelRoot"').length-1,1);
});

test("tab is shown only to a verified-hub Owner in the UI, and passes original Auth to server",()=>{
 assert.match(html,/quickPartnerProductsButton\.style\.display=canLoadPartnerRanking\(\)\?"":"none"/);
 assert.match(html,/quickPartnerProductsButton\.onclick=async\(\)=>\{\s*if\(!canLoadPartnerRanking\(\)\)return;/);
 assert.match(html,/currentUser\?\.uid===ownerUid && canLoadPartnerRanking\(\)/);
 assert.match(html,/featureEnabled:true,document,root:partnerProductsPanelRoot,\s*auth,functions:partnerCountFunctions,httpsCallable,onAuthStateChanged/);
 assert.match(html,/function canLoadPartnerRanking\(\)\{\s*return !!currentUser\?\.emailVerified/);
 assert.match(html,/currentCompanyData\?\.ownerUid===currentUser\.uid/);
 assert.match(html,/currentCompanyData\?\.companyKind!=="partner"/);
});

test("new tab does not access finance, counts or mutate old history",()=>{
 const start=html.indexOf("let partnerProductsMountedPanel=null;");
 const end=html.indexOf('document.getElementById("refreshPartnerCompanies")',start);
 assert(start>0&&end>start);
 const code=html.slice(start,end);
 for(const pattern of [/getFirestore\(/,/runTransaction\(/,/setDoc\(/,/updateDoc\(/,/deleteDoc\(/,/writeBatch\(/,/getPartnerWorkspace\(/,/submitPartnerWorkspaceCounts\(/,/setOwnerReviewedSkuMapping\(/])
  assert.doesNotMatch(code,pattern);
 assert.match(html,/過去の協力店件数・実績・売上・履歴を削除・変更する画面ではありません/);
});

test("the original browser module remains syntactically valid",()=>{
 const modules=[...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)];
 assert(modules.length>=1);
 const dir=mkdtempSync(path.join(tmpdir(),"nico-partner-products-tab-"));
 try{
  for(const [i,m] of modules.entries()){
   const target=path.join(dir,"inline-"+i+".mjs");
   writeFileSync(target,m[1]);
   const check=spawnSync("node",["--check",target],{encoding:"utf8"});
   assert.equal(check.status,0,check.stderr);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
