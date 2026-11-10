import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../finance-boundary-check.html',import.meta.url),'utf8');
const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(match,'diagnostic module is in new standalone HTML only');
const browser=match[1].replace(/^import \{[^\n]+\} from "[^"]+";\s*$/gm,'');
function load(probeFetch){
 const elements=new Map();
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',disabled:false,textContent:'',className:''
  });
  return elements.get(id);
 };
 const box={console:{log:()=>{throw Error('no console logs allowed')}},
  document:{getElementById:el},location:{origin:'https://nico-factory.web.app'},
  URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  initializeApp:()=>({}),initializeAuth:()=>({currentUser:null}),
  browserSessionPersistence:{kind:'mock-session'},signInWithEmailAndPassword:async()=>({}),
  signOut:async()=>{},
  getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{}}),
  onAuthStateChanged:(_a,cb)=>cb(null),
  fetch:probeFetch};
 runInNewContext(browser+'\nthis.probes={readCompany,checkCollection,request};',box);
 return {probes:box.probes,elements};
}
const response=(status,body)=>({
 status,json:async()=>body
});
const base='projects/sales-management-cc116/databases/(default)/documents/';
test('diagnostic page never writes, exports a token, or reads unmasked finance values',()=>{
 for(const forbidden of [
  'setDoc(', 'updateDoc(', 'deleteDoc(', 'writeBatch(',
  'submitPartnerWorkspaceCounts','localStorage','sessionStorage',
  'fetch("https://','console.log(', 'navigator.sendBeacon(',
  'revenuePerUnit', 'totalRevenue', 'cashbackOptions'
 ])assert.equal(html.includes(forbidden),false,forbidden);
 assert.match(html,/mask\.fieldPaths/);
 assert.match(html,/fieldPath:"companyId"/);
 assert.match(html,/getIdToken\(true\)/);
 assert.match(html,/https:\/\/firestore\.googleapis\.com/);
 assert.match(html,/location\.origin!=="https:\/\/nico-factory\.web\.app"/);
 assert.match(html,/getPartnerWorkspace/);
 assert.doesNotMatch(html,/\b(?:eval|Function)\(/);
});
test('list + GET success uses only companyId projections, with no monetary content in HTTP',async()=>{
 const recorded=[];
 const {probes}=load(async(url,opt)=>{
  recorded.push({url,method:opt.method,auth:opt.headers.Authorization,body:opt.body});
  if(opt.method==='POST')return response(200,[{document:{
   name:base+'products/product-one',fields:{companyId:{stringValue:'owner_co'}}
  }}]);
  return response(200,{name:base+'products/product-one',
    fields:{companyId:{stringValue:'owner_co'}}});
 });
 const result=await probes.checkCollection('test-token','products','owner_co');
 assert.equal(result.listStatus,'allowed');
 assert.equal(result.getStatus,'allowed');
 assert.equal(recorded.length,2);
 assert.equal(recorded[0].method,'POST');
 assert.equal(recorded[1].method,'GET');
 assert.match(recorded[1].url,/mask\.fieldPaths=companyId/);
 assert.deepEqual(JSON.parse(recorded[0].body).structuredQuery.select.fields,
   [{fieldPath:'companyId'}]);
 for(const item of recorded)assert.equal(item.auth,'Bearer test-token');
});
test('a denied query alone can never falsely prove document GET denial',async()=>{
 const {probes}=load(async()=>response(403,{error:{code:403,status:'PERMISSION_DENIED'}}));
 const first=await probes.checkCollection('test-token','products','owner_co');
 assert.equal(first.listStatus,'denied');
 assert.equal(first.getStatus,'untested');
});
test('saved in-memory document ID permits GET+LIST denial recheck without persisting or printing it',async()=>{
 let closed=false,requests=0;
 const {probes}=load(async(url,opt)=>{
  requests++;
  if(closed)return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
  if(opt.method==='POST')return response(200,[{document:{
    name:base+'records/record-old',fields:{companyId:{stringValue:'owner_co'}}
  }}]);
  return response(200,{name:base+'records/record-old',
    fields:{companyId:{stringValue:'owner_co'}}});
 });
 const before=await probes.checkCollection('token','records','owner_co');
 assert.equal(before.getStatus,'allowed');
 closed=true;
 const after=await probes.checkCollection('token','records','owner_co');
 assert.equal(after.listStatus,'denied');
 assert.equal(after.getStatus,'denied');
 assert.equal(requests,4);
});
test('unexpected origins, 401, unrelated 403 and missing source documents fail closed',async()=>{
 const {probes}=load(async(_url,opt)=>{
  if(opt.method==='POST')return response(401,{error:{code:401,status:'UNAUTHENTICATED'}});
  return response(403,{error:{code:403,status:'UNAUTHENTICATED'}});
 });
 const status=await probes.checkCollection('token','products','owner_co');
 assert.equal(status.listStatus,'unknown');
 assert.equal(status.getStatus,'untested');
 await assert.rejects(()=>probes.request('https://evil.example/steal','GET','token'),/SCOPE/);
});
test('signed-in user profile checked with masked fields, never trusting arbitrary client company choice',async()=>{
 const seen=[];
 const {probes}=load(async(url,opt)=>{
  seen.push(url);
  if(url.includes('/users/'))return response(200,{fields:{
   active:{booleanValue:true},companyId:{stringValue:'internal_co'}}});
  if(url.includes('/companies/'))return response(200,{fields:{
   companyKind:{stringValue:'internal'},ownerUid:{stringValue:'owner_u'}}});
  throw Error('unexpected url');
 });
 const owner=await probes.readCompany('token','owner_u');
 assert.equal(owner.company,'internal_co');
 assert.equal(owner.role,'owner');
 assert.equal(seen.length,2);
 assert.ok(seen.every(x=>x.includes('mask.fieldPaths=')));
});
test('before-and-after real-session path survives old-company GET denial without declaring a different UID safe',async()=>{
 const user={uid:'secondary_u1',emailVerified:true,getIdToken:async()=> 'test-id-token'};
 let closed=false,financeRequests=[];
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{
   value:'',disabled:false,textContent:'',className:''
 });return elements.get(id);};
 const requests=async(url,opt)=>{
   const path=new URL(url).pathname;
   if(path.endsWith('/users/secondary_u1'))return response(200,{fields:{
     companyId:{stringValue:'company_internal'},active:{booleanValue:true}}});
   if(path.endsWith('/companies/company_internal')){
     if(closed)return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
     return response(200,{fields:{companyKind:{stringValue:'internal'},
       ownerUid:{stringValue:'owner_u2'}}});
   }
   const kind=opt.method==='POST'?
     JSON.parse(opt.body).structuredQuery.from[0].collectionId:
     path.includes('/products/')?'products':'records';
   financeRequests.push({kind,method:opt.method,url,closed});
   if(closed)return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
   if(opt.method==='POST')return response(200,[{document:{
     name:base+kind+'/'+kind+'-original',
     fields:{companyId:{stringValue:'company_internal'}}
   }}]);
   return response(200,{fields:{companyId:{stringValue:'company_internal'}}});
 };
 const box={console:{log:()=>{throw Error('no console logs')}},
   document:{getElementById:el},location:{origin:'https://nico-factory.web.app'},
   URL,Intl,Date,Map,RegExp,JSON,Error,Number,
   initializeApp:()=>({}),initializeAuth:()=>({currentUser:user}),
   browserSessionPersistence:{kind:'mock-session'},signInWithEmailAndPassword:async()=>({}),
   signOut:async()=>{},
   getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{}}),
   onAuthStateChanged:(_a,cb)=>cb(user),
   fetch:requests};
 runInNewContext(browser,box);
 await el('run').onclick();
 assert.match(el('identity').textContent,/自社所属/);
 assert.match(el('products').textContent,/金額原票へのアクセス許可/);
 assert.match(el('records').textContent,/金額原票へのアクセス許可/);
 assert.equal(financeRequests.length,4);
 closed=true;
 await el('run').onclick();
 assert.match(el('identity').textContent,/旧自社所属/);
 assert.match(el('products').textContent,/LIST・GETともに拒否/);
 assert.match(el('records').textContent,/LIST・GETともに拒否/);
 assert.equal(financeRequests.length,8);
 assert.equal(financeRequests.filter(x=>x.closed&&x.method==='GET').length,2);
 for(const item of financeRequests)assert.ok(!item.url.includes('totalRevenue'));
});
test('fresh post-cutover partner without a previous GET must not assert complete denial',async()=>{
 const seen=[];
 const {probes}=load(async(url,opt)=>{
   seen.push({url,method:opt.method});
   if(url.includes('/users/'))return response(200,{fields:{
     active:{booleanValue:true},companyId:{stringValue:'company_a'}}});
   return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
 });
 const account=await probes.readCompany('token','random-user');
 assert.equal(account.role,'unknown');
 const results=await probes.checkCollection('token','products',account.company);
 assert.equal(results.listStatus,'denied');
 assert.equal(results.getStatus,'untested');
 assert.equal(seen.filter(x=>x.method==='GET').length,2);
});
test('inactive or missing self user cannot borrow an old successful company proof',async()=>{
 const {probes}=load(async(url)=>{
  if(url.includes('/users/'))return response(200,{fields:{
   active:{booleanValue:false},companyId:{stringValue:'company_a'}}});
  throw Error('Should never fetch a company for inactive user');
 });
 assert.equal(await probes.readCompany('token','user_a'),null);
});

