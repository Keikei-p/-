import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {
 ASSET,EXACT_PREVIOUS_VERSION,EXACT_PREVIOUS_GIT_BLOB,
 validateManifest,uploadReviewedFinanceMobileLogin
} from '../tools/hosting/surgical-finance-boundary-mobile-login.mjs';

const old=execFileSync('git',['show',
 '2c10e27bb6a92684470c74388a76cad3d0f3ee4c:finance-boundary-check.html'],
 {maxBuffer:1024*1024});
const latest=readFileSync(new URL('../finance-boundary-check.html',import.meta.url));
const hex=b=>createHash('sha256').update(b).digest('hex');
const oldHash=hex(gzipSync(old,{mtime:0})),newHash=hex(gzipSync(latest,{mtime:0}));
const oldBlob=createHash('sha1').update('blob '+old.length+String.fromCharCode(0)).update(old).digest('hex');
const original=[
 '/index.html','/partner-invite.html','/partner-counts.html','/partner-workspace.html',
 '/service-worker.js','/script.js','/style.css','/manifest.webmanifest',
 '/icon-192.png','/icon-512.png','/icon-180.png',ASSET
].map((path,i)=>({path,hash:path===ASSET?oldHash:String(i).padStart(64,'a')}));
const originalMap=new Map(original.map(f=>[f.path,f.hash]));
const version=EXACT_PREVIOUS_VERSION;
const fake=(files=original,sourceVersion=version)=>{
 const calls=[];
 const request=async(method,url,body)=>{
  calls.push({method,url,body});
  if(method!=='GET')throw Error('NO_TEST_REMOTE_WRITES');
  if(url.endsWith('/sites/nico-factory/releases?pageSize=1'))
   return {releases:[{version:{name:sourceVersion}}]};
  if(url.endsWith('/'+sourceVersion))return {
   name:sourceVersion,status:'FINALIZED',config:{rewrites:[]}
  };
  if(url.includes('/'+sourceVersion+'/files?'))return {files};
  throw Error('UNRECOGNIZED_TEST_URL');
 };
 return {request,calls};
};
test('previous production page is pinned to actual merged Git blob',()=>{
 assert.equal(oldBlob,EXACT_PREVIOUS_GIT_BLOB);
 assert.notEqual(oldHash,newHash);
 assert.equal(ASSET,'/finance-boundary-check.html');
 assert.equal(original.length,12);
});
test('exactly one diagnostic replaces prior bytes while all 11 existing assets are unchanged',()=>{
 const {original:before,next}=validateManifest(original,
   new Map([[ASSET,newHash]]),12,oldHash);
 assert.equal(next.size,12);
 assert.equal(next.get(ASSET),newHash);
 for(const [file,hash] of before){
  if(file!==ASSET)assert.equal(next.get(file),hash,file);
 }
 assert.throws(()=>validateManifest(original,new Map([[ASSET,oldHash]]),12,oldHash),
   /DIAGNOSTIC_UNCHANGED/);
 assert.throws(()=>validateManifest(original,new Map([['/index.html',newHash]]),12,oldHash),
   /ONLY_ONE_EXISTING_DIAGNOSTIC_REPLACEMENT_ALLOWED/);
 assert.throws(()=>validateManifest(original,new Map([[ASSET,newHash]]),12,'d'.repeat(64)),
   /LIVE_DIAGNOSTIC_NOT_EXACT_PREVIOUS_BYTES/);
});
test('full manifest read-only dry-run on exact latest version never submits writes',async()=>{
 const f=fake();
 const result=await uploadReviewedFinanceMobileLogin({
  assetBytes:latest,originalBytes:old,request:f.request,release:false,log:()=>{}
 });
 assert.equal(result.released,false);
 assert.equal(result.originalCount,12);
 assert.equal(f.calls.length,3);
 assert.ok(f.calls.every(c=>c.method==='GET'&&c.body===undefined));
});
test('unknown Hosting release or altered diagnostic stops BEFORE remote write',async()=>{
 const changed=fake(original,'sites/nico-factory/versions/manual_edit');
 await assert.rejects(uploadReviewedFinanceMobileLogin({
  assetBytes:latest,originalBytes:old,request:changed.request,release:true,log:()=>{}
 }),/UNREVIEWED_LIVE_VERSION/);
 assert.equal(changed.calls.length,1);
 assert.ok(changed.calls.every(c=>c.method==='GET'));
 const edited=fake(original.map(f=>f.path===ASSET?{...f,hash:'b'.repeat(64)}:f));
 await assert.rejects(uploadReviewedFinanceMobileLogin({
  assetBytes:latest,originalBytes:old,request:edited.request,release:true,log:()=>{}
 }),/LIVE_DIAGNOSTIC_NOT_EXACT_PREVIOUS_BYTES/);
 assert.ok(edited.calls.every(c=>c.method==='GET'));
});
test('wrong old Git blob, missing user probe, deleted partner route never release',async()=>{
 const badOld=fake();
 await assert.rejects(uploadReviewedFinanceMobileLogin({
  assetBytes:latest,originalBytes:Buffer.from('unapproved'),request:badOld.request,
  release:true,log:()=>{}
 }),/OLD_DIAGNOSTIC_BLOB_UNREVIEWED/);
 assert.equal(badOld.calls.length,0);
 const missing=fake(original.filter(x=>x.path!=='/partner-workspace.html'));
 await assert.rejects(uploadReviewedFinanceMobileLogin({
  assetBytes:latest,originalBytes:old,request:missing.request,
  release:true,log:()=>{}
 }),/LIVE_REQUIRED_ASSETS_UNVERIFIED/);
 assert.ok(missing.calls.every(c=>c.method==='GET'));
});
test('publisher is Hosting REST-only and never touches private Firestore / Rules / Functions',()=>{
 const source=readFileSync(new URL(
  '../tools/hosting/surgical-finance-boundary-mobile-login.mjs',import.meta.url),'utf8');
 assert.match(source,/CONFIRM_REPLACE_DIAGNOSTIC_MOBILE_LOGIN_ONLY/);
 assert.match(source,/LIVE_CHANGED_BEFORE_RELEASE/);
 assert.match(source,/FINAL_ASSET_HASH_MISMATCH/);
 assert.match(source,/FINAL_VERSION_CONFIG_UNVERIFIED/);
 assert.match(source,/NON_DIAGNOSTIC_FILE_MODIFIED/);
 assert.doesNotMatch(source,/https:\/\/firestore\.googleapis\.com|firebase deploy|functions:deploy|firebaserules\.googleapis\.com/);
});
