import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {prepareHubPortal,REVIEWED} from "../tools/production/prepare-hub-owner-portal-static.mjs";
const files=Object.fromEntries(Object.keys(REVIEWED).map(k=>[
 k,readFileSync(new URL("../"+k,import.meta.url),"utf8")
]));
const html=files["staging/hub-owner-management/owner-partner-admin.html"];
test("a frozen, additive static bundle reuses existing authenticated main session with no impersonation",()=>{
 const bundle=prepareHubPortal(files);
 assert.deepEqual(Object.keys(bundle).sort(),[
  "owner-partner-admin.html",
  "owner-partner-admin-assets/mobile-bootstrap.mjs",
  "owner-partner-admin-assets/owner-client.mjs",
  "owner-partner-admin-assets/owner-ui.mjs"
 ].sort());
 assert.equal(bundle["owner-partner-admin.html"],html);
 assert.match(html,/getAuth\(app\)/);
 assert.match(html,/getPartnerWorkspace/);
 assert.match(html,/listHubPartnerCounts/);
 assert.match(html,/correctHubPartnerCounts/);
 assert.match(html,/const HUB_OWNER_CORRECTION_READY=false/);
 assert.match(html,/currentPanel\.openCompany\(partnerId\)/);
 assert.match(html,/onAuthStateChanged\(auth,user/);
 assert.doesNotMatch(html,/\b(?:signInWithEmailAndPassword|signOut|createUserWithEmailAndPassword|setDoc|updateDoc|writeBatch|deleteDoc)\s*\(/);
 assert.doesNotMatch(html,/getFirestore\(|https:\/\/firestore\.googleapis\.com|document\.cookie|sessionStorage|localStorage/);
});
test("untrusted source changes cannot be packaged for live Hosting",()=>{
 for(const key of Object.keys(REVIEWED)){
  assert.throws(()=>prepareHubPortal({...files,[key]:files[key]+"\n// unreviewed"}),
   /STOP_HUB_OWNER_PORTAL_SOURCE_CHANGED/);
 }
 assert.throws(()=>prepareHubPortal([]),/STOP_HUB_OWNER_PORTAL_FILES_INVALID/);
});
test("new companion modules retain exact reviewed cross-imports and never call Firestore or expose finance",()=>{
 const compiled=prepareHubPortal(files);
 const [boot,client,ui]=[
  "mobile-bootstrap.mjs","owner-client.mjs","owner-ui.mjs"
 ].map(n=>compiled["owner-partner-admin-assets/"+n]);
 assert.match(boot,/from "\.\/owner-client\.mjs"/);
 assert.match(boot,/from "\.\/owner-ui\.mjs"/);
 assert.match(client,/from "\.\/owner-ui\.mjs"/);
 assert.match(ui,/async function openCompany\(partnerCompanyId\)/);
 assert.doesNotMatch(boot+client+ui,/firebase-firestore|\bgetFirestore\(|\bsetDoc\(|\bupdateDoc\(|\bdeleteDoc\(/);
 assert.doesNotMatch(html,/totalRevenue|revenuePerUnit|cashbackOptions|pricingOptions/);
});
test("same-login read-only mode cannot call correction or leak another company's entries",()=>{
 assert.match(html,/if\(!HUB_OWNER_CORRECTION_READY\)/);
 assert.match(html,/currentPanel=await mountVerifiedOwnerCorrection/);
 assert.match(html,/!companies\.some\(c=>/);
 assert.match(html,/result\?\.role!=="hub"/);
 assert.match(html,/result\?\.partnerTeamDetails\?\.partnerCompanyId!==partnerId/);
 assert.match(html,/\$\("overview"\)\.replaceChildren\(\)/);
 assert.match(html,/\$\("correctionRoot"\)\.replaceChildren\(\)/);
 assert.match(html,/currentPanel\?\.destroy\(\)/);
});