test('diagnostic auth never shares the normal sales-app Firebase app session',()=>{
 const names=[];
 const auth={currentUser:null};
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{
   value:'',disabled:false,textContent:'',hidden:false
 });return elements.get(id);};
 const app={tag:'isolated'};
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
   location:{origin:'https://nico-factory.web.app'},
   document:{getElementById:el},console:{log:()=>{throw Error('No logging')}},
   browserSessionPersistence:{kind:'session'},
   initializeApp:(config,name)=>{names.push(name);return app;},
   initializeAuth:(a,options)=>{
     assert.equal(a,app);
     assert.equal(options.persistence.kind,'session');
     return auth;
   },
   getFunctions:()=>({}),
   httpsCallable:()=>async()=>({data:{}}),
   onAuthStateChanged:(_a,cb)=>cb(null),
   signInWithEmailAndPassword:async()=>({}),
   signOut:async()=>{},
   fetch:async()=>{throw Error('No network on bootstrap');}
 };
 runInNewContext(browser,context);
 assert.equal(names[0],'nico-finance-boundary-diagnostic');
 assert.equal(auth.currentUser,null);
 assert.equal(el('loginBox').hidden,false);
 assert.equal(el('run').disabled,true);
});
test('mobile sign-in uses only Firebase Auth; password cleared, no Firestore writes',async()=>{
 const auth={currentUser:null};
 const elements=new Map(),calls=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{
   value:'',disabled:false,textContent:'',hidden:false
 });return elements.get(id);};
 const callbacks=[];
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
   location:{origin:'https://nico-factory.web.app'},
   document:{getElementById:el},console:{log:()=>{throw Error('No logging')}},
   browserSessionPersistence:{kind:'session'},
   initializeApp:()=>({}),initializeAuth:()=>auth,
   getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{}}),
   onAuthStateChanged:(_a,cb)=>{callbacks.push(cb);cb(null);},
   signInWithEmailAndPassword:async(_auth,email,password)=>{
     calls.push({email,password});auth.currentUser={uid:'real-uid',emailVerified:true};
     callbacks.forEach(cb=>cb(auth.currentUser));return {user:auth.currentUser};
   },
   signOut:async()=>{calls.push({logout:true});auth.currentUser=null;callbacks.forEach(cb=>cb(null));},
   fetch:async()=>{throw Error('Login must not call Firestore REST');}
 };
 runInNewContext(browser,context);
 el('email').value='  test@example.com  ';
 el('password').value='test-secret-password';
 let prevented=false;
 await el('loginForm').onsubmit({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].email,'test@example.com');
 assert.equal(calls[0].password,'test-secret-password');
 assert.equal(el('password').value,'');
 assert.equal(el('email').value,'');
 assert.equal(el('loginBox').hidden,true);
 assert.equal(el('run').disabled,false);
 assert.doesNotMatch(el('status').textContent,/test-secret-password|test@example.com/);
 await el('logout').onclick();
 assert.equal(calls.length,2);
 assert.equal(calls[1].logout,true);
 assert.equal(el('loginBox').hidden,false);
 assert.equal(el('run').disabled,true);
});
test('browser login is direct Firebase Auth only and never creates/changes accounts',()=>{
 assert.match(html,/initializeApp\([^]*?"nico-finance-boundary-diagnostic"\)/);
 assert.match(html,/initializeAuth\(app,\{persistence:browserSessionPersistence\}\)/);
 assert.match(html,/signInWithEmailAndPassword\(auth,email,password\)/);
 assert.match(html,/\$\("password"\)\.value=""/);
 assert.doesNotMatch(html,/createUserWithEmailAndPassword|setPersistence\(|updateProfile\(|deleteUser\(/);
 assert.doesNotMatch(html,/console\.log\(|localStorage|sessionStorage/);
});

test('direct partner maps protected finance to verified HUB, and never claims GET denial from LIST alone',async()=>{
 const user={uid:'partner_direct_1',emailVerified:true,getIdToken:async()=> 'test-bearer'};
 const accountAuth={currentUser:user},els=new Map(),called=[],fetches=[];
 const el=id=>{if(!els.has(id))els.set(id,{value:'',disabled:false,hidden:false,textContent:'',className:''});return els.get(id);};
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  location:{origin:'https://nico-factory.web.app'},
  document:{getElementById:el},console:{log:()=>{throw Error('LOG')}},
  browserSessionPersistence:{kind:'test'},initializeApp:()=>({}),
  initializeAuth:()=>accountAuth,getFunctions:()=>({}),
  httpsCallable:(_fn,name)=>{
    assert.ok(['getPartnerWorkspace','getPartnerQuickCounts'].includes(name));
    return async input=>{called.push(input);return {data:{role:'member'}};};},
  onAuthStateChanged:(_a,cb)=>cb(user),
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:async(url,options)=>{
    fetches.push({url,options});
    if(url.includes('/users/'))return response(200,{fields:{
      active:{booleanValue:true},companyId:{stringValue:'partner_co'}}});
    if(url.includes('/companies/partner_co'))return response(200,{fields:{
      companyKind:{stringValue:'partner'},ownerUid:{stringValue:'partner_owner'},
      hubCompanyId:{stringValue:'hub_main'}}});
    assert.match(options.body||'',/hub_main/);
    return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
  }
 };
 runInNewContext(browser,context);
 await el('run').onclick();
 assert.match(el('identity').textContent,/協力店所属をFunctionsで照合済み/);
 assert.match(el('counts').textContent,/読取成功/);
 assert.match(el('products').textContent,/GET未検証/);
 assert.match(el('records').textContent,/GET未検証/);
 assert.equal(called.length,1);
 assert.equal(called[0].workspaceCompanyId,undefined);
 assert.equal(fetches.filter(x=>x.options.method==='POST').length,2);
 assert.ok(fetches.filter(x=>x.options.method==='POST')
   .every(x=>JSON.parse(x.options.body).structuredQuery.where.fieldFilter.value.stringValue==='hub_main'));
});
test('secondary partner requires live callable scope; an unrelated GET permission is not a partner proof',async()=>{
 const user={uid:'secondary_1',emailVerified:true,getIdToken:async()=> 'test-bearer'};
 const auth={currentUser:user},els=new Map(),call=[];
 const el=id=>{if(!els.has(id))els.set(id,{value:'',disabled:false,hidden:false,textContent:'',className:''});return els.get(id);};
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  location:{origin:'https://nico-factory.web.app'},
  document:{getElementById:el},console:{log:()=>{throw Error('LOG')}},
  browserSessionPersistence:{},initializeApp:()=>({}),initializeAuth:()=>auth,
  getFunctions:()=>({}),httpsCallable:()=>async data=>{call.push(data);
    return {data:{role:'leader'}};},
  onAuthStateChanged:(_a,cb)=>cb(user),
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:async(url,options)=>{
    if(url.includes('/users/'))return response(200,{fields:{
      active:{booleanValue:true},companyId:{stringValue:'internal_co'}}});
    if(url.includes('/companies/'))return response(200,{fields:{
      companyKind:{stringValue:'internal'},ownerUid:{stringValue:'other_owner'}}});
    if(options.method==='POST'){
      const category=JSON.parse(options.body).structuredQuery.from[0].collectionId;
      return response(200,[{document:{name:base+category+'/'+category+'-one',
       fields:{companyId:{stringValue:'internal_co'}}}}]);
    }
    return response(200,{fields:{companyId:{stringValue:'internal_co'}}});
  }
 };
 runInNewContext(browser,context);
 el('workspace').value='partner_linked';
 await el('run').onclick();
 assert.match(el('identity').textContent,/協力店所属をFunctionsで照合済み/);
 assert.match(el('products').textContent,/金額原票へのアクセス許可/);
 assert.match(el('records').textContent,/金額原票へのアクセス許可/);
 assert.equal(call.length,1);
 assert.equal(call[0].workspaceCompanyId,'partner_linked');
 assert.equal(el('counts').className,'pass');
});
test('Owner handoff reuses only Owner-proved raw IDs after partner login: GET and LIST both denied',async()=>{
 let user={uid:'real_owner',emailVerified:true,getIdToken:async()=> 'owner-token'};
 const auth={get currentUser(){return user;}},els=new Map(),events=[],requests=[];
 const el=id=>{if(!els.has(id))els.set(id,{value:'',disabled:false,hidden:false,textContent:'',className:''});return els.get(id);};
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  location:{origin:'https://nico-factory.web.app'},
  document:{getElementById:el},console:{log:()=>{throw Error('No private logs')}},
  browserSessionPersistence:{},initializeApp:()=>({}),initializeAuth:()=>auth,
  getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{role:'member'}}),
  onAuthStateChanged:(_a,cb)=>{events.push(cb);cb(user);},
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:async(url,options)=>{
    if(url.includes('/users/'))return response(200,{fields:{
      active:{booleanValue:true},companyId:{stringValue:user.uid==='real_owner'?'company_main':'company_partner'}}});
    if(url.includes('/companies/')){
      if(user.uid==='real_owner')return response(200,{fields:{
        companyKind:{stringValue:'internal'},ownerUid:{stringValue:'real_owner'}}});
      return response(200,{fields:{
        companyKind:{stringValue:'partner'},ownerUid:{stringValue:'other_partner_owner'},
        hubCompanyId:{stringValue:'company_main'}}});
    }
    requests.push({url,method:options.method,uid:user.uid,body:options.body});
    const collection=options.method==='POST'?
      JSON.parse(options.body).structuredQuery.from[0].collectionId:
      url.includes('/products/')?'products':'records';
    if(user.uid!=='real_owner')return response(403,{
      error:{code:403,status:'PERMISSION_DENIED'}});
    if(options.method==='POST')return response(200,[{
      document:{name:base+collection+'/'+collection+'_doc1',
       fields:{companyId:{stringValue:'company_main'}}}
    }]);
    return response(200,{fields:{companyId:{stringValue:'company_main'}}});
  }
 };
 runInNewContext(browser,context);
 await el('run').onclick();
 assert.match(el('products').textContent,/Owner閲覧許可/);
 assert.match(el('records').textContent,/Owner閲覧許可/);
 user={uid:'real_partner',emailVerified:true,getIdToken:async()=> 'partner-token'};
 for(const cb of events)cb(user);
 await el('run').onclick();
 assert.match(el('identity').textContent,/協力店所属をFunctionsで照合済み/);
 assert.match(el('products').textContent,/LIST・GETともに拒否/);
 assert.match(el('records').textContent,/LIST・GETともに拒否/);
 assert.equal(requests.filter(x=>x.uid==='real_owner'&&x.method==='GET').length,2);
 assert.equal(requests.filter(x=>x.uid==='real_partner'&&x.method==='GET').length,2);
 assert.ok(requests.filter(x=>x.uid==='real_partner'&&x.method==='GET')
   .every(x=>/products_doc1|records_doc1/.test(x.url)));
 assert.ok(requests.every(x=>!x.url.includes('revenue')));
});

