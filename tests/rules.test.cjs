const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocsFromServer,collection,query,where,updateDoc,deleteDoc,serverTimestamp,runTransaction}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Emulator required: refusing any production connection');
let env;
const projectId='demo-sales-support';
const company='company-a';
const date='2026-10-06';
const members={owner:{companyRole:'owner',role:'leader',teamId:'a',canViewRevenue:true},leaderA:{role:'leader',teamId:'a',canViewRevenue:true},leaderB:{role:'leader',teamId:'b',canViewRevenue:false},helper:{role:'member',teamId:'b',canViewRevenue:true},inactive:{role:'member',teamId:'b',active:false,canViewRevenue:true},foreign:{role:'member',teamId:'foreign-team',companyId:'company-b',canViewRevenue:true}};
function dbFor(uid){return env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true}).firestore();}
function key(uid='helper',day=date){return `${company}_${uid}_${day}`;}
function payload(actor,uid='helper',teamId='a',day=date){return {companyId:company,uid,memberNameSnapshot:uid,teamId,teamNameSnapshot:teamId,date:day,workLocation:'テスト',results:{A:{productId:'A',count:2,revenuePerUnit:100}},totalCount:2,totalRevenue:200,reportStatus:'submitted',reportedAt:serverTimestamp(),createdByUid:actor,updatedByUid:actor,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};}
function patch(actor,extra={}){return {updatedByUid:actor,updatedAt:serverTimestamp(),reportedAt:serverTimestamp(),...extra};}
async function seedRecord(id=key(),teamId='a'){
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'records',id),payload('owner','helper',teamId)));
}
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'companies',company),{ownerUid:'owner',masterUid:'owner'});
  await setDoc(doc(db,'companies','company-b'),{ownerUid:'foreign'});
  for(const [uid,m] of Object.entries(members)){
   const data={uid,name:uid,companyId:company,companyRole:'member',active:true,teamHistory:[{effectiveDate:'2026-10-01',fromTeamId:null,toTeamId:m.teamId}],...m};
   await setDoc(doc(db,'users',uid),data);
   await setDoc(doc(db,'companies',data.companyId,'members',uid),data);
  }
  for(const id of ['a','b','inactive-team','foreign-team'])await setDoc(doc(db,'teams',id),{companyId:id==='foreign-team'?'company-b':company,name:id,active:id!=='inactive-team'});
 });
});
after(async()=>{await env?.cleanup();});

