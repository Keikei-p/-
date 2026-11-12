import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const page=read("owner-product-publication.html");
const main=read("index.html");
const functionIndex=read("functions-ranking-approvals/index.js");
const controller=read("functions-ranking-approvals/product-visibility-controller.cjs");
const store=read("ranking/owner-product-visibility-firestore.mjs");
const mount=read("ranking/owner-product-visibility-dashboard-mount.mjs");

test("single-feature owner page uses the same verified Firebase project as the live dashboard",()=>{
 const config=s=>s.match(/const firebaseConfig\s*=\s*(\{[\s\S]*?\});/)?.[1];
 assert.ok(config(page),"owner config must exist");
 assert.equal(config(page),config(main),"do not fork production Firebase identity");
 assert.match(page,/getFunctions\(app,"asia-northeast1"\)/);
 assert.match(page,/ranking\/owner-product-visibility-dashboard-mount\.mjs/);
 assert.match(page,/href="\.\/index\.html"/);
});

test("the on/off entry is a separate page and does not browse or mutate finance originals",()=>{
 assert.match(page,/id="owner-product-visibility-root"/);
 assert.match(page,/mountOwnerProductVisibilityDashboard\(/);
 assert.match(page,/featureEnabled:true/);
 assert.doesNotMatch(page,/(?:\b(?:getFirestore|collection|addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(|\b(?:fetch|XMLHttpRequest)\s*\()/);
 assert.match(mount,/createOwnerProductVisibilityFirebaseBridge/);
 assert.doesNotMatch(page,/(?:serviceAccount|GOOGLE_APPLICATION_CREDENTIALS|private_key|authKind\s*:\s*["']partner)/);
});

test("backend remains disabled by default and authenticates each Owner call server-side",()=>{
 assert.match(functionIndex,/NICO_OWNER_PRODUCT_VISIBILITY_ENABLED==="enabled"/);
 assert.match(controller,/if\(enabled\(\)!==true\)offline\(\)/);
 assert.match(controller,/createVerifiedRankTokenReader/);
 assert.match(store,/tx\.create\(audit,/);
 assert.match(store,/rankingProductVisibilityAudit/);
 assert.doesNotMatch(page,/NICO_OWNER_PRODUCT_VISIBILITY_ENABLED\s*=/);
});

test("the first release never connects partner counting or public ranking switches",()=>{
 assert.doesNotMatch(page,/submitPartnerWorkspaceCounts|setOwnerReviewedSkuMapping|getVerifiedJointCountRanking|NICO_JOINT_COUNT_RANKING_ENABLED/);
 assert.doesNotMatch(page,/<iframe|<script[^>]+src=["']https?:\/\//);
 assert.match(page,/既存の実績・件数・売上・履歴は変更しません/);
});
