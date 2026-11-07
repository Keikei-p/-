/**
 * Explicit FOUR-functions-only Firebase deployment scope, with immutable
 * original function inventory checks. No release logic is run from this
 * module: it verifies an approved operator's intended target set only.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const TARGETS=Object.freeze([
 'functions:partner-workspace:getPartnerWorkspace',
 'functions:partner-workspace:submitPartnerWorkspaceCounts',
 'functions:partner-workspace:managePartnerWorkspace',
 'functions:partner-workspace:acceptPartnerWorkspaceInvite'
]);
export const NAMES=Object.freeze(TARGETS.map(s=>s.split(':').at(-1)));
const ID=/^[A-Za-z0-9_.\/-]{1,256}$/;
const stop=code=>{throw Error('STOP_FOUR_COUNT_RELEASE_'+code);};
export function ensureExactOnly(command){
 if(typeof command!=='string'||command.split(',').length!==4||
  command.split(',').some(x=>!TARGETS.includes(x))||
  new Set(command.split(',')).size!==4)
  stop('EXTRA_FUNCTION_TARGET');
 return true;
}
export function inspectSource(indexText,jsonText){
 if(typeof indexText!=='string'||typeof jsonText!=='string')
  stop('UNREVIEWED_SOURCE');
 let cfg;
 try{cfg=JSON.parse(jsonText);}catch{stop('INVALID_CONFIG');}
 if(Object.keys(cfg).length!==1||
  cfg.functions?.source!=='functions-partner-workspace'||
  cfg.functions?.codebase!=='partner-workspace')stop('WRONG_CODEBASE');
 const allExports=[...indexText.matchAll(/exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)]
  .map(m=>m[1]);
 if(NAMES.some(n=>!allExports.includes(n))||new Set(allExports).size!==allExports.length)
  stop('FUNCTION_EXPORT_MISMATCH');
 // There are 8 total exports, including company-code Functions we must
 // never accidentally deploy. The CLI --only target restricts to four.
 if(allExports.length!==8)stop('UNREVIEWED_EXPORT_SET');
 if(!indexText.includes('PARTNER_WORKSPACE_ENABLED==="enabled"')||
    !indexText.includes('region:"asia-northeast1"'))stop('UNREVIEWED_FLAGS');
 return true;
}
export function parseFunctionInventory(json){
 const items=json?.result;
 if(!Array.isArray(items)||items.length>300)stop('FUNCTION_INVENTORY_UNAVAILABLE');
 const set=new Set();
 for(const item of items){
  const id=item?.id||item?.name;
  if(typeof id!=='string'||!ID.test(id)||set.has(id))
   stop('FUNCTION_INVENTORY_INVALID');
  set.add(id);
 }
 return set;
}
const basename=id=>id.split('/').at(-1);
// A matching basename alone does not prove project/region identity. The CLI
// can return short function IDs or fully qualified v2 resource names.
// Fail closed on foreign projects, foreign regions and ambiguous aliases.
const approvedNewIdentifier=id=>{
 if(NAMES.includes(id))return true;
 const match=id.match(/^projects\/sales-management-cc116\/locations\/asia-northeast1\/functions\/([A-Za-z][A-Za-z0-9_]*)$/);
 return Boolean(match&&NAMES.includes(match[1]));
};
export function compareBeforeAfter(before,after){
 const initial=parseFunctionInventory(before),later=parseFunctionInventory(after);
 for(const id of initial)if(!later.has(id))stop('ORIGINAL_FUNCTION_DISAPPEARED');
 // These four must be *new*. A partly deployed previous release requires
 // an independent read-only investigation, never a blind resume.
 if([...initial].some(id=>NAMES.includes(basename(id))))
  stop('TARGET_ALREADY_PRESENT');
 const added=[...later].filter(id=>!initial.has(id));
 for(const n of NAMES)if(![...later].some(id=>basename(id)===n))
  stop('EXPECTED_COUNT_FUNCTION_MISSING');
 if(added.length!==4||added.some(id=>!approvedNewIdentifier(id)))
  stop('UNAPPROVED_NEW_FUNCTION');
 if(new Set(added.map(basename)).size!==4)
  stop('DUPLICATE_FUNCTION_IDENTITY');
 return Object.freeze({
  originalFunctionIdsPreserved:true,
  requiredFourPresentInInventory:true,
  onlyApprovedFunctionNamesAdded:true,
  actualEndUserCountEntryProved:false,
  realPartnerFinanceDenyVerified:false,
  safeToCutOverRules:false
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const index=readFileSync(new URL('../../functions-partner-workspace/index.js',import.meta.url),'utf8');
  const config=readFileSync(new URL('../../firebase.partner-workspace.json',import.meta.url),'utf8');
  inspectSource(index,config);
  ensureExactOnly(TARGETS.join(','));
  console.log('FOUR_COUNT_TARGET_SCOPE_OK');
 }catch(e){
  console.error(/^STOP_FOUR_COUNT_RELEASE_[A-Z0-9_]+$/.test(e?.message||'')?
   e.message:'STOP_FOUR_COUNT_RELEASE_UNVERIFIED');
  process.exitCode=1;
 }
}