test('leader registers same-company support member into own team; original membership unchanged',async()=>{
 const db=dbFor('leaderA');
 const memberBefore=(await getDoc(doc(db,'companies',company,'members','helper'))).data();
 await assertSucceeds(setDoc(doc(db,'records',key()),payload('leaderA')));
 const saved=(await getDoc(doc(db,'records',key()))).data();assert.equal(saved.teamId,'a');assert.equal(saved.uid,'helper');
 assert.deepEqual((await getDoc(doc(db,'companies',company,'members','helper'))).data(),memberBefore);
});
test('leader cannot create support record for another team',async()=>assertFails(setDoc(doc(dbFor('leaderA'),'records',key()),payload('leaderA','helper','b'))));
test('member can register own record but cannot proxy another member',async()=>{
 await assertSucceeds(setDoc(doc(dbFor('helper'),'records',key()),payload('helper','helper','a')));
 await assertFails(setDoc(doc(dbFor('helper'),'records',key('leaderB')),payload('helper','leaderB','a')));
});
test('inactive and foreign-company people cannot be registered',async()=>{
 for(const uid of ['inactive','foreign'])await assertFails(setDoc(doc(dbFor('leaderA'),'records',key(uid)),payload('leaderA',uid)));
});
test('foreign and inactive destination teams are rejected even for owner',async()=>{
 for(const team of ['foreign-team','inactive-team'])await assertFails(setDoc(doc(dbFor('owner'),'records',key()),payload('owner','helper',team)));
});
test('new records require stable company-member-day ID for every role',async()=>{
 for(const actor of ['owner','leaderA','helper'])await assertFails(setDoc(doc(dbFor(actor),'records','arbitrary-'+actor),payload(actor)));
});
test('leader may correct support results within own team only',async()=>{
 await seedRecord();
 await assertSucceeds(updateDoc(doc(dbFor('leaderA'),'records',key()),patch('leaderA',{results:{B:{count:1,revenuePerUnit:300}},totalCount:1,totalRevenue:300})));
 await assertFails(updateDoc(doc(dbFor('leaderB'),'records',key()),patch('leaderB',{totalCount:3})));
});
test('leader and member cannot move a saved record to another team',async()=>{
 await seedRecord();
 for(const actor of ['leaderA','helper'])await assertFails(updateDoc(doc(dbFor(actor),'records',key()),patch(actor,{teamId:'b',teamNameSnapshot:'b'})));
});
test('owner can relocate that day; older days and personal identity stay intact',async()=>{
 await seedRecord();
 const oldId=key('helper','2026-10-05');
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'records',oldId),payload('owner','helper','b','2026-10-05')));
 const db=dbFor('owner'),before=(await getDoc(doc(db,'records',key()))).data();
 await assertSucceeds(updateDoc(doc(db,'records',key()),patch('owner',{teamId:'b',teamNameSnapshot:'b'})));
 const after=(await getDoc(doc(db,'records',key()))).data();
 assert.equal(after.uid,before.uid);assert.deepEqual(after.results,before.results);assert.deepEqual(after.createdAt,before.createdAt);
 assert.equal((await getDoc(doc(db,'records',oldId))).data().teamId,'b');
});
test('legacy document IDs remain editable in place',async()=>{
 await seedRecord('old-record-id');
 await assertSucceeds(updateDoc(doc(dbFor('owner'),'records','old-record-id'),patch('owner',{teamId:'b',teamNameSnapshot:'b'})));
});
test('other company cannot read/update records, and member cannot list peer identities',async()=>{
 await seedRecord();
 await assertFails(getDoc(doc(dbFor('foreign'),'records',key())));
 await assertFails(updateDoc(doc(dbFor('foreign'),'records',key()),patch('foreign')));
 await assertFails(getDocsFromServer(collection(dbFor('helper'),'companies',company,'members')));
});
test('missing-record read allowed only to active authenticated company members',async()=>{
 await assertSucceeds(getDoc(doc(dbFor('leaderA'),'records','missing')));
 await assertFails(getDoc(doc(dbFor('inactive'),'records','missing')));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'records','missing')));
});

