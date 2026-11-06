import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveFirestoreRoleVerifier} from '../tools/production/verify-live-firestore-roles.mjs';

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
    const partner=req.headers.Authorization==='Bearer '+jwt('partneruid');
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
