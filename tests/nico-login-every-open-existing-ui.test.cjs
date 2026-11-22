'use strict';
/**
 * Existing NICO login remains visually and semantically identical.
 * Test only the startup retention policy and background session closure.
 * Synthetic stubs: never touches Firebase, real credentials, or production.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const section=(begin,end)=>{
  const a=html.indexOf(begin),b=html.indexOf(end,a+begin.length);
  assert(a>=0&&b>a,'source anchor missing: '+begin);
  return html.slice(a,b);
};
const fnv=part=>{
  let h=2166136261;
  for(let i=0;i<part.length;i++) h=Math.imul(h^part.charCodeAt(i),16777619)>>>0;
  return h.toString(16).padStart(8,'0');
};
const markup=section('<main id="authScreen">','</main>')+'</main>';
const existingLogin=section('async function login()','authButton.onclick');
const startup=section('const auth =\n  getAuth(app);','auth.languageCode =');
const background=section('document.addEventListener("visibilitychange", () => {','\n});')+'\n});';

test('existing screen and exact email/password login code are unchanged',()=>{
  assert.equal(fnv(markup),'6d07c2d1','login markup/design drift');
  assert.equal(fnv(existingLogin),'9d04c3ad','existing email/password flow drift');
  assert.match(existingLogin,/signInWithEmailAndPassword\(\s*auth,\s*email,\s*password\s*\)/);
  assert.equal((html.match(/id="authButton"/g)||[]).length,1);
  assert.equal((html.match(/id="email"/g)||[]).length,1);
  assert.equal((html.match(/id="password"/g)||[]).length,1);
});
test('SDK retains getAuth but requires memory-only persistence, after clearing OLD saved user',()=>{
  const imports=section('import {\n  getAuth,','} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";');
  assert.match(imports,/\bsetPersistence,/);
  assert.match(imports,/\binMemoryPersistence,/);
  assert.match(startup,/await auth\.authStateReady\(\);/);
  assert.match(startup,/if \(auth\.currentUser\) await signOut\(auth\);/);
  assert.match(startup,/await setPersistence\(auth, inMemoryPersistence\);/);
  assert(startup.indexOf('await signOut(auth)')<startup.indexOf('await setPersistence(auth, inMemoryPersistence)'));
  assert(!startup.includes('browserLocalPersistence'));
  assert(!startup.includes('browserSessionPersistence'));
});
async function runStartup({cached=null,signOutFailure=false,persistenceFailure=false}={}){
  const steps=[],auth={
    currentUser:cached,
    authStateReady:async()=>{steps.push('ready');}
  };
  const context={
    app:{},
    getAuth:()=>auth,
    signOut:async () => {
      steps.push('logout');
      if(signOutFailure)throw Error('STUB_SIGN_OUT_FAILURE');
      auth.currentUser=null;
    },
    setPersistence:async (a,p) => {
      steps.push('memory');
      assert.equal(a,auth);
      assert.equal(a.currentUser,null,'old login must be gone before persistence setup');
      assert.equal(p,'MEMORY_ONLY');
      if(persistenceFailure)throw Error('STUB_PERSISTENCE_FAILURE');
    },
    inMemoryPersistence:'MEMORY_ONLY'
  };
  let thrown=null;
  try{await vm.runInNewContext('(async()=>{\n'+startup+'\nreturn auth;\n})()',context,{timeout:1000});}
  catch(e){thrown=e;}
  return {steps,auth,thrown};
}
test('a prior locally saved login is signed out BEFORE app routing',async()=>{
  const r=await runStartup({cached:{uid:'synthetic-old-account'}});
  assert.equal(r.thrown,null);
  assert.deepEqual(r.steps,['ready','logout','memory']);
  assert.equal(r.auth.currentUser,null);
});
test('fresh startup preserves existing login form without any automatic sign-in',async()=>{
  const r=await runStartup();
  assert.equal(r.thrown,null);
  assert.deepEqual(r.steps,['ready','memory']);
  assert.equal(r.auth.currentUser,null);
  assert.doesNotMatch(startup,/signInWithEmailAndPassword\s*\(/);
});
test('if sign-out or memory protection fails, initialization stops rather than silently allowing cached session',async()=>{
  const logout=await runStartup({cached:{uid:'old'},signOutFailure:true});
  assert.match(logout.thrown?.message||'',/STUB_SIGN_OUT_FAILURE/);
  assert.deepEqual(logout.steps,['ready','logout']);
  const persistence=await runStartup({persistenceFailure:true});
  assert.match(persistence.thrown?.message||'',/STUB_PERSISTENCE_FAILURE/);
  assert.deepEqual(persistence.steps,['ready','memory']);
});
function backgroundHarness({visible='block',state='hidden',user={uid:'synthetic'}}={}){
  let callback=null,stop=0,signouts=0,reloads=0;
  const auth={currentUser:user};
  const appScreen={style:{display:visible}},authScreen={style:{display:'none'}};
  const doc={visibilityState:state,addEventListener:(name,fn)=>{
    assert.equal(name,'visibilitychange');
    callback=fn;
  }};
  const context={
    document:doc,auth,appScreen,authScreen,
    stopRealtimeListeners:()=>{stop++;},
    signOut:async()=>{signouts++;auth.currentUser=null;},
    location:{reload:()=>{reloads++;}}
  };
  vm.runInNewContext(background,context,{timeout:1000});
  assert.equal(typeof callback,'function');
  return {
    fire:()=>callback(),
    doc,auth,appScreen,authScreen,
    get stop(){return stop;},get signouts(){return signouts;},get reloads(){return reloads;}
  };
}
test('iPhone/PWA backgrounding hides an open dashboard before async sign-out',async()=>{
  const h=backgroundHarness();
  h.fire();
  assert.equal(h.appScreen.style.display,'none');
  assert.equal(h.authScreen.style.display,'block');
  assert.equal(h.stop,1);
  await Promise.resolve();
  assert.equal(h.signouts,1);
  assert.equal(h.auth.currentUser,null);
});
test('switching foreground, opening a login form, or an unauthenticated visit does not trigger sign-out',()=>{
  for(const opts of [
    {state:'visible'}, {visible:'none'}, {user:null}
  ]){
    const h=backgroundHarness(opts);
    h.fire();
    assert.equal(h.stop,0);
    assert.equal(h.signouts,0);
  }
});
test('both screens are kept stable and the original password button remains the only sign-in route',()=>{
  assert.equal((html.match(/document\.addEventListener\("visibilitychange"/g)||[]).length,1);
  assert.match(background,/signOut\(auth\)\.catch\(\(\) => location\.reload\(\)\)/);
  assert.match(background,/stopRealtimeListeners\(\)/);
  assert.match(html,/async function login\(\)/);
});
