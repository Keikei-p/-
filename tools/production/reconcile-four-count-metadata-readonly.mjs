#!/usr/bin/env node
/**
 * Production audit RECONCILIATION ONLY. Never invokes a function or writes
 * Firestore, Auth, Rules, Cloud Functions, Hosting, billing, or IAM.
 *
 * The v2 per-name GET auditor currently marks four deployed callable
 * Functions as absent/inactive even when Firebase CLI's regional deployed
 * inventory reports all four Gen2 ACTIVE and PARTNER_WORKSPACE_ENABLED.
 * Preserve that disagreement, but independently verify exact CLI identities
 * and metadata rather than reporting a false missing-deployment blocker.
 * Every log is aggregate boolean-only, never raw API responses.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyInventory,REGION,TARGETS,PROJECT} from './inspect-four-count-cli-region-readonly.mjs';
import {summarize as summarizeDirect} from './inspect-live-partner-callables-readonly.mjs';

const stop=code=>{throw Error('STOP_COUNT_METADATA_RECONCILIATION_'+code);};
const expectedMode='CLOUD_FUNCTIONS_METADATA_GET_ONLY';
export const OUTPUT_PREFIX='PARTNER_COUNT_FUNCTION_METADATA ';

function checkedOriginal(original){
 if(!original||original.project!==PROJECT||original.region!==REGION||
    original.mode!==expectedMode||
    !original.functions||typeof original.functions!=='object'||
    Object.keys(original.functions).sort().join('|')!==[...TARGETS].sort().join('|'))
   stop('INVALID_DIRECT_AUDIT');
 for(const name of TARGETS){
  const f=original.functions[name];
  if(!f||Object.keys(f).sort().join('|')!==
      ['deployed','active','callableGen2','countEnabled'].sort().join('|')||
     !['deployed','active','callableGen2','countEnabled']
       .every(key=>typeof f[key]==='boolean'))
   stop('INVALID_DIRECT_SHAPE');
 }
 if(original.actualCallableInvoked!==false||original.realPartnerCountEntryVerified!==false||
    original.realPartnerFinanceDenyVerified!==false||
    original.originalSalesDataWrites!==0||original.safeToCutOverRules!==false)
   stop('DIRECT_AUDIT_CONTRACT');
}
export function reconcile(primary,cliJson){
 checkedOriginal(primary);
 let cli;
 try{cli=classifyInventory(cliJson);}
 catch{stop('INVALID_CLI_EVIDENCE');}
 if(cli.project!==PROJECT||cli.mode!=='SANITIZED_FUNCTIONS_LIST_READ_ONLY'||
    Object.keys(cli.functions).sort().join('|')!==[...TARGETS].sort().join('|')||
    cli.liveFunctionInvocations!==0||cli.productionDocumentWrites!==0||
    cli.deploymentAuthorized!==false||cli.financeRulesChangeAuthorized!==false)
  stop('INVALID_CLI_CONTRACT');
 const rows=[];
 let disagreement=false;
 for(const name of TARGETS){
  const item=cli.functions[name];
  if(!item)stop('MISSING_CLI_TARGET');
  const ready=item.entries===1&&item.inTargetRegion===1&&
    item.outsideTargetRegion===0&&item.regionUnknown===0&&
    item.projectUnknown===0&&item.otherProject===0&&
    item.gen1Listed===0&&item.gen2Listed===1&&
    item.generationUnknown===0&&item.stateKnown===1&&item.activeState===1&&
    item.codebaseKnown===1&&item.expectedCodebase===1&&
    item.workspaceFlagKnown===1&&item.workspaceFlagEnabled===1;
  const next={name,deployed:ready,active:ready,callableGen2:ready,countEnabled:ready};
  if(['deployed','active','callableGen2','countEnabled']
    .some(key=>primary.functions[name][key]!==next[key]))disagreement=true;
  rows.push(next);
 }
 const result=summarizeDirect(rows,{metadataListFallbackUsed:false,directGetListConflict:false});
 if(result.project!==PROJECT||result.region!==REGION||result.safeToCutOverRules!==false)
  stop('INVALID_FINAL_REPORT');
 return Object.freeze({...result,
  metadataEvidence:'FIREBASE_CLI_INDEPENDENT_REGIONAL_CROSSCHECK',
  metadataSourcesDisagree:disagreement,
  directApiListFallbackUsed:primary.metadataListFallbackUsed===true,
  // No REAL USER request is made; no financial read authorization is proven.
  actualCallableInvoked:false,realPartnerCountEntryVerified:false,
  realPartnerFinanceDenyVerified:false,originalSalesDataWrites:0,
  safeToCutOverRules:false});
}
export function parsePrivateDirectLog(source){
 if(typeof source!=='string'||source.length>1000000)stop('INVALID_PRIVATE_LOG');
 const values=source.split(/\r?\n/).filter(line=>line.startsWith(OUTPUT_PREFIX));
 if(values.length!==1)stop('DIRECT_REPORT_COUNT');
 let report;
 try{report=JSON.parse(values[0].slice(OUTPUT_PREFIX.length));}
 catch{stop('DIRECT_REPORT_JSON');}
 checkedOriginal(report);
 return report;
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='Keikei-p/-'||
    process.env.GITHUB_REF!=='refs/heads/main'||process.env.FIREBASE_PROJECT_ID!==PROJECT||
    !process.env.RUNNER_TEMP||process.argv.length!==4)
   stop('RUNNER_GATE');
 const paths=process.argv.slice(2).map(x=>path.resolve(x));
 const directory=path.resolve(process.env.RUNNER_TEMP);
 if(paths.some(x=>!path.isAbsolute(x)||path.dirname(x)!==directory)||
    path.basename(paths[0])!=='nico-readiness-functions-rest.private.log'||
    path.basename(paths[1])!=='nico-readiness-cli.private.json')
   stop('PRIVATE_PATH');
 const report=parsePrivateDirectLog(readFileSync(paths[0],'utf8'));
 let cli;
 try{cli=JSON.parse(readFileSync(paths[1],'utf8'));}
 catch{stop('CLI_JSON');}
 const summary=reconcile(report,cli);
 console.log(OUTPUT_PREFIX+JSON.stringify(summary));
 if(summary.metadataSourcesDisagree)
  console.log('BLOCK_DIFFERENT_FUNCTION_METADATA_DISCOVERY_METHODS__NOT_A_RULES_RELEASE');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_COUNT_METADATA_RECONCILIATION_[A-Z0-9_]+$/.test(e?.message||'')?
   e.message:'STOP_COUNT_METADATA_RECONCILIATION_UNVERIFIED');
  process.exitCode=1;
 });
}
