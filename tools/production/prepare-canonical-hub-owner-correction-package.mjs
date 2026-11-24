/** Offline package preparation for the existing Owner codebase. No deploy or flags. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {INTEGRATED_CANDIDATE,makeIntegratedCandidateOwnerPackage,writeIntegratedDisposablePackage}
 from './prepare-hub-owner-correction-v3-package.mjs';
export const CODEBASE='hub-owner-correction-v3';
export const OWNER_SOURCE='functions-hub-owner-correction';
export function prepareCanonicalOwnerPackage(root){
 const files=Object.fromEntries(Object.keys(INTEGRATED_CANDIDATE).map(p=>
  [p,readFileSync(resolve(root,p),'utf8')]));
 const prepared=makeIntegratedCandidateOwnerPackage(files);
 return {bundle:prepared.bundle,report:{...prepared.report,
  exportedNames:prepared.report.exports,sourceMirrorsCommitted:false,flagsChanged:false,productionWrites:0,
  fileHashes:Object.fromEntries(Object.entries(prepared.bundle).map(([p,s])=>[p,createHash('sha256').update(s).digest('hex')]))}};
}
export function writeCanonicalOwnerPackage(prepared,destination){
 writeIntegratedDisposablePackage(prepared,destination);return prepared.report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,root,destination,...extra]=process.argv.slice(2);
  if(mode!=='--prepare'||!root||!destination||extra.length)throw Error('PREPARE_ONLY');
  console.log(JSON.stringify(writeCanonicalOwnerPackage(prepareCanonicalOwnerPackage(root),destination)));
 }catch{console.error('STOP_EXISTING_OWNER_PACKAGE_UNVERIFIED');process.exitCode=1;}
}