test('direct partner owner: deployed quick-count API verifies role if new workspace API is missing',async()=>{
 const user={uid:'direct_partner_owner',emailVerified:true,getIdToken:async()=> 'test-bearer'};
 const els=new Map(),calls=[],requests=[];
 const el=id=>{if(!els.has(id))els.set(id,{
   value:'',disabled:false,hidden:false,textContent:'',className:''});
   return els.get(id);};
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  location:{origin:'https://nico-factory.web.app'},
  document:{getElementById:el},console:{log:()=>{throw Error('NO_PRIVATE_LOGS')}},
  browserSessionPersistence:{},initializeApp:()=>({}),
  initializeAuth:()=>({currentUser:user}),getFunctions:()=>({}),
  httpsCallable:(_fn,name)=>{
   if(name==='getPartnerWorkspace')return async()=>{calls.push(name);throw Error('not deployed');};
   if(name==='getPartnerQuickCounts')return async ({date})=>{
    calls.push(name);return {data:{role:'partner',date,report:null}};
   };
   throw Error('UNEXPECTED_FUNCTION');
  },
  onAuthStateChanged:(_a,cb)=>cb(user),
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:async(url,options)=>{
   requests.push({url,options});
   if(url.includes('/users/'))return response(200,{fields:{
    active:{booleanValue:true},companyId:{stringValue:'partner_company'}}});
   if(url.includes('/companies/partner_company'))return response(200,{fields:{
    companyKind:{stringValue:'partner'},ownerUid:{stringValue:user.uid},
    hubCompanyId:{stringValue:'original_hub'}}});
   return response(403,{error:{code:403,status:'PERMISSION_DENIED'}});
  }
 };
 runInNewContext(browser,context);
 await el('run').onclick();
 assert.deepEqual(calls,['getPartnerWorkspace','getPartnerQuickCounts']);
 assert.match(el('identity').textContent,/協力店所属をFunctionsで照合済み/);
 assert.match(el('counts').textContent,/読取成功/);
 assert.match(el('products').textContent,/GET未検証/);
 assert.match(el('records').textContent,/GET未検証/);
 assert.equal(requests.filter(x=>x.options?.method==='POST').length,2);
 assert.ok(requests.filter(x=>x.options?.method==='POST').every(x=>
   JSON.parse(x.options.body).structuredQuery.where.fieldFilter.value.stringValue==='original_hub'));
});

