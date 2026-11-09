import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {spawnSync} from "node:child_process";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const anchor="const NICO_OWNER_PRODUCT_ONOFF_RELEASED=false;";
const i=html.indexOf(anchor),end=html.indexOf("/* =====================================================\n   DOM",i);
test("existing owner product editor contains exactly one hidden count publication panel",()=>{
 assert.equal(html.split('id="ownerProductPublicationSection"').length,2);
 assert.equal(html.split('id="ownerProductPublicationRoot"').length,2);
 assert.match(html,/<section id="ownerProductPublicationSection" hidden/);
 assert.match(html,/id="productManagementContent"[\s\S]*?id="ownerProductPublicationSection"[\s\S]*?class="product-editor-card"/);
 assert.match(html,/if\(type==="product"\)void maybeMountNicoOwnerPublication\(\);/);
 assert.match(html,/onAuthStateChanged\(\s*auth,\s*async user => \{\s*resetNicoOwnerPublication\(\);/);
});
test("hardcoded release gate rejects URL/localStorage tricks and never loads a module or callable",async()=>{
 assert(i>0&&end>i);
 const code=html.slice(i,end);
 assert.match(code,/const NICO_OWNER_PRODUCT_ONOFF_RELEASED=false;/);
 assert.match(code,/if\(!NICO_OWNER_PRODUCT_ONOFF_RELEASED\|\|!canLoadPartnerRanking\(\)\)/);
 assert(!/\b(?:setDoc|deleteDoc|updateDoc|writeBatch|runTransaction|getDocs)\s*\(/.test(code));
 const context={document:{getElementById(){throw Error("UNEXPECTED_DOM_READ")}},
  canLoadPartnerRanking(){throw Error("UNEXPECTED_CLIENT_OWNER_CHECK")},
  auth:{get currentUser(){throw Error("UNEXPECTED_FIREBASE_READ")}}};
 const app=vm.runInNewContext(code+"\n({maybeMountNicoOwnerPublication,resetNicoOwnerPublication})",context);
 assert.equal(await app.maybeMountNicoOwnerPublication(),false);
});
test("no login/account change can retain a previous owner's switches",()=>{
 assert(i>0&&end>i);
 const code=html.slice(i,end);
 let destroyCount=0,hideCount=0,clearCount=0;
 const root={replaceChildren(){clearCount++}};
 const section={set hidden(value){if(value===true)hideCount++}};
 const context={document:{getElementById(id){return id==="ownerProductPublicationSection"?section:
  id==="ownerProductPublicationRoot"?root:null}}};
 const app=vm.runInNewContext(code+"\n({resetNicoOwnerPublication})",context);
 app.resetNicoOwnerPublication();
 assert.equal(clearCount,1);
 assert.equal(hideCount,1);
});
test("original app inline module remains JavaScript syntax-valid and never statically imports staging file",()=>{
 const modules=[...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)];
 assert(modules.length>=1);
 for(const m of modules){
  const check=spawnSync(process.execPath,["--check","--input-type=module"],{
   input:m[1],encoding:"utf8",timeout:20000
  });
  assert.equal(check.status,0,check.stderr);
 }
 assert(!/import\s+.*["']\.\/ranking\/owner-product-visibility-dashboard-mount\.mjs["']/.test(html));
 assert.match(html,/import\("\.\/ranking\/owner-product-visibility-dashboard-mount\.mjs"\)/);
 assert.match(html,/if\(!NICO_OWNER_PRODUCT_ONOFF_RELEASED[\s\S]{0,160}return false/);
});
