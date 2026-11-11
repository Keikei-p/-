import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const workflow=fs.readFileSync(path.join(root,".github/workflows/nico-factory-sync.yml"),"utf8");
const assets=[
 "ranking/owner-product-visibility-dashboard-mount.mjs",
 "ranking/owner-product-visibility-firebase-bridge.mjs",
 "ranking/owner-product-visibility-panel.mjs",
 "ranking/owner-product-visibility-panel.css"
];
const verification=workflow.slice(
 workflow.indexOf("- name: Verify project and ensure complete public asset set"),
 workflow.indexOf("- name: Create ephemeral credentials file")
);
const copy=workflow.slice(
 workflow.indexOf("- name: Copy original application files without modifications"),
 workflow.indexOf("- name: Deploy ONLY public Hosting files")
);

test("official Hosting remains manual and keeps the finance preflight before credentials",()=>{
 assert.match(workflow,/^  workflow_dispatch:\s*$/m);
 assert.doesNotMatch(workflow,/^  (?:push|pull_request|schedule):/m);
 assert.match(workflow,/inputs\.release_confirmation == 'CONFIRM_NICO_HOSTING_RELEASE'/);
 const preflight=workflow.indexOf("node scripts/nico-production-cutover-preflight.mjs");
 const credentials=workflow.indexOf("- name: Create ephemeral credentials file");
 const deploy=workflow.indexOf("- name: Deploy ONLY public Hosting files");
 assert(preflight>=0&&credentials>preflight&&deploy>credentials);
 assert.match(workflow,/firebase deploy --only hosting --config \.nico-only-hosting-config\.json/);
});

test("all four owner-only UI assets exist and are included in both verification and Hosting copy",()=>{
 assert(verification.length>0&&copy.length>0);
 assert.match(copy,/mkdir -p \.nico-hosting-staging\/ranking/);
 for(const asset of assets){
  assert(fs.statSync(path.join(root,asset)).isFile(),asset+" missing");
  assert(verification.includes("'"+asset+"'"),asset+" absent from preflight");
  assert(copy.includes(asset),asset+" absent from Hosting copy");
 }
 assert.match(copy,/cmp "\$f" "\.nico-hosting-staging\/\$f"/);
});

test("dashboard mount imports only files included in the approved public asset set",()=>{
 const source=fs.readFileSync(path.join(root,assets[0]),"utf8");
 const dependencies=[...source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)]
  .map(m=>"ranking/"+m[1].slice(2));
 assert(dependencies.length>0);
 for(const dependency of dependencies)
  assert(assets.includes(dependency),"Unpackaged UI import: "+dependency);
});

test("only verified count GET is routed, without automatic Function deployment",()=>{
 const match=workflow.match(/cat > \.nico-only-hosting-config\.json <<'JSON'\n([\s\S]*?)\n\s*JSON/);
 assert(match,"Hosting config heredoc missing");
 const config=JSON.parse(match[1]);
 assert.equal(config.hosting.site,"nico-factory");
 assert.equal(config.hosting.public,".nico-hosting-staging");
 assert.deepEqual(config.hosting.rewrites,[{
  source:"/v1/owner-visible-counts",
  function:{functionId:"getVerifiedJointCountRanking",region:"asia-northeast1"}
 }]);
 // No pinTag: firebase deploy --only hosting must never deploy Functions.
 assert.doesNotMatch(workflow,/"pinTag"\\s*:/);
 assert.doesNotMatch(copy,/firebase deploy|firestore:rules|functions:/);
});


test("same-app joint count runtime assets are in the manually staged Hosting package",()=>{
 const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
 const bridge="ranking/verified-joint-month-http-bridge.mjs";
 const view="ranking/verified-dual-count-view.mjs";
 const css="ranking/verified-dual-count-view.css";
 assert.match(html,/import\(\s*["']\.\/ranking\/verified-joint-month-http-bridge\.mjs["']\s*\)/);
 assert.match(html,/sameAppJointMonthStyle\.href=["']\.\/ranking\/verified-dual-count-view\.css["']/);
 const source=fs.readFileSync(path.join(root,bridge),"utf8");
 assert.match(source,/from\s+["']\.\/verified-dual-count-view\.mjs["']/);
 for(const asset of [bridge,view,css]){
  assert(fs.statSync(path.join(root,asset)).isFile(),asset+" missing");
  assert(verification.includes("'"+asset+"'"),asset+" missing in preflight");
  assert(copy.includes(asset),asset+" missing in staging copy");
 }
 assert.doesNotMatch(workflow,/^  (?:push|pull_request|schedule):/m);
});