test('quick-count fallback must reject a hub role and must not probe finance on unverified partner identity',async()=>{
 const user={uid:'partner_actor',emailVerified:true,getIdToken:async()=> 'token'};
 const els=new Map(),calls=[],requests=[];
 const el=id=>{if(!els.has(id))els.set(id,{
  value:'',disabled:false,hidden:false,textContent:'',className:''});
  return els.get(id);};
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  location:{origin:'https://nico-factory.web.app'},
  document:{getElementById:el},console:{log:()=>{throw Error('NO_PRIVATE_LOGS')}},
  browserSessionPersistence:{},initializeApp:()=>({}),
  initializeAuth:()=>({currentUser:user}),getFunctions:()=>({}),
  httpsCallable:(_fn,name)=>{
   if(name==='getPartnerWorkspace')return async()=>{calls.push(name);throw Error('not deployed');};
   if(name==='getPartnerQuickCounts')return async({date})=>{
    calls.push(name);return {data:{role:'hub',date}};
   };
   throw Error('UNEXPECTED_FUNCTION');
  },
  onAuthStateChanged:(_a,cb)=>cb(user),
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:async(url,options)=>{
   requests.push({url,options});
   if(url.includes('/users/'))return response(200,{fields:{
    active:{booleanValue:true},companyId:{stringValue:'partner_company'}}});
   if(url.includes('/companies/partner_company'))return response(200,{fields:{
    companyKind:{stringValue:'partner'},hubCompanyId:{stringValue:'original_hub'}}});
   throw Error('FINANCE_PROBE_MUST_NOT_RUN');
  }
 };
 runInNewContext(browser,context);
 await el('run').onclick();
 assert.deepEqual(calls,['getPartnerWorkspace','getPartnerQuickCounts']);
 assert.match(el('identity').textContent,/認証・所属の確認が必要/);
 assert.match(el('products').textContent,/未確認/);
 assert.match(el('records').textContent,/未確認/);
 assert.equal(requests.length,2);
});

