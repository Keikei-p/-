import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveFirestoreRoleVerifier,createLivePartnerCountViewVerifier,
 createLiveFirestoreOwnerPreflight}
 from '../tools/production/verify-live-firestore-roles.mjs';

const T=Math.floor(Date.parse('2026-11-05T14:00:00Z')/1000);
const PROJECT='sales-management-cc116';
const API='https://firestore.googleapis.com/v1/';
const RESOURCE_ROOT='projects/'+PROJECT+'/databases/(default)/documents';
const ROOT=API+RESOURCE_ROOT;
const RULES='a'.repeat(64);
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const jwt=(sub,overrides={})=>{
  const head=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({
    sub,aud:PROJECT,iss:'https://securetoken.google.com/'+PROJECT,
    email_verified:true,email:sub+'@example.test',iat:T-50,exp:T+3000,auth_time:T-50,
    firebase:{sign_in_provider:'password'},...overrides
  })).toString('base64url');
  return head+'.'+payload+'.'+'z'.repeat(80);
};
function fixture(opts={}){
  const calls=[];
  const fetchImpl=async (url,req)=>{
    calls.push({url,method:req.method,auth:req.headers.Authorization,body:req.body});
    // Distinguish test sessions by their synthetic UID, not byte-for-byte
    // token equality: changing only an expiry must preserve partner identity.
    const token=req.headers.Authorization.slice('Bearer '.length);
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
    const partner=claims.sub==='partneruid';
    const isProduct=url.includes('/products/');
    const status=opts.statusOverride?.({partner,url,req,calls})??(partner?403:200);
    return {
      status,
      json:async()=>status===403
        ?{error:{code:403,status:'PERMISSION_DENIED'}}
        :req.method==='POST'
        ?[{document:{name:RESOURCE_ROOT+'/'+JSON.parse(req.body).structuredQuery.from[0].collectionId+'/demo',fields:{companyId:{stringValue:'internal_company'}}}}]
        :{name:url.slice(API.length),fields:isProduct
          ?{companyId:{stringValue:'internal_company'},revenue:{integerValue:'10000'}}
          :{companyId:{stringValue:'internal_company'},totalRevenue:{integerValue:'10000'}}}
    };
  };
  const create=(override={})=>createLiveFirestoreRoleVerifier({
    ownerIdToken:jwt('owneruid'),partnerIdToken:jwt('partneruid'),
    expectedOwnerUid:'owneruid',expectedPartnerUid:'partneruid',
    internalCompanyId:'internal_company',productId:'knownProduct',
    recordId:'knownRecord',fetchImpl,now:()=>T*1000,...override
  });
  return {calls,create};
}
const args={expectedRulesSha256:RULES,releaseName:RELEASE};