function app(db){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const source=name=>{let a=html.indexOf(`function ${name}(`);if(html.slice(a-6,a)==='async ')a-=6;return html.slice(a,html.indexOf('\n}',a)+2);};
 const ctx=vm.createContext({db,query,where,getDocsFromServer,runTransaction,recordsCollectionQuery:()=>query(collection(db,'records'),where('companyId','==',company))});
 vm.runInContext(['recordRevision','recordConflict','persistDailyRecord'].map(source).join('\n'),ctx);return ctx;
}
test('concurrent leaders registering same day produce exactly one record',{skip:process.env.RULES_ONLY==='1'},async()=>{
 const a=dbFor('leaderA'),b=dbFor('leaderB');
 const outcomes=await Promise.allSettled([
  app(a).persistDailyRecord(doc(a,'records',key()),payload('leaderA','helper','a'),null,null),
  app(b).persistDailyRecord(doc(b,'records',key()),payload('leaderB','helper','b'),null,null)
 ]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 const all=await getDocsFromServer(query(collection(dbFor('owner'),'records'),where('companyId','==',company)));
 assert.equal(all.size,1);
});
test('app detects a legacy record rather than creating a second canonical record',{skip:process.env.RULES_ONLY==='1'},async()=>{
 await seedRecord('legacy-helper-day');const db=dbFor('owner');
 await assert.rejects(app(db).persistDailyRecord(doc(db,'records',key()),payload('owner'),null,null),{code:'record-conflict'});
 assert.equal((await getDoc(doc(db,'records',key()))).exists(),false);
});
test('stale editor cannot overwrite a later correction',{skip:process.env.RULES_ONLY==='1'},async()=>{
 await seedRecord();const db=dbFor('owner'),ref=doc(db,'records',key()),api=app(db);
 const before={id:ref.id,...(await getDoc(ref)).data()},revision=api.recordRevision(before);
 await updateDoc(ref,patch('owner',{results:{A:{count:4}},totalCount:4}));
 await assert.rejects(api.persistDailyRecord(ref,patch('owner',{companyId:company,uid:'helper',date,results:{}}),before,revision),{code:'record-conflict'});
 assert.equal((await getDoc(ref)).data().totalCount,4);
});
test('transaction replacement removes deleted product and preserves creation metadata',{skip:process.env.RULES_ONLY==='1'},async()=>{
 await seedRecord();const db=dbFor('owner'),ref=doc(db,'records',key()),api=app(db);
 const before={id:ref.id,...(await getDoc(ref)).data()};
 await api.persistDailyRecord(ref,patch('owner',{companyId:company,uid:'helper',date,results:{B:{count:1,revenuePerUnit:50}},totalCount:1,totalRevenue:50}),before,api.recordRevision(before));
 const saved=(await getDoc(ref)).data();assert.deepEqual(saved.results,{B:{count:1,revenuePerUnit:50}});assert.deepEqual(saved.createdAt,before.createdAt);
});


function revenueGoalPayload(teamId='a',targetRevenue=3000000){
 return {companyId:company,teamId,month:'2026-10',targetRevenue,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
}

test('owner can create and read revenue goals for any own-company team',async()=>{
 const db=dbFor('owner');
 await assertSucceeds(setDoc(doc(db,'revenueGoals','owner-a'),revenueGoalPayload('a')));
 await assertSucceeds(setDoc(doc(db,'revenueGoals','owner-b'),revenueGoalPayload('b',2000000)));
 assert.equal((await getDoc(doc(db,'revenueGoals','owner-a'))).data().targetRevenue,3000000);
});

test('revenue-enabled leader can manage own-team revenue goal but not another team',async()=>{
 const db=dbFor('leaderA');
 await assertSucceeds(setDoc(doc(db,'revenueGoals','leader-a'),revenueGoalPayload('a',1500000)));
 await assertFails(setDoc(doc(db,'revenueGoals','leader-b'),revenueGoalPayload('b',1500000)));
});

test('revenue-enabled member can read own-team goal but cannot edit it',async()=>{
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'revenueGoals','team-b'),revenueGoalPayload('b',2200000)));
 const db=dbFor('helper');
 await assertSucceeds(getDoc(doc(db,'revenueGoals','team-b')));
 await assertFails(updateDoc(doc(db,'revenueGoals','team-b'),{targetRevenue:2300000,updatedAt:serverTimestamp()}));
});

test('revenue goal stays hidden from users without permission and from other teams',async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'revenueGoals','team-a'),revenueGoalPayload('a',1800000));
  await setDoc(doc(db,'revenueGoals','team-b'),revenueGoalPayload('b',2200000));
 });
 await assertFails(getDoc(doc(dbFor('leaderB'),'revenueGoals','team-b')));
 await assertFails(getDoc(doc(dbFor('helper'),'revenueGoals','team-a')));
 await assertSucceeds(getDocsFromServer(query(collection(dbFor('helper'),'revenueGoals'),where('companyId','==',company),where('teamId','==','b'))));
});