test('quick-count fallback never promotes an unverified secondary company context',async()=>{
 const user={uid:'internal_secondary',emailVerified:true,getIdToken:async()=> 'token'};
 const els=new Map(),calls=[];
 const el=id=>{if(!els.has(id))els.set(id,{
  value:'',disabled:false,hidden:false,textContent:'',className:''});
  return els.get(id);};
 const context={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  location:{origin:'https://nico-factory.web.app'},
  document:{getElementById:el},console:{log:()=>{throw Error('NO_PRIVATE_LOGS')}},
  browserSessionPersistence:{},initializeApp:()=>({}),
  initializeAuth:()=>({currentUser:user}),getFunctions:()=>({}),
  httpsCallable:(_fn,name)=>{
   if(name==='getPartnerWorkspace')return async()=>{calls.push(name);throw Error('not deployed');};
   if(name==='getPartnerQuickCounts')return async()=>{calls.push(name);return {data:{role:'partner'}};};
   throw Error('UNEXPECTED_FUNCTION');
  },
  onAuthStateChanged:(_a,cb)=>cb(user),
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:async(url)=>{
   if(url.includes('/users/'))return response(200,{fields:{
    active:{booleanValue:true},companyId:{stringValue:'internal_hub'}}});
   if(url.includes('/companies/internal_hub'))return response(200,{fields:{
    companyKind:{stringValue:'internal'},ownerUid:{stringValue:'different_owner'}}});
   throw Error('FINANCE_PROBE_MUST_NOT_RUN');
  }
 };
 runInNewContext(browser,context);
 el('workspace').value='partner_company';
 await el('run').onclick();
 assert.deepEqual(calls,['getPartnerWorkspace']);
 assert.match(el('identity').textContent,/認証・所属の確認が必要/);
 assert.match(el('products').textContent,/未確認/);
});

