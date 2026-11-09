import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyLiveHTMLProvenance} from "../tools/production/inspect-live-finance-diagnostic-provenance.mjs";
const reviewed=readFileSync(new URL("../finance-boundary-check.html",import.meta.url),"utf8");
const commit="0bc073ba24d0f7bc840c868e3c3d42adea64485b";
test("an exact live match proves only static page provenance, not user finance safety",()=>{
 const r=classifyLiveHTMLProvenance(reviewed,reviewed,[{sha:commit,html:reviewed}]);
 assert.equal(r.exactReviewedSource,true);
 assert.equal(r.historicalExactMatch,true);
 assert.equal(r.historicalCommitPrefix,commit.slice(0,12));
 assert.equal(r.looksLikeDiagnosticHtml,true);
 assert.equal(r.missingRequiredMarkerCount,0);
 assert.equal(r.safeToOverwriteWithoutBaselineReview,false);
 assert.equal(r.provesFinancialGetListDenied,false);
 assert.equal(r.firebaseWrites,0);
 assert.equal(r.financeDocumentRequests,0);
});
test("known previous revision can be discovered without logging source or authentication",()=>{
 const old=reviewed.replace("getPartnerQuickCounts","priorCallOnly");
 const r=classifyLiveHTMLProvenance(old,reviewed,[{sha:commit,html:old}]);
 assert.equal(r.exactReviewedSource,false);
 assert.equal(r.historicalExactMatch,true);
 assert.equal(r.missingRequiredMarkerCount,1);
 assert.equal(r.publicPageProvenanceVerified,true);
 assert(!JSON.stringify(r).includes("priorCallOnly"));
 assert(!JSON.stringify(r).includes("AIza"));
});
test("missing page fallback or wholly unknown live source stays untrusted",()=>{
 for(const live of [
  "<!doctype html><html><title>App</title><body>SPA</body></html>",
  reviewed.slice(0,3000),
  reviewed.replace("initializeAuth(app,{persistence:browserSessionPersistence})","initializeAuth(app,{})"),
  reviewed.replace("getIdToken(true)","getIdToken(false)")
 ]){
  const r=classifyLiveHTMLProvenance(live,reviewed);
  assert.equal(r.historicalExactMatch,false);
  assert.equal(r.publicPageProvenanceVerified,false);
  assert.equal(r.safeToOverwriteWithoutBaselineReview,false);
  assert(r.missingRequiredMarkerCount>0);
 }
});
test("line ending variation is informational and never counts as byte-identical",()=>{
 const windows=reviewed.replace(/\n/g,"\r\n");
 const r=classifyLiveHTMLProvenance(windows,reviewed);
 assert.equal(r.exactReviewedSource,false);
 assert.equal(r.sameAfterLineEndingNormalization,true);
 assert.equal(r.safeToOverwriteWithoutBaselineReview,false);
});
test("rejects malformed historical items and oversized or non-string input",()=>{
 for(const options of [
  {live:null},
  {live:"x".repeat(256001)},
  {historical:[{sha:"bad",html:reviewed}]},
  {historical:[{sha:commit,html:null}]},
  {historical:Array(61).fill({sha:commit,html:reviewed})}
 ]){
  assert.throws(()=>classifyLiveHTMLProvenance(
   options.live??(Object.hasOwn(options,"live")?options.live:reviewed),
   reviewed,options.historical??[]
  ),/STOP_FINANCE_LIVE_HTML_PROVENANCE_BAD_/);
 }
});
test("workflow is GET only, cannot log site contents, cannot reach financial APIs",()=>{
 const y=readFileSync(new URL("../.github/workflows/nico-finance-live-html-provenance-readonly.yml",import.meta.url),"utf8");
 const js=readFileSync(new URL("../tools/production/inspect-live-finance-diagnostic-provenance.mjs",import.meta.url),"utf8");
 assert.match(y,/github\.event_name == 'push'/);
 assert.match(y,/--format=%H|inspect-live-finance-diagnostic-provenance\.mjs/);
 assert.doesNotMatch(y,/FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS|firebase deploy|upload-artifact/);
 assert.match(js,/method:"GET"/);
 assert.doesNotMatch(js,/method:"POST"|method:"PUT"|method:"PATCH"|method:"DELETE"|Bearer /);
 assert.doesNotMatch(js,/console\.log\((?:body|html|reviewed|raw)/);
 // Static marker text is legitimate for checking the public HTML.
 // Forbid an actual network fetch to private Firestore/Functions resources.
 assert.doesNotMatch(js,/fetch\(\s*["']https:\/\/(?:firestore\.googleapis\.com|[^"']*cloudfunctions\.net)|firebase-admin/);
});