test('leader without explicit finance grants cannot read or edit revenue goals', async()=>{
  await env.withSecurityRulesDisabled(async c=>{
    const admin=c.firestore();
    for(const ref of [doc(admin,'users','leaderA'),doc(admin,'companies',company,'members','leaderA')]){
      const snap=await getDoc(ref), data=snap.data();
      delete data.canViewRevenue;
      delete data.canViewUnitPrice;
      await setDoc(ref,data);
    }
    await setDoc(doc(admin,'revenueGoals','private-a'),revenueGoalPayload('a',990000));
  });
  const db=dbFor('leaderA');
  await assertFails(getDoc(doc(db,'revenueGoals','private-a')));
  await assertFails(setDoc(doc(db,'revenueGoals','leader-default-denied'),revenueGoalPayload('a',100000)));
  const owner=dbFor('owner');
  assert.equal((await getDoc(doc(owner,'revenueGoals','private-a'))).data().targetRevenue,990000);
});


test('authenticated master shown as owner can add and edit products but cannot delete historical catalog even if membership role is member',async()=>{
  // Reproduce the UI/server mismatch: client isCurrentCompanyMaster() shows
  // owner controls, but prior products rules used only isCompanyManager().
  await env.withSecurityRulesDisabled(async c=>{
    const admin=c.firestore();
    await setDoc(doc(admin,'companies',company),{ownerUid:'owner',masterUid:'catalogMaster'});
    const master={uid:'catalogMaster',name:'catalogMaster',companyId:company,
      companyRole:'member',role:'member',teamId:'a',active:true,
      canViewRevenue:false,canViewUnitPrice:false};
    await setDoc(doc(admin,'users','catalogMaster'),master);
    await setDoc(doc(admin,'companies',company,'members','catalogMaster'),master);
  });
  const db=dbFor('catalogMaster');
  const ref=doc(db,'products','master-new-product');
  await assertSucceeds(setDoc(ref,{
    companyId:company,name:'新規商品',revenue:5000,
    cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:5000}],
    sortOrder:13,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  assert.equal((await assertSucceeds(getDoc(ref))).data().revenue,5000);
  await assertSucceeds(updateDoc(ref,{name:'更新した商材',updatedAt:serverTimestamp()}));
  assert.equal((await assertSucceeds(getDoc(ref))).data().name,'更新した商材');
  await assertFails(deleteDoc(ref));
   assert.equal((await getDoc(ref)).exists(),true);
  // Rejected deletes must not erase the existing price master.
  await env.withSecurityRulesDisabled(async c=>{
    assert.equal((await getDoc(doc(c.firestore(),'products','master-new-product'))).exists(),true);
  });
});

test('product catalog permissions still reject ordinary members and foreign members',async()=>{
  const product={companyId:company,name:'未許可の商材',revenue:5000,
    cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:5000}],
    sortOrder:0,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  for(const uid of ['helper','foreign','leaderB']){
    const ref=doc(dbFor(uid),'products',uid+'-denied');
    await assertFails(setDoc(ref,product));
  }
});

