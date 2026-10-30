import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectProductionCutover}
 from "../scripts/nico-production-cutover-preflight.mjs";
import {modelOwnerOnlyFinanceRules}
 from "../security/finance-phase2-read-boundary.mjs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const deployed=read("firestore.rules");
const main=read("index.html");
const candidate=modelOwnerOnlyFinanceRules(read("security/firestore.phase1.rules"));
const secureHtml='<title>営業実績管理</title> projectId: "sales-management-cc116" '+
 'signInWithEmailAndPassword service-worker.js fetch("/v1/public-counts")';

test("current main is correctly blocked: finance originals still open and direct client paths remain",()=>{
 const x=inspectProductionCutover({rules:deployed,index:main});
 assert.equal(x.sourceCheckPassed,false);
 assert.equal(x.productionApprovalGranted,false);
 assert(x.blocked.includes("FINANCE_RAW_RULES_ALLOW_PARTNER_OR_UNVERIFIED"));
 assert(x.blocked.includes("DIRECT_BROWSER_FINANCE_COLLECTION_records"));
 assert(x.blocked.includes("DIRECT_BROWSER_FINANCE_COLLECTION_products"));
 assert(x.blocked.includes("LEGACY_RECORDS_DIRECT_QUERY"));
 assert(x.blocked.includes("LEGACY_RECORDS_DIRECT_WRITE"));
});
test("valid staged finance Rules and exclusively gateway-based browser pass only source gate",()=>{
 const x=inspectProductionCutover({rules:candidate,index:secureHtml});
 assert.equal(x.sourceCheckPassed,true);
 assert.equal(x.blocked.length,0);
 assert.equal(x.productionApprovalGranted,false);
 assert.equal(x.runtimeEvidenceRequired,true);
});
test("staged finance Rules alone cannot authorize an old client",()=>{
 const x=inspectProductionCutover({rules:candidate,index:main});
 assert.equal(x.sourceCheckPassed,false);
 assert(x.blocked.some(e=>e.includes("DIRECT_BROWSER_FINANCE_COLLECTION")));
});
test("gateway-only client cannot compensate for unsafe production Firestore Rules",()=>{
 const x=inspectProductionCutover({rules:deployed,index:secureHtml});
 assert.deepEqual(x.blocked,["FINANCE_RAW_RULES_ALLOW_PARTNER_OR_UNVERIFIED"]);
});
test("unknown project and raw collection helper are denied even with staged rules",()=>{
 const x=inspectProductionCutover({
  rules:candidate,
  index:secureHtml.replace("sales-management-cc116","other-project")+
   '\ncompanyCollectionQuery( "recordCorrections" )'
 });
 assert.equal(x.sourceCheckPassed,false);
 assert(x.blocked.includes("CANONICAL_APP_NOT_VERIFIED"));
 assert(x.blocked.includes("DIRECT_BROWSER_FINANCE_COLLECTION_recordCorrections"));
});
test("predeploy script is a pure read-only source check without bypass flags or Firebase SDK",()=>{
 const s=read("scripts/nico-production-cutover-preflight.mjs");
 assert.doesNotMatch(s,/firebase\s+deploy|setDoc\s*\(|deleteDoc\s*\(|updateDoc\s*\(|admin\.initializeApp|https:\/\/firestore\.googleapis\.com/);
 assert.doesNotMatch(s,/process\.env\.(?:SKIP|OVERRIDE|FORCE|ALLOW)_/);
 const workflow=read(".github/workflows/nico-factory-sync.yml");
 assert(workflow.indexOf("node scripts/nico-production-cutover-preflight.mjs")>=0);
 assert(workflow.indexOf("node scripts/nico-production-cutover-preflight.mjs")<
        workflow.indexOf("printf '%s' \"$FIREBASE_SERVICE_ACCOUNT_JSON\""));
});
