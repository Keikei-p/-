import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createCanonicalOwnerCountHandler} from '../ranking/canonical-owner-count-server-factory.mjs';
import {createOwnerProductVisibilityStore} from '../ranking/owner-product-visibility-firestore.mjs';
import {createOwnerReviewedSkuMappingStore} from '../ranking/owner-reviewed-sku-mapping-store.mjs';
const require=createRequire(new URL('../functions-partner-workspace/package.json',import.meta.url));
const PROJECT='demo-nico-secondary-finance-fence';
// Fictional local principals/records. Only the audited SIZE 245/35/86 is reused.
// This is neither production recovery nor a real account/publication test.
test('Owner-approved historical source groups publish all 245 counts through the real guarded day/week/month route',{
 skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000
},async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==PROJECT||process.env.GCLOUD_PROJECT!==PROJECT||
  !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST)||
  process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error('STOP_NOT_ISOLATED_HISTORY_PUBLICATION_EMULATOR');
 const {initializeApp,deleteApp}=require('firebase-admin/app');
 const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
 const {makeWorkspace,KEYS}=require('../functions-partner-workspace/service.cjs');
 const app=initializeApp({projectId:PROJECT},'historical-publication-connection'),db=getFirestore(app);
 const hub='historyHub',owner='historyOwner',ownTeam='historyOwnTeam';
 const date='2026-11-16',now=Date.parse(date+'T03:00:00Z');
 const partners=['historyPartnerA','historyPartnerB','historyPartnerC'];
 const owners=partners.map((_,i)=>'historyPartnerOwner'+i);
 const email=uid=>uid.toLowerCase()+'@example.test',token=uid=>uid+'.'+'x'.repeat(32);
 const decoded=uid=>({uid,email:email(uid),email_verified:true});
 const auth={verifyIdToken:async(value,revoked)=>{assert.equal(revoked,true);
  const uid=[owner,...owners].find(x=>token(x)===value);if(!uid)throw Error('INVALID_DEMO_TOKEN');return decoded(uid);
 },getUser:async uid=>({uid,email:email(uid),emailVerified:true,disabled:false})};
 const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
 const samples=[{NURO:13,'SB光・AIR':5},{NURO:86,'SB光・AIR':18,'つばさ・HTB':83},
  {NURO:25,'SB光・AIR':12,'つばさ・HTB':3}];
 const originals=new Map(),write=(p,v)=>db.doc(p).set(v);
 try{
  await Promise.all([
   write('companies/'+hub,{name:'自社検証',companyKind:'internal',ownerUid:owner,active:true}),
   write('teams/'+ownTeam,{companyId:hub,name:'自社班'}),
   write('products/historyRealHtb',{companyId:hub,name:'HTB',active:true,revenuePerUnit:12345}),
   write('companies/'+hub+'/partnerTabPublication/shared',{schema:'nico-partner-tabs-v1',hubCompanyId:hub,
    ownerUid:owner,version:1,published:true,tabs:['product','team','individual','detail']})
  ]);
  const profile=(uid,cid,team,partner)=>({uid,companyId:cid,companyRole:'owner',role:'leader',email:email(uid),
   active:true,accessKind:partner?'partner':'internal',memberType:partner?'cooperator':'direct',teamId:team,
   name:'検証担当',canViewRevenue:!partner,canViewUnitPrice:!partner});
  await Promise.all([write('users/'+owner,profile(owner,hub,ownTeam,false)),
   write('companies/'+hub+'/members/'+owner,profile(owner,hub,ownTeam,false))]);
  for(let i=0;i<partners.length;i++){
   const cid=partners[i],uid=owners[i],team='historyTeam'+i;
   const counts={...zero(),...samples[i]},total=Object.values(counts).reduce((a,b)=>a+b,0);
   const entry={companyId:cid,hubCompanyId:hub,date,staffId:uid,version:1,counts,totalCount:total,
    teamIdSnapshot:team,staffNameSnapshot:'協力検証担当',teamNameSnapshot:'協力検証班',workLocation:''};
   const entryPath='companies/'+cid+'/partnerWorkEntries/'+date+'__'+uid;
   const report={source:'staff-entries-v1',hubCompanyId:hub,partnerCompanyId:cid,date,version:1,counts,totalCount:total};
   const reportPath='companies/'+hub+'/partnerWorkCountDays/'+date+'/reports/'+cid;
   await Promise.all([
    write('companies/'+cid,{name:'協力検証'+i,companyKind:'partner',ownerUid:uid,hubCompanyId:hub,active:true}),
    write('partnerRelations/'+cid,{hubCompanyId:hub,partnerCompanyId:cid,active:true,countSharingApproved:true}),
    write('users/'+uid,profile(uid,cid,team,true)),write('companies/'+cid+'/members/'+uid,profile(uid,cid,team,true)),
    write('companies/'+cid+'/partnerWorkTeams/'+team,{companyId:cid,name:'協力検証班',active:true}),
    write('companies/'+cid+'/partnerWorkStaff/'+uid,{companyId:cid,name:'協力検証担当',uid,teamId:team,kind:'account',role:'owner',active:true}),
    write(entryPath,entry),write(reportPath,report)
   ]);
   originals.set(entryPath,(await db.doc(entryPath).get()).data());
   originals.set(reportPath,(await db.doc(reportPath).get()).data());
  }
  const masterBefore=(await db.doc('products/historyRealHtb').get()).data();
  const handle=createCanonicalOwnerCountHandler({enabled:true,auth,db,FieldValue,clock:()=>new Date(now),
   zeroSetupLink:true,enforcePartnerTabPublication:true});
  const read=async(uid,kind='month',tab='')=>{
   const q=(kind==='month'?'month=2026-11':kind+'='+date)+(tab?'&tab='+tab:'');
   const r=await handle(new Request('https://nico-factory.web.app/v1/owner-visible-counts?'+q,
    {headers:{Origin:'https://nico-factory.web.app',Authorization:'Bearer '+token(uid)}}));
   const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;
  };
  assert.equal((await read(owner)).summary.total,0,'history is not public by default');
  const store=createOwnerProductVisibilityStore({db,FieldValue,includeHistoricalGroups:true});
  const principal={uid:owner,email:email(owner),emailVerified:true};
  let version=0;
  for(let i=1;i<=9;i++){
   const saved=await store.saveSwitch({principal,productId:'legacyPartnerSku:partnerSku0'+i,
    enabled:true,expectedVersion:version});version=saved.version;
  }
  for(const kind of ['day','week','month']){
   const result=await read(owner,kind);
   assert.deepEqual(result.summary,{own:0,partner:245,total:245,unidentified:0});
   for(const rows of [result.productRanking,result.companyBreakdown,result.teamBreakdown,result.memberRanking])
    assert.equal(rows.reduce((n,r)=>n+r.count,0),245);
   assert.equal(result.productRanking.find(p=>p.name==='SB光・AIR（過去合算）').count,35);
   assert.equal(result.productRanking.find(p=>p.name==='つばさ・HTB（過去合算）').count,86);
   const productTab=await read(owners[0],kind,'product');
   assert.equal(productTab.rows.reduce((n,r)=>n+r.count,0),245);
   assert(!('summary' in productTab));assert(!('records' in productTab));
   assert.doesNotMatch(JSON.stringify([result,productTab]),/revenuePerUnit|unitPrice|cashback|12345/);
  }
  const off=await store.saveSwitch({principal,productId:'legacyPartnerSku:partnerSku07',enabled:false,expectedVersion:version});
  version=off.version;assert.equal((await read(owner)).summary.partner,159);
  await store.saveSwitch({principal,productId:'legacyPartnerSku:partnerSku07',enabled:true,expectedVersion:version});
  assert.equal((await read(owner)).summary.partner,245);
  // A published history group never grants new writes into the old aggregate.
  class HttpsError extends Error{constructor(code,msg){super(msg);this.code=code;}}
  const service=makeWorkspace({db,getAuth:()=>auth,FieldValue,Timestamp,HttpsError,
   enabled:()=>true,submissionPublicationEnabled:()=>true,now:()=>now});
  const changed={...originals.get('companies/'+partners[1]+'/partnerWorkEntries/'+date+'__'+owners[1]).counts,'つばさ・HTB':84};
  await assert.rejects(service.submit({auth:{uid:owners[1],token:decoded(owners[1])},
   rawRequest:{headers:{authorization:'Bearer '+token(owners[1])}},
   data:{date,staffId:owners[1],counts:changed,expectedVersion:1}}),
   e=>['permission-denied','failed-precondition'].includes(e.code));
  for(const [p,v] of originals)assert.deepEqual((await db.doc(p).get()).data(),v);
  assert.deepEqual((await db.doc('products/historyRealHtb').get()).data(),masterBefore);
  assert.equal((await db.collection('products').where('companyId','==',hub).get()).size,1,
   'no virtual group is a new sales product');
  // An additional real entry must join retained history through the actual
  // guarded save/read route. This does not claim distinct new 光/Air input.
  await write('products/historyNewSbmnp',{companyId:hub,name:'SBMNP',active:true});
  const mappingStore=createOwnerReviewedSkuMappingStore({db,FieldValue,includeHistoricalGroups:true});
  const mappingStatus=await mappingStore.status(principal);
  await mappingStore.change({principal,partnerCompanyId:partners[0],partnerProductId:'partnerSku02',
   hubProductId:null,expectedVersion:mappingStatus.version});
  const currentVisibility=await store.readStatus(principal);
  await store.saveSwitch({principal,productId:'historyNewSbmnp',enabled:true,expectedVersion:currentVisibility.version});
  const newStaff='historyNewStaff';
  await write('companies/'+partners[0]+'/partnerWorkStaff/'+newStaff,{
   companyId:partners[0],name:'追加検証担当',uid:null,teamId:'historyTeam0',kind:'managed',role:'member',active:true});
  const call=(counts,expectedVersion)=>service.submit({auth:{uid:owners[0],token:decoded(owners[0])},
   rawRequest:{headers:{authorization:'Bearer '+token(owners[0])}},
   data:{date,staffId:newStaff,counts:{...zero(),SBMNP:counts},expectedVersion}});
  assert.equal((await call(5,0)).saved,true);
  for(const kind of ['day','week','month']){
   const value=await read(owner,kind);
   assert.equal(value.summary.partner,250);
   for(const rows of [value.productRanking,value.companyBreakdown,value.teamBreakdown,value.memberRanking])
    assert.equal(rows.reduce((n,r)=>n+r.count,0),250);
   assert.equal((await read(owners[0],kind,'product')).rows.reduce((n,r)=>n+r.count,0),250);
  }
  assert.equal((await call(3,1)).saved,true);
  assert.equal((await read(owner)).summary.partner,248,'correction replaces five with three exactly once');
  // Latest integrated implementation: the SAME original save route accepts
  // separate Owner product IDs, and the real Owner correction path follows.
  const individual=makeWorkspace({db,getAuth:()=>auth,FieldValue,Timestamp,HttpsError,
   enabled:()=>true,submissionPublicationEnabled:()=>true,individualCountInputEnabled:()=>true,
   ownerCorrectionReadEnabled:()=>true,ownerCorrectionWriteEnabled:()=>true,now:()=>now});
  const distinct=[['historyLight','SB光新規'],['historyAir','SBAIR'],['historyEnergy','つばさ電気']];
  for(const [id,name] of distinct)await write('products/'+id,{companyId:hub,name,active:true});
  let visibility=await store.readStatus(principal);
  for(const id of ['historyRealHtb',...distinct.map(p=>p[0])]){
   const changed=await store.saveSwitch({principal,productId:id,enabled:true,expectedVersion:visibility.version});
   visibility={version:changed.version};
  }
  const request=(uid,data)=>({auth:{uid,token:decoded(uid)},data,
   rawRequest:{headers:{authorization:'Bearer '+token(uid)}}});
  const values={historyLight:2,historyAir:3,historyEnergy:4,historyRealHtb:5,historyNewSbmnp:1};
  const individualSave=(ownerProductCounts,expectedVersion)=>individual.submit(request(owners[0],
   {date,staffId:newStaff,counts:zero(),ownerProductCounts,expectedVersion}));
  await individualSave(values,2);
  const fresh=await individual.view(request(owners[0],{date}));
  assert.equal(fresh.sharedCatalogVerified,true);
  assert.deepEqual(fresh.records.find(r=>r.staffId===newStaff).ownerProductCounts,values);
  for(const kind of ['day','week','month']){
   const value=await read(owner,kind);assert.equal(value.summary.partner,263);
   for(const rows of [value.productRanking,value.companyBreakdown,value.teamBreakdown,value.memberRanking])
    assert.equal(rows.reduce((n,r)=>n+r.count,0),263);
   for(const [name,count] of [['SB光・AIR（過去合算）',35],['つばさ・HTB（過去合算）',86],
    ['SB光新規',2],['SBAIR',3],['つばさ電気',4],['HTB',5],['SBMNP',4]])
    assert.equal(value.productRanking.find(p=>p.name===name).count,count,name);
   assert.equal((await read(owners[0],kind,'product')).rows.reduce((n,r)=>n+r.count,0),263);
  }
  visibility=await store.readStatus(principal);
  const offAir=await store.saveSwitch({principal,productId:'historyAir',enabled:false,expectedVersion:visibility.version});
  assert.equal((await read(owner)).summary.partner,260);
  await assert.rejects(individualSave({...values,historyAir:4},3),e=>e.code==='failed-precondition');
  await individualSave({historyLight:1,historyEnergy:4,historyRealHtb:5,historyNewSbmnp:1},3);
  assert.equal((await read(owner)).summary.partner,259);
  const ownerListing=await individual.listHubPartnerCounts(request(owner,{date,partnerCompanyId:partners[0]}));
  assert.equal(ownerListing.sharedCatalogVerified,true);
  const correction={date,partnerCompanyId:partners[0],staffId:newStaff,expectedVersion:4,
   counts:{...zero(),SBMNP:3},sbBreakdown:{'SB光':0,'SB AIR':0,'旧未分類':0},
   correctionReason:'件数確認による訂正',ownerProductCounts:{historyLight:4}};
  await assert.rejects(individual.correctHubPartnerCounts(request(owners[0],correction)),e=>e.code==='permission-denied');
  await individual.correctHubPartnerCounts(request(owner,correction));
  assert.equal((await read(owner)).summary.partner,262);
  const event=(await db.doc('companies/'+partners[0]+'/partnerWorkAudits/'+date+'__'+newStaff+'__v5').get()).data();
  assert.equal(event.previousOwnerProductCounts.historyLight,1);assert.equal(event.ownerProductCounts.historyLight,4);
  assert.equal(event.correctedByOwnerUid,owner);assert.equal(event.ownerProductCounts.historyAir,3);
  await store.saveSwitch({principal,productId:'historyAir',enabled:true,expectedVersion:offAir.version});
  assert.equal((await read(owner)).summary.partner,265,'OFF Air is retained through partner and Owner corrections');
  for(const [p,v] of originals)if(p.includes('/partnerWorkEntries/'))
   assert.deepEqual((await db.doc(p).get()).data(),v,'the old 245 entries are unchanged');
  assert.deepEqual((await db.doc('products/historyRealHtb').get()).data(),masterBefore);
 }finally{await db.terminate();await deleteApp(app);}
});