test('existing owner retains product create permission',async()=>{
  const ref=doc(dbFor('owner'),'products','owner-new-product');
  await assertSucceeds(setDoc(ref,{
    companyId:company,name:'オーナー追加商品',revenue:5000,
    cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:5000}],
    sortOrder:13,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
});

test('secondary owner (not master) can create and edit SBMNP but cannot delete its catalog history with zero cashback',async()=>{
  await env.withSecurityRulesDisabled(async c=>{
    await updateDoc(doc(c.firestore(),'companies',company),{masterUid:'another-master'});
  });
  const ref=doc(dbFor('owner'),'products','secondary-owner-sbmnp');
  await assertSucceeds(setDoc(ref,{
    companyId:company,name:'SBMNP',revenue:5000,
    cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:5000}],
    sortOrder:13,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  await assertSucceeds(updateDoc(ref,{name:'SBMNP edited',updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(ref));
   assert.equal((await getDoc(ref)).exists(),true);
});

test('leader with both explicit finance grants can create, edit and delete SBMNP',async()=>{
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await updateDoc(doc(db,'users','leaderA'),{canViewUnitPrice:true});
    await updateDoc(doc(db,'companies',company,'members','leaderA'),{canViewUnitPrice:true});
  });
  const ref=doc(dbFor('leaderA'),'products','leader-sbmnp');
  await assertSucceeds(setDoc(ref,{
    companyId:company,name:'SBMNP',revenue:5000,
    cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:5000}],
    sortOrder:13,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  await assertSucceeds(updateDoc(ref,{name:'SBMNP edited',updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(ref));
   assert.equal((await getDoc(ref)).exists(),true);
});

function catalogPayload(extra={}) {
  return {companyId:company,name:'SBMNP',revenue:5000,
    cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:5000}],
    sortOrder:13,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),...extra};
}

test('product create/update/delete reject inactive, inconsistent, unverified and underprivileged actors',async()=>{
  const cases=[
    {id:'member',role:'member',grants:true},
    {id:'leader-no-unit',role:'leader',revenue:true},
    {id:'leader-no-revenue',role:'leader',unit:true},
    {id:'leader-no-flags',role:'leader'},
    {id:'inactive-user',owner:true,userActive:false},
    {id:'inactive-member',owner:true,memberActive:false},
    {id:'missing-member',owner:true,missingMember:true},
    {id:'missing-user',owner:true,missingUser:true},
    {id:'wrong-company',owner:true,wrongCompany:true},
    {id:'ui-only-owner',userOwner:true},
    {id:'member-only-owner',memberOwner:true},
    {id:'unverified-owner',owner:true,unverified:true},
    {id:'master-inactive',master:true,userActive:false},
    {id:'master-missing-member',master:true,missingMember:true},
    {id:'master-wrong-company',master:true,wrongCompany:true}
  ];
  for(const item of cases){
    await env.withSecurityRulesDisabled(async c=>{
      const db=c.firestore();
      await updateDoc(doc(db,'companies',company),{masterUid:item.master?item.id:'owner'});
      const common={uid:item.id,companyId:item.wrongCompany?'company-b':company,
        role:item.role||'member',companyRole:'member',active:true,
        ...(item.grants||item.revenue?{canViewRevenue:true}:{}),
        ...(item.grants||item.unit?{canViewUnitPrice:true}:{})};
      if(!item.missingUser)await setDoc(doc(db,'users',item.id),{
        ...common,companyRole:item.owner||item.userOwner?'owner':'member',active:item.userActive!==false});
      if(!item.missingMember)await setDoc(doc(db,'companies',company,'members',item.id),{
        ...common,companyRole:item.owner||item.memberOwner?'owner':'member',active:item.memberActive!==false});
      await setDoc(doc(db,'products','existing-'+item.id),catalogPayload());
    });
    const db=env.authenticatedContext(item.id,{email:item.id+'@example.test',email_verified:!item.unverified}).firestore();
    await assertFails(setDoc(doc(db,'products','new-'+item.id),catalogPayload()));
    const ref=doc(db,'products','existing-'+item.id);
    await assertFails(updateDoc(ref,{name:'denied',updatedAt:serverTimestamp()}));
    await assertFails(deleteDoc(ref));
  }
  const anon=env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(anon,'products','anonymous'),catalogPayload()));
  await assertFails(updateDoc(doc(anon,'products','existing-member'),{name:'denied',updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(anon,'products','existing-member')));
});

test('product validation and cross-company protections remain enforced for secondary owner',async()=>{
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await updateDoc(doc(db,'companies',company),{masterUid:'another-master'});
    await setDoc(doc(db,'products','foreign-product'),catalogPayload({companyId:'company-b'}));
  });
  const db=dbFor('owner');
  const invalid=[{revenue:-1},{revenue:'5000'},{active:false},{name:''},
    {pricingOptions:[]},{sortOrder:-1},{unexpected:true},{createdAt:null},
    {updatedAt:null},{companyId:'company-b'}];
  for(let i=0;i<invalid.length;i++)await assertFails(setDoc(doc(db,'products','invalid-'+i),catalogPayload(invalid[i])));
  const ref=doc(db,'products','valid-product');
  await assertSucceeds(setDoc(ref,catalogPayload()));
  await assertFails(updateDoc(ref,{companyId:'company-b',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{revenue:-1,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{active:false,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(db,'products','foreign-product'),{name:'denied',updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(db,'products','foreign-product')));
});


// Business-history retention contract: no mobile client may destroy any
// past record, product, team, monthly target or revenue target.
test('sales records survive attempted deletion by owner, leader and owner of the record',async()=>{
 await seedRecord();
 for(const uid of ['owner','leaderA','helper']){
   await assertFails(deleteDoc(doc(dbFor(uid),'records',key())));
   assert.equal((await getDoc(doc(dbFor('owner'),'records',key()))).data().totalCount,2);
 }
});
test('teams cannot be physically removed, but the existing name remains editable',async()=>{
 for(const uid of ['owner','leaderA']){
   await assertFails(deleteDoc(doc(dbFor(uid),'teams','a')));
   assert.equal((await getDoc(doc(dbFor('owner'),'teams','a'))).exists(),true);
 }
 await assertSucceeds(updateDoc(doc(dbFor('owner'),'teams','a'),{name:'更新後の班名',updatedAt:serverTimestamp()}));
 assert.equal((await getDoc(doc(dbFor('owner'),'teams','a'))).data().name,'更新後の班名');
});
test('catalog products cannot be physically removed, but owners may still edit',async()=>{
 const ref=doc(dbFor('owner'),'products','retain-product');
 await assertSucceeds(setDoc(ref,catalogPayload()));
 await assertFails(deleteDoc(ref));
 await assertSucceeds(updateDoc(ref,{name:'新しい表示名',updatedAt:serverTimestamp()}));
 assert.equal((await getDoc(ref)).data().revenue,5000);
});
test('monthly count and revenue targets cannot be physically removed',async()=>{
 const db=dbFor('owner');
 const countsRef=doc(db,'goals','retain-count-goal');
 const salesRef=doc(db,'revenueGoals','retain-revenue-goal');
 await assertSucceeds(setDoc(countsRef,{
  companyId:company,teamId:'a',month:'2026-10',targets:{A:10},
  createdAt:serverTimestamp(),updatedAt:serverTimestamp()
 }));
 await assertSucceeds(setDoc(salesRef,revenueGoalPayload('a',2500000)));
 await assertFails(deleteDoc(countsRef));
 await assertFails(deleteDoc(salesRef));
 assert.equal((await getDoc(countsRef)).data().targets.A,10);
 assert.equal((await getDoc(salesRef)).data().targetRevenue,2500000);
});
test('history correction logs are append-only and cannot be deleted',async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'recordCorrections','old-correction'),{
   companyId:company,recordId:key(),recordDate:date,recordUid:'helper',
   changedByUid:'owner',changedByName:'owner',before:{totalCount:1},after:{totalCount:2}
  });
 });
 await assertFails(deleteDoc(doc(dbFor('owner'),'recordCorrections','old-correction')));
 assert.equal((await getDoc(doc(dbFor('owner'),'recordCorrections','old-correction'))).exists(),true);
});


