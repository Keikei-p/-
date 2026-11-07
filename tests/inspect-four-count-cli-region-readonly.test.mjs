import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyInventory,PROJECT,REGION,TARGETS} from "../tools/production/inspect-four-count-cli-region-readonly.mjs";
const row=(name,region,platform)=>({id:name,region,platform});
test("other-region name collision is not target-region deployment",()=>{
 const report=classifyInventory({result:[row(TARGETS[0],"us-central1","gcfv1")]});
 assert.equal(report.functions[TARGETS[0]].listed,true);
 assert.equal(report.functions[TARGETS[0]].outsideTargetRegion,1);
 assert.equal(report.functions[TARGETS[0]].inTargetRegion,0);
 assert.equal(report.deploymentAuthorized,false);
 assert.equal(report.productionDocumentWrites,0);
});
test("recognize exact target region and safely classify missing region as unknown",()=>{
 const data=classifyInventory({result:[
  {name:"projects/"+PROJECT+"/locations/"+REGION+"/functions/"+TARGETS[1],platform:"gcfv2"},
  {id:TARGETS[2]},{id:"unrelatedUserFunction",region:REGION}
 ]});
 assert.equal(data.functions[TARGETS[1]].inTargetRegion,1);
 assert.equal(data.functions[TARGETS[1]].gen2Listed,1);
 assert.equal(data.functions[TARGETS[2]].regionUnknown,1);
 assert.equal(Object.keys(data.functions).length,4);
 assert.equal(JSON.stringify(data).includes("unrelatedUserFunction"),false);
});
test("disallow malformed list and do not copy opaque metadata or secrets into logs",()=>{
 assert.throws(()=>classifyInventory({result:{}}),/STOP_FOUR_COUNT_CLI_INVENTORY_UNTRUSTED_LIST/);
 assert.throws(()=>classifyInventory({result:[null]}),/STOP_FOUR_COUNT_CLI_INVENTORY_UNTRUSTED_ROW/);
 const sensitive="password-key-private-user";
 const a=classifyInventory({result:[{id:TARGETS[0],region:"us-central1",platform:"gcfv2",
  secret:sensitive,url:"https://secret.example",environmentVariables:{TOKEN:sensitive}}]});
 assert.equal(JSON.stringify(a).includes(sensitive),false);
 assert.equal(a.functions[TARGETS[0]].gen2Listed,1);
});
test("workflow is GET-only and frozen original financial sources are unchanged",()=>{
 const w=readFileSync(new URL("../.github/workflows/nico-four-count-cli-region-readonly-20261108.yml",import.meta.url),"utf8");
 assert.match(w,/firebase functions:list --project/);
 assert.match(w,/inspect-four-count-cli-region-readonly\.mjs/);
 assert.match(w,/functions\/index\.js/);
 assert.match(w,/firestore\.rules/);
 assert.doesNotMatch(w,/firebase deploy|gcloud functions deploy|firestore:rules|firebase functions:delete/);
 assert.match(w,/rm -f/);
});

test("CLI ACTIVE, codebase and enabled flags are only published as safe counts",()=>{
 const secret="private_api_key_DO_NOT_LOG";
 const report=classifyInventory({result:[{
  id:TARGETS[0],region:REGION,platform:"gcfv2",status:"ACTIVE",
  codebase:"partner-workspace",
  environmentVariables:{PARTNER_WORKSPACE_ENABLED:"enabled",API_TOKEN:secret},
  serviceConfig:{uri:"https://private.example",environmentVariables:{API_TOKEN:secret}}
 },{
  id:TARGETS[1],region:REGION,platform:"gcfv2",state:"FAILED",
  codebase:"another-codebase"
 }]});
 const a=report.functions[TARGETS[0]],b=report.functions[TARGETS[1]];
 assert.equal(a.activeState,1);
 assert.equal(a.expectedCodebase,1);
 assert.equal(a.workspaceFlagKnown,1);
 assert.equal(a.workspaceFlagEnabled,1);
 assert.equal(b.activeState,0);
 assert.equal(b.codebaseKnown,1);
 assert.equal(b.expectedCodebase,0);
 assert.equal(b.workspaceFlagKnown,0);
 assert.equal(JSON.stringify(report).includes(secret),false);
 assert.equal(JSON.stringify(report).includes("https://private.example"),false);
});
