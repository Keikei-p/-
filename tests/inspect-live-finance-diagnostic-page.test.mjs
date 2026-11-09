import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyLiveDiagnostic,ORIGIN,ROUTE}
 from "../tools/production/inspect-live-finance-diagnostic-page.mjs";
const reviewed=readFileSync(new URL("../finance-boundary-check.html",import.meta.url),"utf8");
const classify=(body,extra={})=>classifyLiveDiagnostic({
 status:200,contentType:"text/html; charset=utf-8",body,reviewed,...extra
});
test("exact reviewed HTML certifies only a safe read-only diagnostic URL",()=>{
 const v=classify(reviewed);
 assert.equal(ORIGIN+ROUTE,"https://nico-factory.web.app/finance-boundary-check.html");
 assert.equal(v.exactReviewedDiagnosticHtmlDeployed,true);
 assert.equal(v.safeToUseForRealUserReadOnlyPreflight,true);
 assert.equal(v.proofOfRealUserFinancialDenial,false);
 assert.equal(v.proofOfCountSaveOrCorrection,false);
 assert.equal(v.financialDocumentRequests,0);
 assert.equal(v.hostingDeploys,0);
 assert(!JSON.stringify(v).includes("apiKey"));
});
test("SPA fallback 200, stale login page, replaced source, 404 and non-HTML are not approved",()=>{
 for(const options of [
  {body:"<html><body>index app</body></html>"},
  {body:reviewed.replace("getIdToken(true)","getIdToken(false)")},
  {body:reviewed+"\n<!-- appended by attacker -->"},
  {body:"Not found",status:404},
  {body:reviewed,status:403},
  {body:reviewed,contentType:"application/json"},
  {body:reviewed,contentType:"text/plain"}
 ]){
  const x=classify(options.body,options);
  assert.equal(x.safeToUseForRealUserReadOnlyPreflight,false);
  assert.equal(x.proofOfRealUserFinancialDenial,false);
 }
});
test("bad responses are fail closed, never dump body",()=>{
 for(const value of [
  {status:"200"}, {status:200,body:null},
  {status:200,body:"x".repeat(256001)},
  {contentType:null}
 ]){
  assert.throws(()=>classifyLiveDiagnostic({
   status:200,contentType:"text/html",body:reviewed,reviewed,...value
  }),/STOP_LIVE_DIAGNOSTIC_INVALID_RESPONSE/);
 }
});
test("CI is strictly GET-only and main-scoped; no credential, sales or Firestore reads",()=>{
 const w=readFileSync(new URL("../.github/workflows/nico-live-finance-diagnostic-probe.yml",import.meta.url),"utf8");
 const script=readFileSync(new URL("../tools/production/inspect-live-finance-diagnostic-page.mjs",import.meta.url),"utf8");
 assert.match(w,/github\.event_name == 'push'/);
 assert.match(w,/github\.ref == 'refs\/heads\/main'/);
 assert.match(w,/inspect-live-finance-diagnostic-page\.mjs/);
 assert.match(w,/test "\$\(git hash-object firestore\.rules\)"/);
 assert.doesNotMatch(w,/FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS|firebase deploy|upload-artifact/);
 assert.match(script,/method:"GET"/);
 assert.doesNotMatch(script,/method:"(?:POST|PUT|PATCH|DELETE)"/);
 assert.doesNotMatch(script,/console\.log\((?:body|reviewed|response|error)/);
 assert.doesNotMatch(script,/firebase-admin|firestore\.googleapis\.com|cloudfunctions\.net|Bearer /);
});
