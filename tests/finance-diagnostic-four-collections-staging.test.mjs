import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {runInNewContext} from "node:vm";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {
  makeCandidate,originalSource,gitBlob,ORIGINAL_BLOB,FINANCE_COLLECTIONS
} from "../staging/finance-diagnostic-v2/build-candidate.mjs";

const origin=originalSource();
const candidate=makeCandidate(origin);
const script=candidate.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

test("existing published diagnostic source stays frozen; no Hosting/Rules/Functions writes",()=>{
  assert.equal(gitBlob(origin),ORIGINAL_BLOB);
  assert.notEqual(candidate,origin);
  assert.equal(FINANCE_COLLECTIONS.length,4);
  assert.deepEqual(FINANCE_COLLECTIONS,[
    "products","records","recordCorrections","revenueGoals"
  ]);
  assert.equal(gitBlob(originalSource()),ORIGINAL_BLOB);
  assert.throws(()=>makeCandidate(origin+" "),/SOURCE_SHA_CHANGED/);
  assert.throws(()=>makeCandidate(origin.replace("getIdToken(true)","getIdToken(false)")),
    /SOURCE_SHA_CHANGED/);
});

test("four financial collections are shown independently, with pending not treated as pass",()=>{
  assert.ok(script);
  assert.match(script,/const FINANCE_COLLECTIONS=Object\.freeze\(\["products","records","recordCorrections","revenueGoals"\]\)/);
  for(const name of FINANCE_COLLECTIONS){
    assert.match(candidate,new RegExp('id="'+name+'">未確認'));
    assert.match(script,new RegExp('name of FINANCE_COLLECTIONS'));
  }
  assert.match(candidate,/実績訂正履歴（LIST \/ GET）/);
  assert.match(candidate,/売上目標（LIST \/ GET）/);
  assert.match(script,/LIST拒否・GET未検証（合格ではない）/);
  assert.match(script,/for\(const name of \[\.\.\.FINANCE_COLLECTIONS,"counts"\]\)/);
  assert.match(script,/for\(const name of \["identity",\.\.\.FINANCE_COLLECTIONS,"counts"\]\)/);
});

test("only masked companyId projections and account-token read probes are supported",()=>{
  assert.match(script,/select:\{fields:\[\{fieldPath:"companyId"\}\]\}/);
  assert.match(script,/masked\(name\+"\/"\+target,\["companyId"\],token\)/);
  assert.match(script,/const token=await user\.getIdToken\(true\)/);
  assert.match(script,/location\.origin!=="https:\/\/nico-factory\.web\.app"/);
  assert.match(script,/readCompany\(token,user\.uid\)/);
  assert.match(script,/ownerHandoff\?\.company===account\.company/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|console\.log|writeBatch\(|setDoc\(/);
  assert.doesNotMatch(script,/\.fields\?\.(?:totalRevenue|unitPrice|cashback|targetRevenue)/);
  assert.doesNotMatch(candidate,/\/index\.html.*deploy|firebase deploy/);
});

test("partial Owner-proven document handoff works when other collections have no rows",()=>{
  const block=script.match(/if\(account\.role==="owner"\)\{\s*const verified=FINANCE_COLLECTIONS\.filter[\s\S]*?ownerHandoff=\{company:account\.company,ids\};\s*\}/)?.[0];
  assert.ok(block,"staged Owner handoff block must be safely extractable");
  const run=(role,probes)=>{
    const results=Object.fromEntries(FINANCE_COLLECTIONS.map(name=>
      [name,probes[name]||{listStatus:"denied",getStatus:"untested"}]));
    const previous=new Map([
      ["hub:products","hub-prod-01"],["hub:records","hub-rec-01"],
      ["hub:recordCorrections","../wrong"],["hub:revenueGoals","hub-goal-01"]
    ]);
    const ctx={account:{role,company:"hub"},results,previous,
      FINANCE_COLLECTIONS,ID:/^[A-Za-z0-9_-]{1,128}$/,ownerHandoff:null};
    runInNewContext(block,ctx);
    return ctx.ownerHandoff===null?null:JSON.parse(JSON.stringify(ctx.ownerHandoff));
  };
  assert.deepEqual(run("owner",{
    products:{listStatus:"allowed",getStatus:"allowed"},
    records:{listStatus:"allowed",getStatus:"allowed"},
    recordCorrections:{listStatus:"allowed",getStatus:"allowed"}
  }),{company:"hub",ids:{products:"hub-prod-01",records:"hub-rec-01"}});
  assert.equal(run("owner",{}),null);
  assert.equal(run("partner-verified",{
    products:{listStatus:"allowed",getStatus:"allowed"}
  }),null);
});

test("generated browser module has valid syntax and repeatable bytes",()=>{
  const check=spawnSync(process.execPath,["--check","--input-type=module"],{
    input:script,encoding:"utf8",timeout:15000
  });
  assert.equal(check.status,0,check.stderr||check.error?.message);
  assert.equal(makeCandidate(origin),candidate);
  assert.match(createHash("sha256").update(candidate).digest("hex"),/^[0-9a-f]{64}$/);
  assert.equal(readFileSync(new URL("../finance-boundary-check.html",import.meta.url),"utf8"),origin);
});