test('8 constrained reads: Owner finance get/list first, partner identical get/list all 403',async()=>{
  const f=fixture();
  const verifier=f.create();
  const result=await verifier(args);
  assert.deepEqual(result,{
    checkedAgainst:'synthetic-only',
    partnerDocumentDenied:true,partnerListDenied:true,
    ownerFinanceAllowed:true
  });
  assert.equal(f.calls.length,8);
  assert.deepEqual(f.calls.map(x=>x.method),['GET','POST','GET','POST','GET','POST','GET','POST']);
  assert.deepEqual(f.calls.map(x=>x.url.slice(ROOT.length)),[
    '/products/knownProduct',':runQuery','/records/knownRecord',':runQuery',
    '/products/knownProduct',':runQuery','/records/knownRecord',':runQuery'
  ]);
  for(const x of f.calls){
    assert(x.url.startsWith(ROOT));
    assert(!/PATCH|DELETE|PUT/.test(x.method));
    if(x.method==='POST'){
      const body=JSON.parse(x.body);
      assert.deepEqual(Object.keys(body),['structuredQuery']);
      assert.equal(body.structuredQuery.limit,1);
      assert.equal(body.structuredQuery.where.fieldFilter.field.fieldPath,'companyId');
      assert.equal(body.structuredQuery.where.fieldFilter.value.stringValue,'internal_company');
      assert.deepEqual(body.structuredQuery.select.fields,[{fieldPath:'companyId'}]);
    }
  }
  assert(!JSON.stringify(result).includes('10000'));
  assert(!JSON.stringify(result).includes('owneruid'));
  await assert.rejects(verifier(args),/STOP_LIVE_ROLE_SINGLE_USE_VERIFIER/);
});
test('a 403 on Owner document or list is NOT mistaken for successful partner denial',async()=>{
  for(const method of ['GET','POST']){
    const f=fixture({statusOverride:({partner,req})=>!partner&&req.method===method?403:undefined});
    await assert.rejects(f.create()(args),/STOP_LIVE_ROLE_HTTP_STATUS_UNVERIFIED/);
  }
});
test('partner 200, 401, 404, 429 or 500 must fail closed, never report success',async()=>{
  for(const status of [200,401,404,429,500]){
    const f=fixture({statusOverride:({partner})=>partner?status:undefined});
    await assert.rejects(f.create()(args),/STOP_LIVE_ROLE_HTTP_STATUS_UNVERIFIED/);
  }
});
test('required identity binding rejects wrong project, same UID, expired, disabled email verification and OAuth',()=>{
  const f=fixture();
  const rejects=[
    {ownerIdToken:jwt('owneruid',{aud:'another-project'})},
    {ownerIdToken:jwt('owneruid',{iss:'https://accounts.google.com'})},
    {ownerIdToken:jwt('owneruid',{email_verified:false})},
    {ownerIdToken:jwt('owneruid',{email:null})},
    {partnerIdToken:jwt('partneruid',{email:''})},
    {ownerIdToken:jwt('owneruid',{exp:T-1})},
    {ownerIdToken:jwt('owneruid',{exp:T+7000})},
    {ownerIdToken:jwt('owneruid',{auth_time:null})},
    {ownerIdToken:'oauth-opaque'},
    {expectedOwnerUid:'different-uid'},
    {partnerIdToken:jwt('owneruid'),expectedPartnerUid:'owneruid'}
  ];
  for(const inputs of rejects)
    assert.throws(()=>f.create(inputs),/STOP_LIVE_ROLE_/);
  assert.equal(f.calls.length,0);
});
test('invalid path, absent exact release and invalid candidate SHA fail before network',async()=>{
  const f=fixture();
  assert.throws(()=>f.create({productId:'../secrets'}),/STOP_LIVE_ROLE_DOCUMENT_IDS/);
  for(const bad of [{expectedRulesSha256:'bad',releaseName:RELEASE},
    {expectedRulesSha256:RULES,releaseName:'projects/other/releases/cloud.firestore'}]){
    const verifier=f.create();
    await assert.rejects(verifier(bad),/STOP_LIVE_ROLE_RULES_RELEASE_NOT_PINNED/);
  }
  assert.equal(f.calls.length,0);
});
test('transport failures are scrubbed and do not expose tokens',async()=>{
  const f=fixture();
  const secret=jwt('owneruid');
  const verifier=f.create({fetchImpl:async()=>{throw Error('secret '+secret)}});
  await assert.rejects(verifier(args),e=>
    e.message==='STOP_LIVE_ROLE_NETWORK_UNVERIFIED'&&!e.message.includes(secret));
});
test('malformed Owner finance document and malformed query response fail closed',async()=>{
  for(const method of ['GET','POST']){
    const f=fixture();
    const verifier=f.create({fetchImpl:async(url,req)=>{
      if(req.method===method)return {status:200,json:async()=>({})};
      return {status:200,json:async()=>req.method==='GET'
        ?{name:url,fields:{revenue:{integerValue:'3'}}}:[]};
    }});
    await assert.rejects(verifier(args),/STOP_LIVE_ROLE_(OWNER_FINANCE_NOT_VERIFIED|OWNER_LIST_NOT_VERIFIED)/);
  }
});

test('Owner document from wrong company is never accepted as proof of company finance',async()=>{
  const f=fixture();
  const verifier=f.create({fetchImpl:async(url,req)=>({
    status:200,
    json:async()=>req.method==='POST' ? [] :{
      name:url.slice(API.length),fields:{
        companyId:{stringValue:'other_company'},
        revenue:{integerValue:'500'},totalRevenue:{integerValue:'500'}
      }
    }
  })});
  await assert.rejects(verifier(args),/STOP_LIVE_ROLE_OWNER_FINANCE_NOT_VERIFIED/);
});


