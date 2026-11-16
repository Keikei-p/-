import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createCanonicalOwnerCountHandler} from '../ranking/canonical-owner-count-server-factory.mjs';
import {createOwnerProductVisibilityStore} from '../ranking/owner-product-visibility-firestore.mjs';
import {projectVerifiedInlineJointCards} from '../ranking/verified-inline-joint-ranking-cards.mjs';
const PROJECT='demo-nico-secondary-finance-fence';
const require=createRequire(new URL('../functions-partner-workspace/package.json',import.meta.url));
// Auth principals are fictional. This proves localhost integration, never a real production login.

test('real localhost ledger: existing CB variants + partner submit/correct + ON/OFF drive the same full four rankings without extra consent',{
 skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000
},async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==PROJECT||process.env.GCLOUD_PROJECT!==PROJECT||
  !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST)||
  process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error('STOP_NOT_ISOLATED_CANONICAL_COUNT_EMULATOR');
 const {initializeApp,deleteApp}=require('firebase-admin/app');
 const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
 const {makeWorkspace,KEYS}=require('../functions-partner-workspace/service.cjs');
 const app=initializeApp({projectId:PROJECT},'canonical-full-count-integration'),db=getFirestore(app);
 const hub='canonicalHub',partner='canonicalPartner',owner='canonicalOwner',po='canonicalPartnerOwner';
 const ownTeam='canonicalOwnTeam',partnerTeam='canonicalPartnerTeam',sku='canonicalNuro';
 const ownMember='canonicalOwnMember',partnerMember='canonicalPartnerMember',secondary='canonicalSecondary';
 const codeUid='pc_canonical',codeToken='S'.repeat(43),companyCode='NICO-'+'A'.repeat(24);
 const date='2026-11-16',now=Date.parse(date+'T03:00:00Z');
 const email=uid=>uid.toLowerCase()+'@example.test';
 const token=uid=>uid+'.'+'x'.repeat(32);
 const decoded=uid=>({uid,email:email(uid),email_verified:true});
 const auth={verifyIdToken:async(value,revoked)=>{
  assert.equal(revoked,true);const uid=[owner,po,ownMember,partnerMember,secondary].find(u=>token(u)===value);
  if(!uid)throw Error('INVALID_DEMO_TOKEN');return decoded(uid);
 },getUser:async uid=>({uid,email:email(uid),emailVerified:true,disabled:false})};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const call=(uid,data)=>({auth:{uid,token:decoded(uid)},data,
  rawRequest:{headers:{authorization:'Bearer '+token(uid)}}});
 const write=(p,v)=>db.doc(p).set(v);
 try{
  await Promise.all([
   write('companies/'+hub,{name:'自社検証',companyKind:'internal',ownerUid:owner,active:true}),
   write('companies/'+partner,{name:'協力店検証',companyKind:'partner',ownerUid:po,hubCompanyId:hub,active:true}),
   write('partnerRelations/'+partner,{hubCompanyId:hub,partnerCompanyId:partner,active:true,countSharingApproved:true}),
   write('teams/'+ownTeam,{companyId:hub,name:'自社班'}),
   write('products/'+sku,{companyId:hub,name:'NURO',active:true,revenuePerUnit:12345}),
   write('companies/'+partner+'/partnerWorkTeams/'+partnerTeam,{companyId:partner,name:'協力店班',active:true}),
   write('companies/'+partner+'/partnerWorkStaff/'+po,{companyId:partner,name:'協力店担当',uid:po,
    teamId:partnerTeam,kind:'account',role:'owner',active:true}),
   write('companies/'+hub+'/rankingProductVisibility/shared',{hubCompanyId:hub,ownerUid:owner,
    version:1,enabledHubProductIds:[sku],partnerOverrides:{}}),
   write('companies/'+hub+'/rankingSkuMappings/shared',{hubCompanyId:hub,ownerUid:owner,
    reviewedByUid:owner,active:true,version:1,bindings:[{companyId:partner,productId:'partnerSku01',hubProductId:sku}]}),
   write('companies/'+hub+'/rankingCountPublicCatalog/shared',{schema:'nico-reviewed-count-public-catalog-v1',
    hubCompanyId:hub,ownerUid:owner,version:1,products:[{id:sku,companyId:hub,name:'NURO',active:true}]}),
   write('records/canonicalOwnRecord',{companyId:hub,uid:owner,date,teamId:ownTeam,
    memberNameSnapshot:'自社担当',teamNameSnapshot:'自社班',reportStatus:'submitted',totalCount:3,totalRevenue:37035,
    results:{[sku+'__cb_0']:{productId:sku,cashback:0,count:2,revenuePerUnit:12345},
     [sku+'__cb_1000']:{productId:sku,cashback:1000,count:1,revenuePerUnit:12345}}})
  ]);
  for(const [uid,cid,teamId,kind,type,name] of [[owner,hub,ownTeam,'internal','direct','自社担当'],
   [po,partner,partnerTeam,'partner','cooperator','協力店担当']]){
   const profile={uid,companyId:cid,companyRole:'owner',role:'leader',email:email(uid),active:true,
    accessKind:kind,memberType:type,teamId,name,canViewRevenue:kind==='internal',canViewUnitPrice:kind==='internal'};
   await Promise.all([write('users/'+uid,profile),write('companies/'+cid+'/members/'+uid,profile)]);
  }
  for(const [uid,cid,teamId,accessKind,memberType] of [
   [ownMember,hub,ownTeam,'internal','member'],
   [partnerMember,partner,partnerTeam,'partner','cooperator'],
   [secondary,hub,ownTeam,'internal','member']]){
   const p={uid,companyId:cid,companyRole:'member',role:'member',email:email(uid),
    active:true,accessKind,memberType,teamId,name:'件数確認担当',canViewRevenue:false,canViewUnitPrice:false};
   await Promise.all([write('users/'+uid,p),write('companies/'+cid+'/members/'+uid,p)]);
  }
  const secondaryProfile={uid:secondary,companyId:partner,companyRole:'member',role:'member',
   active:true,accessKind:'partner',memberType:'cooperator',teamId:partnerTeam,
   canViewRevenue:false,canViewUnitPrice:false};
  const codeProfile={uid:codeUid,companyId:partner,companyRole:'owner',role:'leader',active:true,
   authKind:'partner_code_shared',accessKind:'partner',memberType:'cooperator',
   teamId:null,canViewRevenue:false,canViewUnitPrice:false};
  await Promise.all([
   write('companies/'+partner+'/members/'+secondary,secondaryProfile),
   write('partnerWorkspaceContexts/'+secondary,{kind:'partner_secondary',uid:secondary,
    primaryCompanyId:hub,partnerCompanyId:partner,hubCompanyId:hub,role:'member',
    teamId:partnerTeam,active:true,emailLower:email(secondary)}),
   write('users/'+codeUid,codeProfile),write('companies/'+partner+'/members/'+codeUid,codeProfile),
   db.doc('companies/'+partner).update({companyCodePrincipalUid:codeUid}),
   write('partnerCodeSessions/'+createHash('sha256').update(codeToken).digest('hex'),{
    principalUid:codeUid,companyId:partner,companyCode,version:1,active:true,
    expiresAt:Timestamp.fromMillis(now+3600000)}),
   write('partnerCodeCredentials/'+partner,{companyId:partner,companyCode,principalUid:codeUid,version:1,active:true}),
   write('partnerCodeLogins/'+companyCode,{status:'active',principalUid:codeUid,partnerCompanyId:partner,version:1})
  ]);
  const ownBefore=(await db.doc('records/canonicalOwnRecord').get()).data();
  const productBefore=(await db.doc('products/'+sku).get()).data();
  const service=makeWorkspace({db,getAuth:()=>auth,FieldValue,Timestamp,HttpsError,
   enabled:()=>true,submissionPublicationEnabled:()=>true,now:()=>now});
  const counts=n=>({...Object.fromEntries(KEYS.map(k=>[k,0])),NURO:n});
  await service.submit(call(po,{date,staffId:po,counts:counts(2),expectedVersion:0}));
  const handle=createCanonicalOwnerCountHandler({enabled:true,auth,db,FieldValue,clock:()=>new Date(now)});
  const {createJointCountHttpAdapter}=require('../functions-ranking-approvals/joint-count-http-adapter.cjs');
  const http=createJointCountHttpAdapter({enabled:()=>true,loadHandler:async()=>handle});
  const request=async(uid,period,selected='',scope='joint')=>{
   const query=(period==='month'?'month=2026-11':period+'='+date)+
    (selected?'&workspaceCompanyId='+selected:'')+(scope==='joint'?'':'&scope='+scope);
   const result={statusCode:null,body:null,headers:{},
    setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},
    send(body){this.body=body;return this;}};
   await http({method:'GET',originalUrl:'/getVerifiedJointCountRanking?'+query,
    headers:{origin:'https://nico-factory.web.app',authorization:'Bearer '+(uid===codeUid?codeToken:token(uid))}},result);
   return new Response(result.body,{status:result.statusCode,headers:result.headers});
  };
  const read=async(uid,period,selected='',scope='joint')=>{
   const response=await request(uid,period,selected,scope);
   const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
  };
  for(const period of ['day','week','month']){
   const own=await read(owner,period),other=await read(po,period);
   assert.deepEqual(own.summary,{own:3,partner:2,total:5,unidentified:0});
   assert.equal(own.companyBreakdown.length,2);
   assert.equal(own.teamBreakdown.filter(t=>t.count>0).length,2);
   assert.equal(own.memberRanking.filter(p=>p.rank!==null).length,2);assert.equal(own.productRanking[0].count,5);
   assert.equal(other.publicRanking.companies.length,2);assert.equal(other.publicRanking.teams.length,2);
   assert.equal(other.publicRanking.products[0].count,5);assert.equal(other.own.count,2);
   assert(!JSON.stringify(other).includes('自社担当'));assert(!JSON.stringify(own).includes('協力店担当'));
   assert(!/revenue|cashback|__cb_|unitPrice|37035|12345/.test(JSON.stringify([own,other])));
   const internalMemberView=await read(ownMember,period);
   assert.deepEqual(internalMemberView.summary,own.summary);
   for(const [uid,selected] of [[partnerMember,''],[secondary,partner],[codeUid,'']]){
    const viewer=await read(uid,period,selected);
    assert.deepEqual(viewer.publicRanking,other.publicRanking);
    assert.equal(viewer.own.count,other.own.count);
    assert(!/revenue|cashback|__cb_|unitPrice|37035|12345/.test(JSON.stringify(viewer)));
   }
   for(const [scope,expected] of [['joint',5],['direct',3],['partner',2]]){
    const internal=await read(owner,period,'',scope),external=await read(codeUid,period,'',scope);
    assert.equal(internal.summary.total,expected);
    assert.equal(external.publicRanking.products[0].count,expected);
    const projections=[internal,external].map(payload=>projectVerifiedInlineJointCards(payload,{
     expectedRole:payload.role,period,start:payload.range.start,end:payload.range.end}));
    for(const dimension of ['companies','teams','people','products'])
     assert.deepEqual(projections[0][dimension].map(x=>[x.count,x.rank]),
      projections[1][dimension].map(x=>[x.count,x.rank]),period+' '+scope+' '+dimension);
   }
  }
  for(const selected of ['',hub,'foreignCompany'])
   assert.equal((await request(secondary,'month',selected)).status,401,
    'secondary membership cannot fall back to the original internal company');
  assert.equal((await request(partnerMember,'month',hub)).status,401);
  assert.equal((await request(codeUid,'month',partner)).status,401);
  const memberPath='companies/'+partner+'/members/'+partnerMember;
  await db.doc(memberPath).update({canViewRevenue:true});
  assert.equal((await request(partnerMember,'month')).status,401);
  await db.doc(memberPath).update({canViewRevenue:false});
  const sessionPath='partnerCodeSessions/'+createHash('sha256').update(codeToken).digest('hex');
  await db.doc(sessionPath).update({active:false});
  assert.equal((await request(codeUid,'month')).status,401);
  await db.doc(sessionPath).update({active:true});
  for(const mutation of [{version:2},{expiresAt:Timestamp.fromMillis(now-1)}]){
   await db.doc(sessionPath).update(mutation);
   assert.equal((await request(codeUid,'month')).status,401);
   await db.doc(sessionPath).update({version:1,expiresAt:Timestamp.fromMillis(now+3600000)});
  }
  const settingsBefore=(await db.doc('companies/'+hub+'/rankingProductVisibility/shared').get()).data();
  const ownerSettings=createOwnerProductVisibilityStore({db,FieldValue});
  for(const uid of [ownMember,partnerMember,secondary,codeUid])
   await assert.rejects(ownerSettings.saveSwitch({principal:{uid,email:email(uid),emailVerified:true},
    productId:sku,enabled:false,expectedVersion:1}));
  assert.deepEqual((await db.doc('companies/'+hub+'/rankingProductVisibility/shared').get()).data(),settingsBefore);
  await service.submit(call(po,{date,staffId:po,counts:counts(4),expectedVersion:1}));
  assert.equal((await read(owner,'month')).summary.total,7);
  const {makeAuthenticatedOwnerCorrectionV3}=require('../staging/partner-owner-correction-v3/trusted-auth.cjs');
  const ownerCorrection=makeAuthenticatedOwnerCorrectionV3({db,getAuth:()=>auth,FieldValue,HttpsError,
   enabled:()=>true,now:()=>now});
  const corrected=await ownerCorrection.correct(call(owner,{date,partnerCompanyId:partner,staffId:po,
   expectedVersion:2,counts:counts(6),sbBreakdown:{'SB光':0,'SB AIR':0,'旧未分類':0},
   correctionReason:'入力済み件数を確認して訂正'}));
  assert.equal(corrected.saved,true);assert.equal(corrected.version,3);
  assert.equal((await read(owner,'month')).summary.total,9);
  assert.equal((await db.doc('companies/'+partner+'/partnerWorkAudits/'+date+'__'+po+'__v3').get()).data().kind,
   'hub_owner_count_correction_v1');
  const entryPath='companies/'+partner+'/partnerWorkEntries/'+date+'__'+po;
  const entryBefore=(await db.doc(entryPath).get()).data();
  const visibility=createOwnerProductVisibilityStore({db,FieldValue});
  const principal={uid:owner,email:email(owner),emailVerified:true};
  await visibility.saveSwitch({principal,productId:sku,enabled:false,expectedVersion:1});
  await assert.rejects(service.submit(call(po,{date,staffId:po,counts:counts(7),expectedVersion:3})),
   e=>['permission-denied','failed-precondition'].includes(e.code));
  assert.equal((await read(owner,'month')).summary.total,0);
  assert.deepEqual((await db.doc(entryPath).get()).data(),entryBefore);
  await visibility.saveSwitch({principal,productId:sku,enabled:true,expectedVersion:2});
  assert.equal((await read(owner,'month')).summary.total,9);
  assert.deepEqual((await db.doc('records/canonicalOwnRecord').get()).data(),ownBefore);
  assert.deepEqual((await db.doc('products/'+sku).get()).data(),productBefore);
  assert.equal((await db.collection('companies/'+hub+'/rankingApprovals').get()).size,0);
  assert.equal((await db.collection('companies/'+partner+'/rankingApprovals').get()).size,0);
 }finally{await db.terminate();await deleteApp(app);}
});
