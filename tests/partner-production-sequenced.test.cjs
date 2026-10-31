"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("one-shot workflow dispatches the three original manual-gated releases in safe dependency order",()=>{
 const source=read(".github/workflows/nico-partner-full-sequenced-once.yml");
 assert.match(source,/^on:\n  push:\n    branches: \[main\]/m);
 assert.match(source,/github.actor == 'Keikei-p'/);
 assert.match(source,/startsWith\(github.event.head_commit.message/);
 assert.match(source,/gh api repos\/Keikei-p\/\-\/branches\/main/);
 const names=["nico-partner-quick-release.yml","nico-partner-workspace-release.yml","nico-ranking-index-only-release.yml"];
 const index=names.map(name=>source.indexOf("launch_and_wait '"+name+"'"));
 assert.ok(index.every(v=>v>0));
 assert.ok(index[0]<index[1]&&index[1]<index[2]);
 assert.match(source,/gh run watch "\$run" --repo "\$repo" --exit-status/);
 assert.match(source,/gh run view "\$run"/);
 assert.match(source,/API_DENY_PASS/);
 assert.doesNotMatch(source,/firebase deploy|firebase firestore|--only hosting|gh secret set/);
});
test("existing partner release workflows never auto publish on normal PR or main push",()=>{
 for(const file of ["nico-partner-quick-release.yml","nico-partner-workspace-release.yml","nico-ranking-index-only-release.yml"]){
  const src=read(".github/workflows/"+file);
  assert.match(src,/workflow_dispatch:/);
  assert.match(src,/github.event_name == 'workflow_dispatch'/);
  assert.match(src,/github.ref == 'refs\/heads\/main'/);
  assert.match(src,/needs.validate.result == 'success'/);
 }
});
test("quick function build error is not silently approved without post-deploy live function and anonymous checks",()=>{
 const src=read(".github/workflows/nico-partner-quick-release.yml");
 assert.match(src,/id: deploy_quick/);
 assert.match(src,/continue-on-error: true/);
 assert.ok(src.indexOf("Verify new pair and existing 4 Functions")>src.indexOf("id: deploy_quick"));
 assert.ok(src.indexOf("Read-only unauthenticated count API denial check")>src.indexOf("Verify new pair and existing 4 Functions"));
 assert.match(src,/PARTIAL_COUNT_DEPLOY_STOP/);
 assert.match(src,/ORIGINAL_FUNCTION_MISSING/);
});
test("partner pages and backends remain independent of finance originals",()=>{
 for(const name of ["partner-counts.html","partner-workspace.html"]){
  const src=read(name);
  assert.doesNotMatch(src,/firebase-firestore\.js|\bgetFirestore\(|\bcollection\(/);
 }
 for(const name of ["functions-partner-quick/quick-counts.cjs","functions-partner-workspace/service.cjs"]){
  const src=read(name);
  assert.doesNotMatch(src,/\.collection\(\s*["'](?:products|records|recordCorrections|revenueGoals)["']\s*\)/);
  assert.match(src,/accessKind/);
  assert.match(src,/canViewRevenue/);
 }
});