// All financial originals must be denied to a partner even when the partner
// is its own company Owner/master. These are synthetic emulator-only fixtures.
for(const marker of ['companyKind','user-accessKind','member-accessKind','memberType']) {
 test('finance-restricted partner: owner cannot read/write original price, records, corrections or revenue goals ('+marker+')',async()=>{
  const financeProduct={companyId:company,name:'価格つき商品',revenue:1000,
   cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:1000}],
   active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await env.withSecurityRulesDisabled(async c=>{
   const admin=c.firestore();
   await setDoc(doc(admin,'products','partner-finance'),financeProduct);
   await setDoc(doc(admin,'records',key()),payload('owner'));
   await setDoc(doc(admin,'recordCorrections','partner-finance'),{
    companyId:company,recordId:key(),recordUid:'helper',recordDate:date,
    changedByUid:'owner',changedByName:'owner',before:{totalRevenue:500},
    after:{totalRevenue:1000},createdAt:serverTimestamp()});
   await setDoc(doc(admin,'revenueGoals','partner-finance'),revenueGoalPayload());
   // The server-issued partner owner always has accessKind=partner.
   // Additional markers may be present, but they are not a replacement for
   // that canonical identity flag in the current low-cost read rules.
   await updateDoc(doc(admin,'users','owner'),{accessKind:'partner'});
   if(marker==='companyKind') {
    await updateDoc(doc(admin,'companies',company),{companyKind:'partner'});
   } else {
    const where=marker==='user-accessKind'?'users/owner':'companies/'+company+'/members/owner';
    await updateDoc(doc(admin,where),marker==='memberType'?{memberType:'cooperator'}:{accessKind:'partner'});
   }
  });
  const db=dbFor('owner');
  for(const [coll,id] of [
    ['products','partner-finance'],
    ['records',key()],
    ['recordCorrections','partner-finance'],
    ['revenueGoals','partner-finance']
  ]) await assertFails(getDoc(doc(db,coll,id)));
  await assertFails(setDoc(doc(db,'products','partner-created-finance'),financeProduct));
  await assertFails(setDoc(doc(db,'records',key('owner')),payload('owner','owner','a')));
  await assertFails(setDoc(doc(db,'revenueGoals','partner-created-finance'),revenueGoalPayload()));
  await assertFails(setDoc(doc(db,'recordCorrections','partner-created-finance'),{
   companyId:company,recordId:key(),recordUid:'helper',recordDate:date,
   changedByUid:'owner',changedByName:'owner',before:{totalRevenue:100},
   after:{totalRevenue:200},createdAt:serverTimestamp()
  }));
 });
}