function dualOwnerScenario(callable){
 const user={uid:'hub-owner-dual',emailVerified:true,getIdToken:async()=> 'test-id-token'};
 const auth={currentUser:user},els=new Map(),functionCalls=[],financialRequests=[];
 const el=id=>{if(!els.has(id))els.set(id,{value:'',disabled:false,hidden:false,textContent:'',className:''});return els.get(id);};
 const box={URL,Intl,Date,Map,RegExp,JSON,Error,Number,
  location:{origin:'https://nico-factory.web.app'},
  document:{getElementById:el},console:{log:()=>{throw Error('NO_LOG')}},
  browserSessionPersistence:{},
  initializeApp:()=>({}),initializeAuth:()=>auth,getFunctions:()=>({}),
  httpsCallable:(_fn,name)=>async input=>{
    functionCalls.push({name,input});
    if(name!=='getPartnerWorkspace')throw Error('NO_QUICK_COUNT_IMPERSONATION');
    return callable(input);
  },
  onAuthStateChanged:(_a,cb)=>cb(user),
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:async(url,options)=>{
    if(url.includes('/users/'))return response(200,{fields:{
      companyId:{stringValue:'internal_hub'},active:{booleanValue:true}}});
    if(url.includes('/companies/'))return response(200,{fields:{
      companyKind:{stringValue:'internal'},ownerUid:{stringValue:user.uid}}});
    financialRequests.push({url,method:options.method,body:options.body});
    if(url.includes(':runQuery'))return response(403,{error:{
      code:403,status:'PERMISSION_DENIED'}});
    throw Error('DIRECT_FINANCE_GET_SHOULD_NOT_OCCUR_WITHOUT_APPROVED_HANDLE');
  }
 };
 runInNewContext(browser,box);
 el('workspace').value='partner_workspace';
 return {el,functionCalls,financialRequests};
}
test('hub Owner can diagnose an explicitly approved second partner Owner workspace without changing the primary user',async()=>{
 const x=dualOwnerScenario(async input=>({data:{role:'owner',date:input.date}}));
 await x.el('run').onclick();
 assert.equal(x.functionCalls.length,1);
 assert.equal(x.functionCalls[0].name,'getPartnerWorkspace');
 assert.equal(x.functionCalls[0].input.workspaceCompanyId,'partner_workspace');
 assert.match(x.el('identity').textContent,/協力店所属をFunctionsで照合済み/);
 assert.match(x.el('counts').textContent,/読取成功/);
 assert.equal(x.financialRequests.length,2);
 assert(x.financialRequests.every(r=>r.method==='POST'));
 assert(x.financialRequests.every(r=>r.body.includes('"companyId"')));
 assert.match(x.el('products').textContent,/GET未検証/);
 assert.match(x.el('records').textContent,/GET未検証/);
});
test('dual hub Owner cannot reach finance queries when secondary callable fails or returns hub-only scope',async()=>{
 for(const callable of [
  async()=>{throw Error('UNAVAILABLE');},
  async input=>({data:{role:'hub',date:input.date}}),
  async()=>({data:{role:'unknown'}})
 ]){
  const x=dualOwnerScenario(callable);
  await x.el('run').onclick();
  assert.equal(x.functionCalls.length,1);
  assert.equal(x.financialRequests.length,0);
  assert.match(x.el('identity').textContent,/認証・所属の確認が必要/);
  assert.equal(x.el('products').textContent,'未確認');
  assert.equal(x.el('records').textContent,'未確認');
 }
});