test('real REST Document.name uses resource path, not HTTPS URL; wrong document cannot impersonate Owner',async()=>{
  for(const docName of [
    ROOT+'/products/knownProduct',
    RESOURCE_ROOT+'/products/anotherProduct',
    RESOURCE_ROOT+'/products/knownProduct/other',
    'projects/other/databases/(default)/documents/products/knownProduct'
  ]){
    const f=fixture();
    const verifier=f.create({fetchImpl:async(url,req)=>({
      status:200,json:async()=>req.method==='GET'?{
        name:docName,fields:{companyId:{stringValue:'internal_company'},revenue:{integerValue:'1'}}
      }: [{document:{name:RESOURCE_ROOT+'/products/demo',fields:{companyId:{stringValue:'internal_company'}}}}]
    })});
    await assert.rejects(verifier(args),/STOP_LIVE_ROLE_OWNER_FINANCE_NOT_VERIFIED/);
  }
});
test('Owner list HTTP 200 with empty, unrelated or wrong-company results is NOT evidence of finance access',async()=>{
  const invalid=[
    [],
    [{readTime:'2026-11-05T14:00:00Z'}],
    [{document:{name:RESOURCE_ROOT+'/records/no',fields:{companyId:{stringValue:'internal_company'}}}}],
    [{document:{name:RESOURCE_ROOT+'/products/demo',fields:{companyId:{stringValue:'other_company'}}}}],
    [{document:{name:ROOT+'/products/demo',fields:{companyId:{stringValue:'internal_company'}}}}],
    [{document:{name:RESOURCE_ROOT+'/products/demo/another',fields:{companyId:{stringValue:'internal_company'}}}}]
  ];
  for(const listResult of invalid){
    const f=fixture();
    const verifier=f.create({fetchImpl:async(url,req)=>({
      status:200,json:async()=>req.method==='POST'?listResult:{
        name:url.slice(API.length),
        fields:{companyId:{stringValue:'internal_company'},revenue:{integerValue:'1'},totalRevenue:{integerValue:'1'}}
      }
    })});
    await assert.rejects(verifier(args),/STOP_LIVE_ROLE_OWNER_LIST_NOT_VERIFIED/);
  }
});


test('stale Owner or secondary Partner token is refused AFTER construction but BEFORE any post-release HTTP',async()=>{
  for(const role of ['owner','partner']){
    const f=fixture();
    let now=T*1000;
    const verifier=f.create({
      now:()=>now,
      ...(role==='owner'?{ownerIdToken:jwt('owneruid',{exp:T+100})}
                       :{partnerIdToken:jwt('partneruid',{exp:T+100})})
    });
    // A backup scan or external approval can take enough time that a token
    // valid at construction has expired before the Rules flip verification.
    now=(T+120)*1000;
    await assert.rejects(verifier(args),
      /STOP_LIVE_ROLE_USER_IDENTITY_NOT_VERIFIED/,role);
    assert.equal(f.calls.length,0,'do not mistake auth expiry for Rules denial');
  }
});


