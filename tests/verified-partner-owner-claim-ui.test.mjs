import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL(
 "../staging/partner-owner-claim-v1/partner-owner-claim.html",import.meta.url
),"utf8");
test("staged Owner invite and recipient enrollment on the SAME Firebase Auth and strict home region",()=>{
 assert.match(html,/getAuth\(app\)/);
 assert.match(html,/getFunctions\(app,"asia-northeast1"\)/);
 assert.match(html,/sales-management-cc116/);
 assert.match(html,/getRankingOwnerConsentStatus/);
 for(const fn of ["issuePartnerOwnerClaimInvite","previewPartnerOwnerClaimInvite",
   "acceptPartnerOwnerClaimInvite"])
  assert.match(html,new RegExp(fn));
 assert.match(html,/onAuthStateChanged\(auth/);
 assert.match(html,/sendEmailVerification/);
 assert.match(html,/await reload\(auth.currentUser\)/);
 assert.match(html,/auth.currentUser\?\.emailVerified/);
 assert.match(html,/id="acceptCheckbox"[^>]*required/);
});
test("no hidden cloud writes, finance data fetching or raw script injection",()=>{
 assert.doesNotMatch(html,/firebase-firestore|(?:getFirestore|getDocs|setDoc|updateDoc|runTransaction)\s*\(/);
 assert.doesNotMatch(html,/localStorage|sessionStorage|document.cookie|innerHTML|eval\(/);
 assert.doesNotMatch(html,/console\.(?:log|error|warn)|fetch\(["']https:\/\//);
 assert.match(html,/name="referrer" content="no-referrer"/);
 assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/);
 assert.match(html,/textContent="登録先： "\+data.companyName/);
 assert.match(html,/history.replaceState\(null,"",link.pathname\)/);
 assert.match(html,/!TOKEN\.test\(claim\)/);
 assert.match(html,/result\.financialRoleFlagsFalse!==true/);
});
test("link created only after explicit hub Owner button; real account never auto claims",()=>{
 assert.match(html,/id="issueForm"/);
 assert.match(html,/id="acceptForm"/);
 assert.match(html,/issueForm"\)\.addEventListener\("submit"/);
 assert.match(html,/acceptForm"\)\.addEventListener\("submit"/);
 assert.match(html,/confirm:true/);
 assert.match(html,/onAuthStateChanged\(auth,\(\)=>\{void refresh\(\);\}\)/);
 assert(!html.includes('onAuthStateChanged(auth,()=>{void accept('));
});