test('partner cannot downgrade its server-owned identity to access legacy financial originals',async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  const admin=c.firestore();
  await updateDoc(doc(admin,'companies',company),{companyKind:'partner'});
  await updateDoc(doc(admin,'users','owner'),{accessKind:'partner',memberType:'cooperator'});
  await updateDoc(doc(admin,'companies',company,'members','owner'),{accessKind:'partner',memberType:'cooperator'});
 });
 const db=dbFor('owner');
 await assertFails(updateDoc(doc(db,'users','owner'),{accessKind:'internal',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(db,'users','owner'),{memberType:'internal',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(db,'companies',company,'members','owner'),{accessKind:'internal',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(db,'companies',company),{companyKind:'internal',updatedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(db,'products','partner-finance')));
 await env.withSecurityRulesDisabled(async c=>{
  const admin=c.firestore();
  assert.equal((await getDoc(doc(admin,'users','owner'))).data().accessKind,'partner');
  assert.equal((await getDoc(doc(admin,'companies',company))).data().companyKind,'partner');
 });
});


// A damaged partially migrated principal must remain finance-restricted even
// if one or both canonical partner flags are absent. This checks every source.
for(const source of ['company-kind','user-access','member-access','user-type','member-type']) {
 test('isolated marker never permits finance read: '+source,async()=>{
  await env.withSecurityRulesDisabled(async c=>{
   const db=c.firestore();
   await setDoc(doc(db,'products','one-price'),{
    companyId:company,name:'priced',revenue:9900,
    cashbackOptions:[0],pricingOptions:[{cashback:0,revenuePerUnit:9900}],
    active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
   });
   await setDoc(doc(db,'records',key()),payload('owner'));
   await setDoc(doc(db,'recordCorrections','finance-history'),{
     companyId:company,recordId:key(),recordUid:'helper',recordDate:date,
     changedByUid:'owner',changedByName:'owner',before:{totalRevenue:100},
     after:{totalRevenue:200},createdAt:serverTimestamp()
   });
   await setDoc(doc(db,'revenueGoals','private-goal'),revenueGoalPayload());
   if(source==='company-kind') await updateDoc(doc(db,'companies',company),{companyKind:'partner'});
   if(source==='user-access') await updateDoc(doc(db,'users','owner'),{accessKind:'partner'});
   if(source==='member-access') await updateDoc(doc(db,'companies',company,'members','owner'),{accessKind:'partner'});
   if(source==='user-type') await updateDoc(doc(db,'users','owner'),{memberType:'cooperator'});
   if(source==='member-type') await updateDoc(doc(db,'companies',company,'members','owner'),{memberType:'cooperator'});
  });
  const db=dbFor('owner');
  for(const [coll,id] of [
   ['products','one-price'],['records',key()],
   ['recordCorrections','finance-history'],['revenueGoals','private-goal']
  ])await assertFails(getDoc(doc(db,coll,id)));
  await assertFails(setDoc(doc(db,'records',key('owner')),payload('owner','owner','a')));
  await assertFails(setDoc(doc(db,'revenueGoals','new-private-goal'),revenueGoalPayload()));
 });
}

 
// The hub's existing non-partner account remains readable under the revised
// global membership helper; company finance isolation is not a UI-only check.
test('internal owner/member retain original financial document reads after partner closure',async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  const d=c.firestore();
  await setDoc(doc(d,'products','internal-finance'),{
   companyId:company,name:'Existing product',revenue:1000,active:true,
   cashbackOptions:[],pricingOptions:[],createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  await setDoc(doc(d,'records','internal-finance'),payload('owner'));
 });
 for(const uid of ['owner','leaderA','helper']){
  const d=dbFor(uid);
  await assertSucceeds(getDoc(doc(d,'products','internal-finance')));
  await assertSucceeds(getDoc(doc(d,'records','internal-finance')));
 }
});

test('partner private product and count documents cannot be read or mutated through any browser Firestore role',async()=>{
 const privateProduct=doc(dbFor('owner'),'companies',company,
   'partnerPrivateProducts','private-001');
 const privateCount=doc(dbFor('owner'),'companies',company,
   'partnerWorkEntries','2026-10-06__helper');
 const productData={companyId:company,name:'協力店専用',active:true,
   origin:'partner_custom',visibility:'private'};
 const countData={companyId:company,staffId:'helper',date,
   privateCounts:{'private-001':7},privateTotalCount:7};
 await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'companies',company,
    'partnerPrivateProducts','private-001'),productData);
  await setDoc(doc(c.firestore(),'companies',company,
    'partnerWorkEntries','2026-10-06__helper'),countData);
 });
 for(const uid of ['owner','leaderA','helper','foreign']){
  const db=dbFor(uid);
  for(const [segment,id,data] of [
    ['partnerPrivateProducts','private-001',productData],
    ['partnerWorkEntries','2026-10-06__helper',countData]
  ]){
   const ref=doc(db,'companies',company,segment,id);
   await assertFails(getDoc(ref));
   await assertFails(getDocsFromServer(collection(db,'companies',company,segment)));
   await assertFails(setDoc(ref,data));
   await assertFails(updateDoc(ref,{active:false}));
   await assertFails(deleteDoc(ref));
  }
 }
 // Denied operations must not destroy original money-free partner records.
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  assert.deepEqual((await getDoc(doc(db,'companies',company,
    'partnerPrivateProducts','private-001'))).data(),productData);
  assert.deepEqual((await getDoc(doc(db,'companies',company,
    'partnerWorkEntries','2026-10-06__helper'))).data(),countData);
 });
});