test('plain HTTP 403 is not enough: only structured Firestore PERMISSION_DENIED proves denial',async()=>{
  const invalid=[
    {},{error:{code:403,status:'UNAUTHENTICATED'}},
    {error:{code:401,status:'PERMISSION_DENIED'}},
    {error:{code:403,status:'RESOURCE_EXHAUSTED'}},
    {error:{code:403,message:'Forbidden'}},
    [{error:{code:403,status:'PERMISSION_DENIED'}}]
  ];
  for(const denial of invalid){
    const f=fixture();
    const verifier=f.create({fetchImpl:async(url,req)=>{
      const partner=req.headers.Authorization.includes(jwt('partneruid'));
      const collection=req.method==='POST'
        ?JSON.parse(req.body).structuredQuery.from[0].collectionId
        :url.includes('/products/')?'products':'records';
      if(partner)return {status:403,json:async()=>denial};
      return {status:200,json:async()=>req.method==='POST'?
        [{document:{name:RESOURCE_ROOT+'/'+collection+'/demo',fields:{companyId:{stringValue:'internal_company'}}}}]:{
          name:url.slice(API.length),fields:{companyId:{stringValue:'internal_company'},
            revenue:{integerValue:'1'},totalRevenue:{integerValue:'1'}}
        }};
    }});
    await assert.rejects(verifier(args),/STOP_LIVE_ROLE_PERMISSION_DENIAL_UNVERIFIED/);
  }
});
test('partner 403 with non-JSON body is not accepted as a Firestore Rules denial',async()=>{
  const f=fixture();
  const verifier=f.create({fetchImpl:async(url,req)=>{
    const partner=req.headers.Authorization.includes(jwt('partneruid'));
    const collection=req.method==='POST'
      ?JSON.parse(req.body).structuredQuery.from[0].collectionId
      :url.includes('/products/')?'products':'records';
    if(partner)return {status:403,json:async()=>{throw Error('not Firestore')}};
    return {status:200,json:async()=>req.method==='POST'?
      [{document:{name:RESOURCE_ROOT+'/'+collection+'/demo',fields:{companyId:{stringValue:'internal_company'}}}}]:{
        name:url.slice(API.length),fields:{companyId:{stringValue:'internal_company'},
          revenue:{integerValue:'1'},totalRevenue:{integerValue:'1'}}
      }};
  }});
  await assert.rejects(verifier(args),/STOP_LIVE_ROLE_PERMISSION_DENIAL_UNVERIFIED/);
});


test('secondary token nearing expiry DURING Owner proof cannot become a false money-403 success',async()=>{
 let now=T*1000;
 const f=fixture({statusOverride:({calls})=>{
  if(calls.length===4)now=(T+80)*1000;
 }});
 const verifier=f.create({
  partnerIdToken:jwt('partneruid',{exp:T+125}),
  now:()=>now
 });
 await assert.rejects(verifier(args),/STOP_LIVE_ROLE_USER_IDENTITY_NOT_VERIFIED/);
 assert.equal(f.calls.length,4,
  'no 403 probe may run when the genuine partner session is near expiry');
});

test('both Owner and partner sessions must remain fresh THROUGH all eight live finance requests',async()=>{
 for(const expiring of ['owner','partner']){
  let now=T*1000;
  const f=fixture({statusOverride:({calls})=>{
   if(calls.length===8)now=(T+80)*1000;
  }});
  const verifier=f.create({
   ownerIdToken:jwt('owneruid',{exp:T+(expiring==='owner'?125:3000)}),
   partnerIdToken:jwt('partneruid',{exp:T+(expiring==='partner'?125:3000)}),
   now:()=>now
  });
  await assert.rejects(verifier(args),/STOP_LIVE_ROLE_USER_IDENTITY_NOT_VERIFIED/,
   'Do not certify fresh finance boundary when '+expiring+' expires during proof');
  assert.equal(f.calls.length,8,'all REST responses looked valid, yet proof must fail');
 }
});


const COUNT_DATE=new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(T*1000));
const COUNT_KEYS=['NURO','SBMNP','YMMNP','YM純新規','SB光・AIR',
 'ウォーター','つばさ・HTB','太陽光・蓄電池AP','U-NEXT'];
function liveCountFixture({status=200,role='member',replaceResult,advanceClock}={}){
 let clock=T*1000;
 const calls=[];
 const count={
  role,date:COUNT_DATE,companyName:'協力店',teamId:'team1',
  categories:COUNT_KEYS,teams:[{id:'team1',name:'1班',active:true}],
  staff:[{id:'partneruid',uid:'partneruid',teamId:'team1',
    active:true,kind:'account'}],
  records:[],privateProducts:[]
 };
 const fetchImpl=async(url,req)=>{
  calls.push({url,req});
  if(advanceClock)clock=(T+80)*1000;
  return {status,json:async()=>({result:replaceResult===undefined?count:replaceResult})};
 };
 const create=(override={})=>createLivePartnerCountViewVerifier({
  partnerIdToken:jwt('partneruid'),expectedPartnerUid:'partneruid',
  partnerCompanyId:'partner_company',fetchImpl,now:()=>clock,...override
 });
 return {calls,create,count};
}

