const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocsFromServer,collection,query,where,updateDoc,serverTimestamp,runTransaction}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Emulator required: refusing any production connection');
let env;
const projectId='demo-sales-support';
const company='company-a';
const date='2026-10-06';
const members={owner:{companyRole:'owner',role:'leader',teamId:'a'},leaderA:{role:'leader',teamId:'a'},leaderB:{role:'leader',teamId:'b'},helper:{role:'member',teamId:'b'},inactive:{role:'member',teamId:'b',active:false},foreign:{role:'member',teamId:'foreign-team',companyId:'company-b'}};
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
