'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../partner-workspace.html'),'utf8');
function harness({invite='',user=null}={}){
 const nodes=new Map();
 function element(){return {hidden:false,disabled:false,value:'',dataset:{},children:[],style:{},
  classList:{add(){},remove(){},toggle(){}},textContent:'',
  append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},
  addEventListener(){},setAttribute(){},querySelectorAll(){return []}};}
 for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,element());
 const calls=[],auth={currentUser:user};let callback,getReply=async()=>{throw {code:'functions/permission-denied'}};
 const context=vm.createContext({URL,Date,Intl,Map,Set,Object,Number,String,Array,Math,Promise,console,
  document:{getElementById:id=>nodes.get(id)||null,createElement:element,querySelectorAll:()=>[]},
  location:{href:'https://nico-factory.web.app/partner-workspace.html'+(invite?'?invite='+invite:''),origin:'https://nico-factory.web.app'},
  history:{replaceState(){}},window:{location:{assign(){}}},navigator:{},
  initializeApp:()=>({}),getAuth:()=>auth,getFunctions:()=>({}),
  httpsCallable:(_,name)=>async args=>{calls.push({name,args});return getReply(name,args)},
  onAuthStateChanged:(_,cb)=>{callback=cb},reload:async()=>{},getIdToken:async()=>{calls.push({name:'token'})},
  sendPasswordResetEmail:async()=>{},sendEmailVerification:async()=>{calls.push({name:'verify'})},signOut:async()=>{auth.currentUser=null;await callback(null)},
  setPersistence:async()=>{},browserSessionPersistence:{},signInWithEmailAndPassword:async()=>{},createUserWithEmailAndPassword:async()=>{},
 });
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*?;\r?\n/gm,'');
 vm.runInContext(script,context);
 return {nodes,calls,auth,context,login:async u=>{auth.currentUser=u;await callback(u)},
  setReply:fn=>{getReply=fn},run:s=>vm.runInContext(s,context)};
}
const verified={uid:'sample',email:'sample@example.test',emailVerified:true};
test('unverified invitation keeps resend and recheck visible outside hidden login form; no data read',async()=>{
 const h=harness({invite:'a'.repeat(43)});
 await h.login({...verified,emailVerified:false});
 assert.equal(h.nodes.get('loginBox').hidden,true);
 assert.equal(h.nodes.get('sessionBox').hidden,false);
 assert.equal(h.nodes.get('verify').hidden,false);
 assert.equal(h.nodes.get('checkVerify').hidden,false);
 assert.equal(h.calls.length,0);
 await h.nodes.get('verify').onclick();assert.equal(h.calls.at(-1).name,'verify');
 assert(!html.slice(html.indexOf('<section id="loginBox"'),html.indexOf('<section id="sessionBox"')).includes('id="verify"'));
});
test('verified invite waits for acceptance and refresh cannot read before membership is established',async()=>{
 const h=harness({invite:'a'.repeat(43)});await h.login(verified);await h.run('refresh()');
 assert.equal(h.nodes.get('inviteAccept').hidden,false);assert.equal(h.calls.length,0);
});
test('permission denial retains session recovery and hides every prior data pane',async()=>{
 const h=harness();await h.login(verified);
 assert.deepEqual(h.calls.map(c=>c.name),['token','getPartnerWorkspace']);
 assert.equal(h.nodes.get('sessionBox').hidden,false);
 assert.match(h.nodes.get('notice').textContent,/利用権限/);
 for(const id of ['appBox','dashboardBox','recordsBox','peopleBox','listBox','missingBox','hubBox'])
  assert.equal(h.nodes.get(id).hidden,true,id);
});
test('logout cancels pending data responses and stale failures cannot replace the signed-out notice',async()=>{
 const h=harness();let reject;
 h.setReply(()=>new Promise((_,r)=>{reject=r}));
 const pending=h.login(verified);await new Promise(setImmediate);
 await h.login(null);const notice=h.nodes.get('notice').textContent;
 reject({code:'functions/permission-denied'});await pending;
 assert.equal(h.nodes.get('notice').textContent,notice);
 assert.equal(h.nodes.get('sessionBox').hidden,true);
 assert.equal(h.run('loading'),false);
});
test('existing email, expired invitation, mismatch and unavailable errors have separate recovery instructions',()=>{
 const h=harness();const message=e=>h.context.errorMessage(e);
 assert.match(message({code:'auth/email-already-in-use'}),/新規作成ではなくログイン/);
 assert.match(message({details:{reason:'invite-expired'}}),/有効期限が切れ/);
 assert.match(message({details:{reason:'invite-email-mismatch'}}),/メールが異なり/);
 assert.match(message({code:'functions/unavailable'}),/サービスに接続できません/);
 assert(!message({message:'sensitive server details'}).includes('sensitive'));
});