test('affected partner count workspace uses real-user-style read-only onCall request and no write',async()=>{
 const f=liveCountFixture();
 const verified=await f.create()();
 assert.deepEqual(verified,{
  checkedAgainst:'synthetic-only',partnerCountViewAllowed:true,
  productionDocumentWrites:0
 });
 assert.equal(f.calls.length,1);
 const {url,req}=f.calls[0];
 assert.equal(url,'https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getPartnerWorkspace');
 assert.equal(req.method,'POST');
 assert.equal(req.redirect,'error');
 assert.equal(req.headers.Authorization,'Bearer '+jwt('partneruid'));
 assert.deepEqual(JSON.parse(req.body),{data:{
  date:COUNT_DATE,workspaceCompanyId:'partner_company'
 }});
 assert(!/submitPartnerWorkspaceCounts|managePartnerWorkspace/.test(url));
 const once=f.create() ;
 await once();
 await assert.rejects(once(),/STOP_LIVE_ROLE_SINGLE_USE_COUNT_VIEW/);
});

test('unavailable partner view cannot be mistaken for count entry continuity',async()=>{
 for(const status of [401,403,404,429,500]){
  const f=liveCountFixture({status});
  await assert.rejects(f.create()(),/STOP_LIVE_ROLE_COUNT_VIEW_UNAVAILABLE/);
 }
});

test('generic callable HTTP 200, wrong date, and wrong role cannot fake a count view',async()=>{
 for(const view of [
  {},{role:'hub',date:COUNT_DATE,categories:COUNT_KEYS,teams:[],staff:[],records:[]},
  {role:'member',date:'2026-10-01',categories:COUNT_KEYS,teams:[],staff:[],records:[]},
  {role:'member',date:COUNT_DATE,categories:[],teams:[],staff:[],records:[]}
 ]){
  const f=liveCountFixture({replaceResult:view});
  await assert.rejects(f.create()(),/STOP_LIVE_ROLE_COUNT_VIEW_CONTRACT_UNVERIFIED/);
 }
});

test('a partner member lacking their own active input row is not count-ready',async()=>{
 const f=liveCountFixture();
 for(const staff of [
  [],[{id:'other',uid:'anotherUser',teamId:'team1',active:true,kind:'account'}],
  [{id:'partneruid',uid:'partneruid',teamId:'team1',active:false,kind:'account'}],
  [{id:'partneruid',uid:'partneruid',teamId:'team1',active:true,kind:'managed'}],
  [{id:'partneruid',uid:'partneruid',teamId:'inactiveTeam',active:true,kind:'account'}]
 ]){
  const v={...f.count,staff};
  await assert.rejects(f.create({fetchImpl:async()=>({
   status:200,json:async()=>({result:v})
  })})(),/STOP_LIVE_ROLE_COUNT_VIEW_OWN_INPUT_UNAVAILABLE/);
 }
 const owner=liveCountFixture({role:'owner'});
 assert.equal((await owner.create()()).partnerCountViewAllowed,true,
  'Owner has an active staff and active team, hence can submit new counts');
});

test('count-only response with extra financial fields cannot pass release signoff',async()=>{
 const f=liveCountFixture();
 for(const view of [
  {...f.count,totalRevenue:50000},
  {...f.count,records:[{staffId:'example',data:{revenuePerUnit:5000}}]}
 ]){
  await assert.rejects(f.create({fetchImpl:async()=>({
   status:200,json:async()=>({result:view})
  })})(),/STOP_LIVE_ROLE_COUNT_VIEW_FINANCE_FIELD_EXPOSED/);
 }
});

test('token expiring while partner view is reading cannot be a valid live proof',async()=>{
 const f=liveCountFixture({advanceClock:true});
 await assert.rejects(f.create({partnerIdToken:jwt('partneruid',{exp:T+125})})(),
  /STOP_LIVE_ROLE_USER_IDENTITY_NOT_VERIFIED/);
 assert.equal(f.calls.length,1);
});

