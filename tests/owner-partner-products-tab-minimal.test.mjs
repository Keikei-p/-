import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {execFileSync,spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";

const current=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const base=execFileSync("git",["show","ff9051a7ee3b611e99ffec87e0383b72d259b10f:index.html"],{encoding:"utf8"});

function removeExactly(s,pattern,label,replacement=""){
 const matches=s.match(pattern);
 assert(matches&&matches.length===1,label+" must appear exactly once");
 assert.equal(s.split(matches[0]).length-1,1,label+" only one segment");
 return s.replace(pattern,()=>replacement);
}
test("new index is the protected original plus ONLY the intended Owner tab additions",()=>{
 let s=current;
 s=removeExactly(s,/\n<link rel="stylesheet" href="\.\/ranking\/owner-product-visibility-panel\.css">/,"css");
 s=removeExactly(s,/            <button id="quickPartnerProductsButton"[\s\S]*?<\/button>\n\n/,"button");
 const panel=/    <section id="partnerProductsWorkspace"[\s\S]*?<\/section>\n/;
 s=removeExactly(s,panel,"workspace");
 s=removeExactly(s,/\nconst quickPartnerProductsButton = document\.getElementById\("quickPartnerProductsButton"\);[\s\S]*?const partnerProductsPanelRoot = document\.getElementById\("partnerProductsPanelRoot"\);/,"element refs");
 s=removeExactly(s,/  partnerProductsWorkspace,\n/,"panel list");
 s=removeExactly(s,/  quickPartnerProductsButton,\n/,"menu list");
 s=removeExactly(s,/  quickPartnerProductsButton\.style\.display=canLoadPartnerRanking\(\)\?"":"none";\n/,"owner menu gate");
 s=removeExactly(s,/\/\/ The existing Firebase Auth, region and Owner ON\/OFF panel are reused\.[\s\S]*?(?=document\.getElementById\("refreshPartnerCompanies"\))/,"panel mount");
 assert.equal(s,base,"zero unrelated edits allowed on existing sales UI");
});
test("visible 協力店商材 tab is nested inside existing management navigation, not a redirect",()=>{
 assert.match(current,/id="quickPartnerProductsButton" class="quick-menu-button"/);
 assert.match(current,/aria-controls="partnerProductsWorkspace"/);
 assert.match(current,/>\s*協力店商材\s*<\/button>/);
 assert.match(current,/id="partnerProductsPanelRoot"/);
 assert.match(current,/managementWorkspacePanels = \[[\s\S]*?partnerProductsWorkspace/);
 assert.match(current,/quickMenuButtons = \[[\s\S]*?quickPartnerProductsButton/);
 assert.match(current,/showManagementWorkspace\(partnerProductsWorkspace\)/);
 assert.match(current,/import\(\s*"\.\/ranking\/owner-product-visibility-dashboard-mount\.mjs"/);
});
test("Owner only menu and authenticated existing Firebase callable; partner cannot turn on with a browser role flag",()=>{
 assert.match(current,/quickPartnerProductsButton\.style\.display=canLoadPartnerRanking\(\)\?"":"none"/);
 assert.match(current,/quickPartnerProductsButton\.onclick=async\(\)=>\{\s*if\(!canLoadPartnerRanking\(\)\)return;/);
 assert.match(current,/currentUser\?\.uid===ownerUid && canLoadPartnerRanking\(\)/);
 assert.match(current,/featureEnabled:true,document,root:partnerProductsPanelRoot,\s*auth,functions:partnerCountFunctions,httpsCallable,onAuthStateChanged/);
 const code=current.slice(current.indexOf("let partnerProductsMountedPanel=null;"),
  current.indexOf('document.getElementById("refreshPartnerCompanies")'));
 for(const x of [/setDoc\(/,/updateDoc\(/,/deleteDoc\(/,/getFirestore\(/,/runTransaction\(/,/submitPartnerWorkspaceCounts\(/,/getVerifiedJointCountRanking\(/])
  assert.doesNotMatch(code,x);
});
test("original browser module parses and no DOM ID collisions were introduced",()=>{
 for(const id of ["quickPartnerProductsButton","partnerProductsWorkspace","partnerProductsStatus","partnerProductsPanelRoot"])
  assert.equal(current.split('id="'+id+'"').length-1,1,id);
 const matches=[...current.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)];
 assert(matches.length>0,"the existing browser entrypoint should be present");
 const dir=mkdtempSync(join(tmpdir(),"nico-owner-tab-"));
 try{
  for(const [i,match] of matches.entries()){
   const name=join(dir,i+".mjs");
   writeFileSync(name,match[1]);
   const parsed=spawnSync("node",["--check",name],{encoding:"utf8"});
   assert.equal(parsed.status,0,parsed.stderr);
  }
 }finally{rmSync(dir,{force:true,recursive:true});}
});
