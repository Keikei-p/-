#!/usr/bin/env node
/**
 * Offline release-path compatibility diagnostic for NICO sales.
 * Never deploys, reads credentials, or accesses production data.
 * A passing diagnostic means ONLY that known blockers were identified.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOTS=[
  ['products','read'],['records','read'],
  ['recordCorrections','read'],['revenueGoals','read'],
  ['teams','read'],['linePairingCodes','get']
];
const digest=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n').trim()).digest('hex');

function ruleBlock(source,collection){
  const start=new RegExp('^    match /'+collection+'/\\{[A-Za-z]+\\} \\{','m').exec(source);
  if(!start)return '';
  const end=source.indexOf('\n    match /',start.index+start[0].length);
  return source.slice(start.index,end<0?undefined:end);
}

export function inspectPartnerReleaseReadiness(input){
  const {rules,manualRelease,financeGate,financeWorkflow,hostingWorkflow,browser}=input;
  for(const [name,value] of Object.entries(input)){
    if(typeof value!=='string'||value.length<20)throw Error('RELEASE_INPUT_MISSING_'+name);
  }
  const blockers=[];
  if(!rules.includes('function noSecondaryPartnerWorkspace()')||
     !rules.includes('!exists(/databases/$(database)/documents/partnerWorkspaceContexts/$(request.auth.uid))')){
    blockers.push('PARTNER_SECONDARY_UID_GUARD_MISSING');
  }
  for(const [collection,verb] of ROOTS){
    const block=ruleBlock(rules,collection);
    const expected=new RegExp('allow\\s+'+verb+'\\s*:\\s*if\\s+noSecondaryPartnerWorkspace\\(\\)');
    if(!expected.test(block)){
      blockers.push('PARTNER_RAW_READ_GUARD_MISSING_'+collection);
    }
  }
  const candidateSha256=digest(rules);
  const oldPin=manualRelease.match(/export const CANDIDATE='([a-f0-9]{64})'/);
  if(!oldPin||oldPin[1]!==candidateSha256){
    blockers.push('MANUAL_RELEASE_RULES_SHA_PIN_MISMATCH');
  }
  if(!financeWorkflow.includes('node scripts/check-finance-read-boundary-before-deploy.mjs')||
     !financeGate.includes('function isInternalFinanceReader(companyId)')){
    blockers.push('FINANCE_RELEASE_GATE_UNRECOGNIZED');
  }else if(!rules.includes('function isInternalFinanceReader(companyId)')){
    blockers.push('CURRENT_FINANCE_GATE_REQUIRES_DIFFERENT_RULES_CONTRACT');
  }
  if(/function\s+recordsCollectionQuery\s*\(|function\s+persistDailyRecord\s*\(/.test(browser)){
    blockers.push('LEGACY_BROWSER_STILL_USES_RAW_SALES_COLLECTIONS');
  }
  if(!hostingWorkflow.includes('node scripts/nico-production-cutover-preflight.mjs')){
    blockers.push('HOSTING_SAFETY_PREFLIGHT_MISSING');
  }
  if(!/^\s*workflow_dispatch:/m.test(financeWorkflow)||
     !financeWorkflow.includes("github.ref == 'refs/heads/main'")||
     !financeWorkflow.includes("VERIFIED_NICO_URL_AND_DATA")){
    blockers.push('MANUAL_MAIN_RELEASE_GUARD_MISSING');
  }
  // This tool has no real user tokens or access to production backup content.
  // Never equate a static PASS with production deployment approval.
  return Object.freeze({
    candidateRulesSha256,
    manualReleasePinnedSha256:oldPin?.[1]||null,
    staticReleasePathCompatible:blockers.length===0,
    productionApproved:false,
    realOwnerAndPartnerUidVerified:false,
    productionBackupRestoredAndVerified:false,
    blockers:Object.freeze(blockers)
  });
}
const self=fileURLToPath(import.meta.url);
if(process.argv[1]===self){
  const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
  const result=inspectPartnerReleaseReadiness({
    rules:read('firestore.rules'),
    manualRelease:read('tools/production/release-partner-boundary.mjs'),
    financeGate:read('scripts/check-finance-read-boundary-before-deploy.mjs'),
    financeWorkflow:read('.github/workflows/firebase-production-deploy.yml'),
    hostingWorkflow:read('.github/workflows/nico-factory-sync.yml'),
    browser:read('index.html')
  });
  console.log(JSON.stringify(result,null,2));
  const expected=[
    'MANUAL_RELEASE_RULES_SHA_PIN_MISMATCH',
    'CURRENT_FINANCE_GATE_REQUIRES_DIFFERENT_RULES_CONTRACT',
    'LEGACY_BROWSER_STILL_USES_RAW_SALES_COLLECTIONS'
  ];
  if(process.argv.length===3&&process.argv[2]==='--assert-known-blockers'){
    if(!expected.every(code=>result.blockers.includes(code))||
       result.productionApproved||result.staticReleasePathCompatible||
       result.blockers.some(code=>code.includes('MISSING'))){
      console.error('STOP_RELEASE_DIAGNOSTIC_CHANGED_REQUIRE_FRESH_REVIEW');
      process.exitCode=2;
    }else{
      console.log('PASS_KNOWN_RELEASE_BLOCKERS_IDENTIFIED_NO_DEPLOYMENT');
    }
  }else{
    // Do not return success if called as a release permission check.
    console.error('STOP_PRODUCTION_RELEASE_NOT_APPROVED');
    process.exitCode=2;
  }
}