test('live count view rejects malformed scope and never falls back to privileged tokens',()=>{
 const f=liveCountFixture();
 for(const input of [{partnerCompanyId:'../internal'},
  {expectedPartnerUid:'another-user'},{partnerIdToken:'server-oauth-bypass'}])
  assert.throws(()=>f.create(input),/STOP_LIVE_ROLE_/);
 assert.equal(f.calls.length,0);
});


test('screen-only 200 cannot certify input for an Owner with no active staff or no active teams',async()=>{
 for(const role of ['owner','leader']){
  const f=liveCountFixture({role});
  for(const change of [
   {staff:[]},
   {staff:[{...f.count.staff[0],active:false}]},
   {teams:[]},
   {teams:[{id:'team1',name:'1班',active:false}]}
  ]){
   const view={...f.count,...change};
   await assert.rejects(f.create({fetchImpl:async()=>({
    status:200,json:async()=>({result:view})
   })})(),/STOP_LIVE_ROLE_COUNT_VIEW_NO_ACTIVE_INPUT_ROUTE/,
    role+' must not certify count input merely because screen opens');
  }
 }
});

test('member cannot submit without their own active account and matching active assigned team',async()=>{
 const f=liveCountFixture();
 for(const change of [
  {staff:[{...f.count.staff[0],teamId:'retired'}]},
  {staff:[{...f.count.staff[0],kind:'managed'}]},
  {staff:[{...f.count.staff[0],uid:'other'}]},
  {staff:[{...f.count.staff[0],id:'../internal'}]},
  {teams:[{id:'team1',name:'1班',active:false}]}
 ]){
  const view={...f.count,...change};
  await assert.rejects(f.create({fetchImpl:async()=>({
   status:200,json:async()=>({result:view})
  })})(),/STOP_LIVE_ROLE_COUNT_VIEW_(OWN_INPUT_UNAVAILABLE|NO_ACTIVE_INPUT_ROUTE)/);
 }
});

test('owner/leader require at least one active staff assigned to an ACTIVE team',async()=>{
 for(const role of ['owner','leader']){
  const f=liveCountFixture({role});
  const healthy={...f.count,staff:[{
   id:'managed1',uid:null,teamId:'team1',active:true,kind:'managed'
  }]};
  assert.equal((await f.create({fetchImpl:async()=>({
   status:200,json:async()=>({result:healthy})
  })})()).partnerCountViewAllowed,true,
   role+' can count a managed person assigned to an active team');
  for(const mismatch of [
   {staff:[{...healthy.staff[0],teamId:'retired_team'}]},
   {staff:[{...healthy.staff[0],teamId:null}]},
   {staff:[{...healthy.staff[0],teamId:'../internal'}]},
   {teams:[
    {id:'team1',name:'1班',active:true},
    {id:'retired_team',name:'旧班',active:false}
   ],staff:[{...healthy.staff[0],teamId:'retired_team'}]}
  ]){
   const view={...healthy,...mismatch};
   await assert.rejects(f.create({fetchImpl:async()=>({
    status:200,json:async()=>({result:view})
   })})(),/STOP_LIVE_ROLE_COUNT_VIEW_NO_ACTIVE_INPUT_ROUTE/,
   role+' may open a screen, but saved counts must not be orphaned from active team totals');
  }
  const mixed={...healthy,staff:[
   {...healthy.staff[0],teamId:'retired_team'},
   {id:'managed2',uid:null,teamId:'team1',active:true,kind:'managed'}
  ]};
  assert.equal((await f.create({fetchImpl:async()=>({
   status:200,json:async()=>({result:mixed})
  })})()).partnerCountViewAllowed,true,
   role+' can count only after an active-team staff route is available');
 }
});

