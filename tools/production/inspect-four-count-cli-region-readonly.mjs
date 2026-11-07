#!/usr/bin/env node
/** Sanitized Firebase CLI Functions inventory. No credentials or data writes. */
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
export const PROJECT="sales-management-cc116";
export const REGION="asia-northeast1";
export const TARGETS=Object.freeze([
  "getPartnerWorkspace","submitPartnerWorkspaceCounts",
  "managePartnerWorkspace","acceptPartnerWorkspaceInvite"
]);
const stop=code=>{throw Error("STOP_FOUR_COUNT_CLI_INVENTORY_"+code);};
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function classifyInventory(json){
  if(!isObj(json)||!Array.isArray(json.result)||json.result.length>500)
    stop("UNTRUSTED_LIST");
  const rows={};
  for(const name of TARGETS)rows[name]=[];
  for(const item of json.result){
    if(!isObj(item))stop("UNTRUSTED_ROW");
    const rawId=item.id??item.name;
    if(typeof rawId!=="string"||rawId.length>500)stop("UNTRUSTED_IDENTIFIER");
    const basename=rawId.split("/").at(-1);
    if(!TARGETS.includes(basename))continue;
    const resource=rawId.match(/^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/);
    const rawRegion=item.region??item.location??item.regionId??resource?.[2];
    const region=typeof rawRegion==="string"&&/^[a-z0-9-]+$/.test(rawRegion)?rawRegion:null;
    const rawProject=item.projectId??item.project??resource?.[1]??null;
    const targetProject=rawProject===null?"unknown":rawProject===PROJECT?"yes":"no";
    const platform=item.platform??item.generation??"";
    const gen=/(?:gcfv1|gen1|1st)/i.test(platform)?"gen1":
      /(?:gcfv2|gen2|2nd)/i.test(platform)?"gen2":"unknown";
    rows[basename].push({region,targetProject,gen});
  }
  const functions={};
  for(const name of TARGETS){
    const arr=rows[name];
    functions[name]={
      listed:arr.length>0,
      entries:arr.length,
      inTargetRegion:arr.filter(x=>x.region===REGION).length,
      outsideTargetRegion:arr.filter(x=>x.region!==null&&x.region!==REGION).length,
      regionUnknown:arr.filter(x=>x.region===null).length,
      projectUnknown:arr.filter(x=>x.targetProject==="unknown").length,
      otherProject:arr.filter(x=>x.targetProject==="no").length,
      gen1Listed:arr.filter(x=>x.gen==="gen1").length,
      gen2Listed:arr.filter(x=>x.gen==="gen2").length,
      generationUnknown:arr.filter(x=>x.gen==="unknown").length
    };
  }
  return Object.freeze({project:PROJECT,mode:"SANITIZED_FUNCTIONS_LIST_READ_ONLY",
    functions,liveFunctionInvocations:0,productionDocumentWrites:0,
    deploymentAuthorized:false,financeRulesChangeAuthorized:false});
}
async function main(){
  if(process.env.GITHUB_ACTIONS!=="true"||
      process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
      process.env.GITHUB_REF!=="refs/heads/main"||
      process.env.FIREBASE_PROJECT_ID!==PROJECT||!process.env.RUNNER_TEMP||
      process.argv.length!==3||path.dirname(path.resolve(process.argv[2]))!==path.resolve(process.env.RUNNER_TEMP))
    stop("APPROVED_GITHUB_READONLY_ONLY");
  const result=classifyInventory(JSON.parse(readFileSync(process.argv[2],"utf8")));
  console.log("FOUR_COUNT_CLI_SCOPE "+JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error(/^STOP_FOUR_COUNT_CLI_INVENTORY_[A-Z0-9_]+$/.test(e?.message||"")?
      e.message:"STOP_FOUR_COUNT_CLI_INVENTORY_UNKNOWN");
    process.exitCode=1;
  });
