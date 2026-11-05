import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocsFromServer,collection,query,where,deleteDoc} from 'firebase/firestore';
import {modelIntegratedFinanceClosure} from '../security/finance-stage2-integrated.mjs';
import {checkFinanceRulesBeforeDeploy} from '../scripts/check-finance-read-boundary-before-deploy.mjs';
const current=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const closure=modelIntegratedFinanceClosure(current);
const tables=['products','records','recordCorrections','revenueGoals'];
let env;
const direct='demo-direct-a',partner='demo-partner-b';
const dbFor=uid=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true}).firestore();
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('EMULATOR_ONLY_NO_PRODUCTION');
 env=await initializeTestEnvironment({projectId:'demo-sales-support',firestore:{rules:closure.rules}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,'companies',direct),{ownerUid:'owner',masterUid:'owner',active:true,companyKind:'internal'});
  await setDoc(doc(db,'companies',partner),{ownerUid:'partnerOwner',masterUid:'partnerOwner',active:true,companyKind:'partner'});
  for(const [uid,companyId,role,accessKind] of [
   ['owner',direct,'owner','internal'],['worker',direct,'member','internal'],
   ['secondary',direct,'owner','internal'],['partnerOwner',partner,'owner','partner']
  ]){
   const base={uid,companyId,role:role==='owner'?'leader':'member',
     companyRole:role,active:true,teamId:'team1',accessKind};
   await setDoc(doc(db,'users',uid),base);
   await setDoc(doc(db,'companies',companyId,'members',uid),base);
  }
  await setDoc(doc(db,'partnerWorkspaceContexts','secondary'),{
   uid:'secondary',kind:'partner_secondary',active:true,
   primaryCompanyId:direct,partnerCompanyId:partner,hubCompanyId:direct
  });
  for(const [table,fields] of [
   ['products',{name:'商品',revenue:50000}],
   ['records',{uid:'worker',date:'2026-11-05',totalCount:2,totalRevenue:100000}],
   ['recordCorrections',{before:{totalRevenue:50000},after:{totalRevenue:100000}}],
   ['revenueGoals',{teamId:'team1',month:'2026-11',targetRevenue:300000}]
  ]){
   await setDoc(doc(db,table,'internal-sample'),{companyId:direct,...fields});
   await setDoc(doc(db,table,'partner-sample'),{companyId:partner,...fields});
  }
 });
});
after(async()=>{if(env)await env.cleanup();});
test('future closure only in memory; not deployed and requires browser migration',()=>{
 const conf=JSON.parse(readFileSync(new URL('../firebase.json',import.meta.url),'utf8'));
 assert.equal(conf.firestore.rules,'firestore.rules');
 assert.notEqual(closure.rules,current);
 assert.equal(closure.productionApproved,false);
 assert.equal(closure.requiresLegacyBrowserMigration,true);
 assert.equal(closure.requiresLiveUidE2E,true);
 assert.equal(closure.requiresVerifiedBackupRestore,true);
 assert.equal(checkFinanceRulesBeforeDeploy(closure.rules).staticShapeValid,true);
});
test('internal owner can read old monetary originals in emulator',async()=>{
 for(const table of tables){
  const snap=await assertSucceeds(getDoc(doc(dbFor('owner'),table,'internal-sample')));
  assert.equal(snap.exists(),true,table);
 }
});
test('internal member raw reads are incompatible, proving migration is mandatory',async()=>{
 for(const table of tables)await assertFails(getDoc(doc(dbFor('worker'),table,'internal-sample')));
});
test('secondary partner cannot reuse old internal owner role to read money',async()=>{
 for(const table of tables)await assertFails(getDoc(doc(dbFor('secondary'),table,'internal-sample')));
});
test('partner owner cannot read any financial originals even in partner company',async()=>{
 for(const table of tables)await assertFails(getDoc(doc(dbFor('partnerOwner'),table,'partner-sample')));
});
test('cross-company get/list and historical deletes are rejected',async()=>{
 for(const table of tables){
  await assertFails(getDoc(doc(dbFor('partnerOwner'),table,'internal-sample')));
  await assertFails(getDocsFromServer(query(collection(dbFor('partnerOwner'),table),where('companyId','==',direct))));
  await assertFails(deleteDoc(doc(dbFor('owner'),table,'internal-sample')));
 }
});
test('unexpected changes fail before model generation',()=>{
 const changed=current.replace('match /products/{productId} {\n      allow read: if noSecondaryPartnerWorkspace()',
  'match /products/{productId} {\n      allow read: if true');
 assert.notEqual(changed,current);
 assert.throws(()=>modelIntegratedFinanceClosure(changed),/INTEGRATED_STAGE2_STOP_READ_CONTRACT_products/);
});
