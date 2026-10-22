const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,collection,query,where,getDocsFromServer,updateDoc,deleteDoc,serverTimestamp}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Emulator only! Refusing production Firestore');
const project='demo-finance-staging',company='test-company';
let env;
function firebase(uid){return env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true}).firestore();}
const people={
  master:{companyRole:'owner',role:'leader',teamId:'A',canViewRevenue:true,canViewUnitPrice:true},
  owner:{companyRole:'owner',role:'leader',teamId:'A',canViewRevenue:false,canViewUnitPrice:false},
  leaderGranted:{companyRole:'member',role:'leader',teamId:'A',canViewRevenue:true,canViewUnitPrice:true},
  leaderRevenue:{companyRole:'member',role:'leader',teamId:'A',canViewRevenue:true,canViewUnitPrice:false},
  leaderNoGrant:{companyRole:'member',role:'leader',teamId:'A',canViewRevenue:false,canViewUnitPrice:false},
  ordinary:{companyRole:'member',role:'member',teamId:'A',canViewRevenue:false,canViewUnitPrice:false},
  inactive:{companyRole:'member',role:'member',teamId:'A',canViewRevenue:true,canViewUnitPrice:true,active:false},
  foreign:{companyRole:'member',role:'member',teamId:'B',canViewRevenue:true,canViewUnitPrice:true,companyId:'foreign-company'}
};
before(async()=>env=await initializeTestEnvironment({projectId:project,firestore:{rules:fs.readFileSync(path.join(__dirname,'../finance-locked.rules'),'utf8')}}));
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'companies',company),{name:'Test',masterUid:'master',ownerUid:'master',active:true});
    await setDoc(doc(db,'companies','foreign-company'),{name:'Other',masterUid:'foreign',ownerUid:'foreign',active:true});
    for(const [uid,attrs] of Object.entries(people)){
      const companyId=attrs.companyId||company;
      const data={uid,companyId,active:true,teamHistory:[],...attrs};
      await setDoc(doc(db,'users',uid),data);
      await setDoc(doc(db,'companies',companyId,'members',uid),data);
    }
    await setDoc(doc(db,'products','product-1'),{companyId:company,name:'Product CB1000',revenue:12000,pricingOptions:[{cashback:1000,revenuePerUnit:11000}],active:true});
    await setDoc(doc(db,'records','record-1'),{companyId:company,uid:'ordinary',teamId:'A',date:'2026-10-22',results:{product1:{count:2,revenuePerUnit:12000}},totalCount:2,totalRevenue:24000});
    await setDoc(doc(db,'recordCorrections','correction-1'),{companyId:company,recordId:'record-1',before:{totalRevenue:10000},after:{totalRevenue:24000}});
    await setDoc(doc(db,'revenueGoals','revenue-A'),{companyId:company,teamId:'A',month:'2026-10',targetRevenue:100000});
    await setDoc(doc(db,'revenueGoals','revenue-B'),{companyId:company,teamId:'B',month:'2026-10',targetRevenue:990000});
    await setDoc(doc(db,'teams','A'),{companyId:company,name:'A',active:true});
    await setDoc(doc(db,'companies',company,'publicSync','state'),{companyId:company,updatedAt:'2026-10-22T00:00:00Z'});
  });
});
after(async()=>env?.cleanup());

test('regular and Leader accounts cannot retrieve money-bearing RAW documents even when granted revenue and unit price',async()=>{
  for(const uid of ['leaderGranted','leaderRevenue','leaderNoGrant','ordinary','inactive','foreign']){
    const db=firebase(uid);
    for(const [collectionName,id] of [['products','product-1'],['records','record-1'],['recordCorrections','correction-1']]){
      await assertFails(getDoc(doc(db,collectionName,id)));
    }
  }
});
test('raw money-bearing collection queries are denied to all nonowner members',async()=>{
  for(const uid of ['leaderGranted','leaderRevenue','leaderNoGrant','ordinary']){
    const db=firebase(uid);
    for(const name of ['products','records','recordCorrections']){
      await assertFails(getDocsFromServer(query(collection(db,name),where('companyId','==',company))));
    }
  }
});
test('Newly registered user without company invitation cannot read monetary company data',async()=>{
  // Verified e-mail alone must never imply membership.
  const db=firebase('new-uninvited-account');
  for(const [collectionName,id] of [
    ['products','product-1'],['records','record-1'],
    ['recordCorrections','correction-1'],['revenueGoals','revenue-A']
  ])await assertFails(getDoc(doc(db,collectionName,id)));
});