test('cashback and CB monetary keys are disallowed even when count field names are otherwise valid',async()=>{
 const f=liveCountFixture();
 for(const extra of [
  {cashBackAmount:90000},{cbAmount:95000},{cashbackPerUnit:3000},
  {settlementAmount:45678},{unit_price:1000},{feeAmount:1000}
 ]){
  const view={...f.count,records:[{...extra}]};
  await assert.rejects(f.create({fetchImpl:async()=>({
   status:200,json:async()=>({result:view})
  })})(),/STOP_LIVE_ROLE_COUNT_VIEW_FINANCE_FIELD_EXPOSED/);
 }
 // NURO CB distribution quantities must remain accepted; amount is not.
 const view={...f.count,records:[{staffId:'partneruid',cbCounts:{0:2,10000:1}}]};
 assert.equal((await f.create({fetchImpl:async()=>({
  status:200,json:async()=>({result:view})
 })})()).partnerCountViewAllowed,true);
});


test('Owner finance preflight refuses success when identity expires during its four GET/list reads',async()=>{
 let now=T*1000;
 const calls=[];
 const fetchImpl=async(url,req)=>{
  calls.push({url,method:req.method});
  if(calls.length===4)now=(T+80)*1000;
  return {status:200,json:async()=>req.method==='POST'
   ?[{document:{name:RESOURCE_ROOT+'/'+JSON.parse(req.body).structuredQuery.from[0].collectionId+
     '/original',fields:{companyId:{stringValue:'internal_company'}}}}]
   :{name:url.slice(API.length),fields:{
      companyId:{stringValue:'internal_company'},
      ...(url.includes('/products/')?{revenue:{integerValue:'999'}}:
       {totalRevenue:{integerValue:'999'}})
     }}};
 };
 const proof=createLiveFirestoreOwnerPreflight({
  ownerIdToken:jwt('owneruid',{exp:T+125}),
  expectedOwnerUid:'owneruid',
  internalCompanyId:'internal_company',
  productId:'product_a',recordId:'record_a',
  fetchImpl,now:()=>now
 });
 await assert.rejects(proof(),/STOP_LIVE_ROLE_USER_IDENTITY_NOT_VERIFIED/);
 assert.equal(calls.length,4);
 assert(!calls.some(x=>x.method==='PATCH'),
  'preflight is strictly read-only even when it expires');
});

test('Owner finance preflight succeeds with four valid money reads and fresh token',async()=>{
 let calls=0;
 const fetchImpl=async(url,req)=>{
  calls++;
  return {status:200,json:async()=>req.method==='POST'
   ?[{document:{name:RESOURCE_ROOT+'/'+JSON.parse(req.body).structuredQuery.from[0].collectionId+
     '/original',fields:{companyId:{stringValue:'internal_company'}}}}]
   :{name:url.slice(API.length),fields:{
      companyId:{stringValue:'internal_company'},
      ...(url.includes('/products/')?{revenue:{integerValue:'999'}}:
       {totalRevenue:{integerValue:'999'}})
     }}};
 };
 const proof=createLiveFirestoreOwnerPreflight({
  ownerIdToken:jwt('owneruid'),expectedOwnerUid:'owneruid',
  internalCompanyId:'internal_company',productId:'product_a',
  recordId:'record_a',fetchImpl,now:()=>T*1000
 });
 assert.deepEqual(await proof(),{
  checkedAgainst:'synthetic-only',ownerFinanceAllowed:true
 });
 assert.equal(calls,4);
 await assert.rejects(proof(),/STOP_LIVE_ROLE_SINGLE_USE_OWNER_PREFLIGHT/);
});


test('count view spanning JST midnight cannot certify yesterday\'s count-view as today\'s input',async()=>{
 const f=liveCountFixture();
 const justBefore=Date.parse('2026-11-05T14:59:55Z');
 const justAfter=Date.parse('2026-11-05T15:00:05Z');
 let ticks=0;
 const prove=f.create({
  partnerIdToken:jwt('partneruid',{
   iat:T+3500,auth_time:T+3500,exp:T+7000
  }),
  now:()=>++ticks<=3?justBefore:justAfter
 });
 await assert.rejects(prove(),/STOP_LIVE_ROLE_COUNT_VIEW_DATE_ROLLOVER/);
 assert.equal(f.calls.length,1,'only a read-only workspace request was made');
 assert.equal(f.calls[0].req.method,'POST');
 assert.equal(JSON.parse(f.calls[0].req.body).data.date,COUNT_DATE);
 assert(!/submitPartnerWorkspaceCounts/.test(f.calls[0].url));
});
