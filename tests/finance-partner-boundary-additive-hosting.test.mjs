import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateManifest,uploadAdditiveFinancePartnerBoundaryCheck,ASSET} from '../tools/hosting/additive-finance-partner-boundary-diagnostic.mjs';
const page=readFileSync(new URL('../finance-partner-boundary-check.html',import.meta.url));
const hash='b'.repeat(64);
const original=['/index.html','/partner-invite.html','/partner-counts.html',
 '/partner-workspace.html','/service-worker.js','/script.js','/style.css',
 '/manifest.webmanifest','/icon-192.png','/icon-512.png'];
const manifest=()=>original.map((p,i)=>({path:p,hash:String(i).padStart(64,'a')}));
test('new diagnostic is one NEW asset, original finance/PWA/partner bytes kept verbatim',()=>{
 assert.equal(ASSET,'/finance-partner-boundary-check.html');
 const before=manifest();
 const out=validateManifest(before,new Map([[ASSET,hash]]),before.length);
 assert.equal(out.original.size,before.length);
 assert.equal(out.next.size,before.length+1);
 for(const f of before)assert.equal(out.next.get(f.path),f.hash);
 assert.equal(out.next.get(ASSET),hash);
 assert.throws(()=>validateManifest([...before,{path:ASSET,hash}],new Map([[ASSET,hash]]),before.length+1),
  /EXISTING_DIAGNOSTIC/);
 assert.throws(()=>validateManifest(before,new Map([['/index.html',hash]]),before.length));
 assert.throws(()=>validateManifest(before,new Map([[ASSET,hash]]),before.length+1));
 assert.throws(()=>validateManifest([...before,before[0]],new Map([[ASSET,hash]]),before.length+1));
});
test('Hosting preview invokes GET only, does not mutate anything even if count metadata omitted',async()=>{
 const calls=[];
 const old='sites/nico-factory/versions/a1';
 const request=async(method,url,body)=>{
  calls.push({method,url,body});
  if(url.endsWith('/releases?pageSize=1'))return {releases:[{version:{name:old}}]};
  if(url.endsWith('/'+old))return {name:old,status:'FINALIZED',config:{rewrites:[]}};
  if(url.includes('/'+old+'/files?'))return {files:manifest()};
  throw Error('unexpected API');
 };
 const result=await uploadAdditiveFinancePartnerBoundaryCheck({
  assetBytes:page,request,release:false,log:()=>{}
 });
 assert.equal(result.released,false);
 assert.equal(result.originalCount,original.length);
 assert.ok(calls.length>=3);
 assert.ok(calls.every(c=>c.method==='GET'));
 assert.ok(calls.every(c=>c.body===undefined));
});
test('unexpected live file/identity or source list causes STOP and never writes',async()=>{
 const old='sites/nico-factory/versions/old';
 const makeRequest=files=>async(method,url)=>{
  assert.equal(method,'GET');
  if(url.endsWith('/releases?pageSize=1'))return {releases:[{version:{name:old}}]};
  if(url.endsWith('/'+old))return {name:old,status:'FINALIZED',config:{},fileCount:files.length};
  if(url.includes('/'+old+'/files?'))return {files};
  throw Error('unexpected');
 };
 await assert.rejects(uploadAdditiveFinancePartnerBoundaryCheck({
  assetBytes:page,request:makeRequest(manifest().filter(f=>f.path!=='/index.html')),
  release:true,log:()=>{}
 }),/LIVE_REQUIRED_ASSETS_UNVERIFIED/);
 await assert.rejects(uploadAdditiveFinancePartnerBoundaryCheck({
  assetBytes:page,request:makeRequest([...manifest(),{path:ASSET,hash}]),
  release:true,log:()=>{}
 }),/EXISTING_DIAGNOSTIC/);
});
test('Hosting publisher cannot replace an existing route or mutate finance/account collections',()=>{
 const source=readFileSync(new URL('../tools/hosting/additive-finance-partner-boundary-diagnostic.mjs',import.meta.url),'utf8');
 assert.match(source,/if\(original\.has\(ASSET\)\)throw/);
 assert.match(source,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(source,/ORIGINAL_FILE_MODIFIED/);
 assert.match(source,/FINAL_ASSET_HASH_MISMATCH/);
 assert.match(source,/FINAL_VERSION_CONFIG_UNVERIFIED/);
 assert.match(source,/NICO_FINANCE_PARTNER_DIAGNOSTIC_RELEASE_CONFIRMATION/);
 assert.match(source,/CONFIRM_ADD_PARTNER_FINANCE_DIAGNOSTIC_ONLY/);
 assert.doesNotMatch(source,/firebase deploy|firestore\.googleapis\.com|functions:deploy|firebase\.auth/);
});