test("fresh partner owner with company GET denied can prove same-hub finance GET/LIST denied after verified Hub handoff",async()=>{
 const hub="company_internal",partner="partner_actual";
 const owner={uid:"owner_u2",emailVerified:true,getIdToken:async()=>"hub-token"};
 const verifiedPartner={uid:"partner_u3",emailVerified:true,getIdToken:async()=>"partner-token"};
 const auth={currentUser:owner},cb=[];
 const elements=new Map(),calls=[],rawFinance=[];
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   value:"",disabled:false,hidden:false,textContent:"",className:""
  });
  return elements.get(id);
 };
 const get=async(url,opts)=>{
  const token=opts.headers?.Authorization?.replace("Bearer ","");
  const pathname=new URL(url).pathname;
  if(pathname.endsWith("/users/owner_u2"))
   return response(200,{fields:{active:{booleanValue:true},
    companyId:{stringValue:hub}}});
  if(pathname.endsWith("/users/partner_u3"))
   return response(200,{fields:{active:{booleanValue:true},
    companyId:{stringValue:partner}}});
  if(pathname.endsWith("/companies/"+hub))
   return response(200,{fields:{companyKind:{stringValue:"internal"},
    ownerUid:{stringValue:owner.uid}}});
  if(pathname.endsWith("/companies/"+partner))
   return response(403,{error:{code:403,status:"PERMISSION_DENIED"}});
  const name=opts.method==="POST"?
    JSON.parse(opts.body)?.structuredQuery?.from?.[0]?.collectionId:
    pathname.includes("/products/")?"products":"records";
  rawFinance.push({token,name,method:opts.method,body:opts.body,url});
  if(token==="partner-token")
   return response(403,{error:{code:403,status:"PERMISSION_DENIED"}});
  if(opts.method==="POST")
   return response(200,[{document:{name:base+name+"/"+name+"-sample",
    fields:{companyId:{stringValue:hub}}}}]);
  return response(200,{fields:{companyId:{stringValue:hub}}});
 };
 const scope=(_functions,name)=>async(input)=>{
  if(name!=="getPartnerWorkspace")throw Error("NO_FALLBACK_ALLOWED");
  calls.push({caller:auth.currentUser.uid,input});
  const date=input.date;
  if(auth.currentUser===owner)return {data:{
   role:"hub",date,registeredCompanies:[
    {partnerCompanyId:partner,name:"協力店A",active:true}
   ]
  }};
  if(auth.currentUser===verifiedPartner)return {data:{
   role:"owner",date,categories:["NURO","Air"]
  }};
  throw Error("Unexpected actor");
 };
 const context={console:{log:()=>{throw Error("NO_LOG")}},
  document:{getElementById:el},location:{origin:"https://nico-factory.web.app"},
  URL,Intl,Date,Map,Set,RegExp,JSON,Error,Number,
  initializeApp:()=>({}),initializeAuth:()=>auth,
  browserSessionPersistence:{kind:"session"},
  getFunctions:()=>({}),httpsCallable:scope,
  onAuthStateChanged:(_a,callback)=>{cb.push(callback);callback(auth.currentUser)},
  signInWithEmailAndPassword:async()=>({}),signOut:async()=>{},
  fetch:get};
 runInNewContext(browser,context);
 await el("run").onclick();
 assert.match(el("products").textContent,/Owner閲覧許可/);
 assert.match(el("records").textContent,/Owner閲覧許可/);
 assert.equal(calls.length,1);
 assert.equal(calls[0].caller,owner.uid);
 assert.equal(calls[0].input.date.length,10);
 const first=rawFinance.slice();
 assert.equal(first.length,4);
 assert(first.every(x=>x.token==="hub-token"));
 auth.currentUser=verifiedPartner;
 cb[0](verifiedPartner);
 await el("run").onclick();
 assert.match(el("identity").textContent,/協力店所属をFunctionsで照合済み/);
 assert.match(el("products").textContent,/LIST・GETともに拒否/);
 assert.match(el("records").textContent,/LIST・GETともに拒否/);
 assert.match(el("counts").textContent,/協力店件数の読取成功/);
 assert.equal(calls.length,2);
 assert.equal(calls[1].caller,verifiedPartner.uid);
 assert.equal(rawFinance.length,8);
 assert(rawFinance.slice(4).every(x=>x.token==="partner-token"));
 assert.equal(rawFinance.slice(4).filter(x=>x.method==="GET").length,2);
 assert(rawFinance.slice(4).every(x=>x.url.includes(
  "firestore.googleapis.com/v1/projects/sales-management-cc116")));
 assert.equal(el("status").textContent.includes("本番承認"),true);
});
test("unrelated partner, unverified Hub inventory or forged workspace never produce finance success",async()=>{
 const htmlSource=readFileSync(new URL("../finance-boundary-check.html",import.meta.url),"utf8");
 assert.match(htmlSource,/Array\.isArray\(ownerHandoff\.partnerIds\)/);
 assert.match(htmlSource,/ownerHandoff\.partnerIds\.includes\(account\.company\)/);
 assert.match(htmlSource,/reply\?\.role==="hub"&&reply\?\.date===date/);
 assert.match(htmlSource,/new Set\(partnerIds\)\.size===partnerIds\.length/);
 assert.match(htmlSource,/ownerHandoff=null;/);
 assert.match(htmlSource,/ownerHandoff\.company!==account\.company/);
 assert.match(htmlSource,/ownerHandoff\.company===account\.company/);
 assert.doesNotMatch(htmlSource,/localStorage|sessionStorage|console\.log\(/);
});