test('New staff and Leader cannot grant themselves prices or sales by changing profile documents',async()=>{
  for(const uid of ['ordinary','leaderNoGrant']){
    const db=firebase(uid);
    for(const p of ['users/'+uid,'companies/'+company+'/members/'+uid]){
      const ref=doc(db,p);
      await assertFails(updateDoc(ref,{canViewRevenue:true}));
      await assertFails(updateDoc(ref,{canViewUnitPrice:true}));
      await assertFails(updateDoc(ref,{companyRole:'owner'}));
    }
    await assertFails(getDoc(doc(db,'products','product-1')));
    await assertFails(getDoc(doc(db,'records','record-1')));
    await assertFails(getDoc(doc(db,'recordCorrections','correction-1')));
  }
});
test('Master and Owner retain full raw access regardless of grants',async()=>{
  for(const uid of ['master','owner']){
    const db=firebase(uid);
    const product=(await assertSucceeds(getDoc(doc(db,'products','product-1')))).data();
    const record=(await assertSucceeds(getDoc(doc(db,'records','record-1')))).data();
    const audit=(await assertSucceeds(getDoc(doc(db,'recordCorrections','correction-1')))).data();
    assert.equal(product.revenue,12000);
    assert.equal(record.totalRevenue,24000);
    assert.equal(audit.before.totalRevenue,10000);
  }
});
test('granted Leader retains revenue goal access to own team but not another team',async()=>{
  const db=firebase('leaderRevenue');
  const data=(await assertSucceeds(getDoc(doc(db,'revenueGoals','revenue-A')))).data();
  assert.equal(data.targetRevenue,100000);
  await assertFails(getDoc(doc(db,'revenueGoals','revenue-B')));
  await assertFails(getDoc(doc(firebase('leaderNoGrant'),'revenueGoals','revenue-A')));
  await assertSucceeds(getDoc(doc(firebase('owner'),'revenueGoals','revenue-B')));
});
test('counts-only team data remain readable even when money is blocked',async()=>{
  const db=firebase('ordinary');
  assert.equal((await assertSucceeds(getDoc(doc(db,'teams','A')))).data().name,'A');
});
test('Leader can no longer forge monetary writes in RAW records',async()=>{
  const db=firebase('leaderGranted');
  await assertFails(updateDoc(doc(db,'records','record-1'),{totalRevenue:999999,updatedAt:serverTimestamp()}));
});

test('historical records and correction audits cannot be deleted by anyone, including Owner',async()=>{
  for(const uid of ['ordinary','leaderGranted','master','owner']){
    const db=firebase(uid);
    await assertFails(deleteDoc(doc(db,'records','record-1')));
    await assertFails(deleteDoc(doc(db,'recordCorrections','correction-1')));
  }
  const owner=firebase('owner');
  assert.equal((await assertSucceeds(getDoc(doc(owner,'records','record-1')))).data().totalCount,2);
  assert.equal((await assertSucceeds(getDoc(doc(owner,'recordCorrections','correction-1')))).data().before.totalRevenue,10000);
});

test('member can observe company sync but cannot write or read foreign sync',async()=>{
  const db=firebase('ordinary');
  const ref=doc(db,'companies',company,'publicSync','state');
  const v=await assertSucceeds(getDoc(ref));
  assert.equal(v.data().companyId,company);
  await assertFails(setDoc(ref,{companyId:company,updatedAt:'attacker'}));
  await assertFails(getDoc(doc(db,'companies','foreign-company','publicSync','state')));
  await assertFails(getDocsFromServer(collection(db,'companies',company,'publicSync')));
});
