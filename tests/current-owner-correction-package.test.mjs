import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,existsSync,rmSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from 'node:url';
import {historicalSources} from './helpers/historical-builder-fixtures.mjs';
import {
 REVIEWED,CURRENT_CANDIDATE,gitBlob,makeOwnerPackage,
 makeCurrentCandidateOwnerPackage,writeDisposablePackage
} from "../tools/production/prepare-hub-owner-correction-v3-package.mjs";

const root=fileURLToPath(new URL('../',import.meta.url));
const sources=()=>historicalSources(CURRENT_CANDIDATE);

test("exact current source pins include finance, old Functions, original Hosting and isolated Owner API",()=>{
 const all=sources();
 assert.deepEqual(Object.keys(CURRENT_CANDIDATE).sort(),Object.keys(REVIEWED).sort());
 for(const [name,sha] of Object.entries(CURRENT_CANDIDATE))
  assert.equal(gitBlob(all[name]),sha,name);
 assert.notEqual(CURRENT_CANDIDATE["index.html"],REVIEWED["index.html"]);
 assert.notEqual(CURRENT_CANDIDATE["functions-partner-workspace/index.js"],
  REVIEWED["functions-partner-workspace/index.js"]);
 assert.equal(CURRENT_CANDIDATE["firestore.rules"],REVIEWED["firestore.rules"]);
 assert.throws(()=>makeOwnerPackage(all),/STOP_OWNER_V3_PACKAGE_SOURCE_CHANGED/,
  "legacy frozen release must remain blocked");
 const candidate=makeCurrentCandidateOwnerPackage(all);
 assert.equal(candidate.report.deployed,false);
 assert.equal(candidate.report.realUserVerified,false);
 assert.equal(candidate.report.financeBoundaryVerified,false);
 assert.equal(candidate.report.productDataWrites,0);
 assert.equal(candidate.report.productionDataWrites,0);
 assert.equal(candidate.report.stagingSecurityGateDefaultDisabled,true);
 assert.deepEqual(candidate.report.exports,["listHubPartnerCounts","correctHubPartnerCounts"]);
 assert.equal(candidate.report.codebase,"hub-owner-correction-v3");
 assert.deepEqual(Object.keys(candidate.bundle).sort(),[
  "functions-hub-owner-correction/index.js",
  "functions-hub-owner-correction/service.cjs",
  "functions-hub-owner-correction/trusted-auth.cjs",
  "functions-hub-owner-correction/sb-category-v2.cjs",
  "functions-hub-owner-correction/package.json",
  "firebase.owner-correction.json"
 ].sort());
 const entry=candidate.bundle["functions-hub-owner-correction/index.js"];
 assert(entry.includes('HUB_OWNER_COUNT_CORRECTION_V3_ENABLED==="enabled"'));
 assert(!entry.includes("enabled:()=>true"));
 const service=candidate.bundle["functions-hub-owner-correction/service.cjs"];
 assert(service.includes('require("./sb-category-v2.cjs")'));
 assert(candidate.bundle["functions-hub-owner-correction/sb-category-v2.cjs"].includes("SB_SPLIT_"));
 assert(service.includes('candidateParts["SB光"]!==previousParts["SB光"]'));
 assert(service.includes('MONEY.test(reason.normalize("NFKC"))'));
 for(const content of Object.values(candidate.bundle))
  assert(!/firebase deploy|firestore:delete|functions:delete/.test(content));
});

test("current candidate refuses every changed source including finance and history",()=>{
 const all=sources();
 for(const name of Object.keys(CURRENT_CANDIDATE))
  assert.throws(()=>makeCurrentCandidateOwnerPackage({...all,[name]:all[name]+"\\n"}),
   /STOP_OWNER_V3_PACKAGE_SOURCE_CHANGED/,name);
 assert.throws(()=>makeOwnerPackage(all,{}),/STOP_OWNER_V3_PACKAGE_UNREVIEWED_BASELINE/);
});

test("current candidate writes six isolated files only into a disposable approved runner directory",()=>{
 const temp=mkdtempSync(path.join(tmpdir(),"nico-owner-current-candidate-"));
 const saved={
  RUNNER_TEMP:process.env.RUNNER_TEMP,
  GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,
  GITHUB_REPOSITORY:process.env.GITHUB_REPOSITORY
 };
 try{
  process.env.RUNNER_TEMP=temp;
  process.env.GITHUB_ACTIONS="true";
  process.env.GITHUB_REPOSITORY="Keikei-p/-";
  const dest=path.join(temp,"nico-reviewed-owner-correction-v3-package");
  assert.equal(existsSync(dest),false);
  const created=writeDisposablePackage(makeCurrentCandidateOwnerPackage(sources()),dest);
  assert.equal(created.length,6);
  assert.equal(readdirSync(dest).length,2);
  assert.equal(readdirSync(path.join(dest,"functions-hub-owner-correction")).length,5);
  assert.equal(existsSync(path.join(dest,"functions-hub-owner-correction","index.js")),true);
  assert.throws(()=>writeDisposablePackage(makeCurrentCandidateOwnerPackage(sources()),dest),
   /STOP_OWNER_V3_PACKAGE_DESTINATION/);
 }finally{
  for(const [k,v] of Object.entries(saved)){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
  rmSync(temp,{force:true,recursive:true});
 }
});
