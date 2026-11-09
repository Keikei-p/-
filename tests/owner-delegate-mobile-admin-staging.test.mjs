import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(
 new URL("../staging/owner-delegation-v1/owner-delegate-admin.html",import.meta.url),
 "utf8"
);
const scripts=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
const js=scripts[0]?.[1];
assert.equal(scripts.length,1,"standalone page must have one module");
const script=js.replace(/^import\s+\{[^\n]+\}\s+from\s+"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+";\s*$/gm,"");

function load({listResult=null,changeResult=null,confirm=()=>false}={}){
 const elements=new Map();
 const make=()=>{
  const n={textContent:"",hidden:false,disabled:false,className:"",type:"",
   children:[],append(...items){this.children.push(...items)},
   replaceChildren(){this.children=[]},
   querySelectorAll(){return this.children.flatMap(c=>c.children||[])
    .filter(b=>b.type==="button")},
  };
  return n;
 };
 const get=id=>{
  if(!elements.has(id))elements.set(id,make());
  return elements.get(id);
 };
 let authChange=null,auth={currentUser:null},listCalls=0,changeCalls=0,lastArgs=null;
 const context={
  initializeApp:()=>({}),
  getAuth:()=>auth,getFunctions:()=>({}),
  httpsCallable:(_fun,name)=>{
   if(name==="listHubOwnerDelegates")return async args=>{
    listCalls++;lastArgs=args;
    if(listResult===null)throw Error("backend unavailable");
    return {data:listResult};
   };
   if(name==="changeHubOwnerDelegate")return async args=>{
    changeCalls++;lastArgs=args;
    if(changeResult===null)throw Error("backend unavailable");
    return {data:changeResult};
   };
   throw Error("Unexpected callable: "+name);
  },
  onAuthStateChanged:(_auth,cb)=>{authChange=cb;return ()=>{}},
  document:{getElementById:get,createElement:()=>make()},
  window:{confirm},
  console
 };
 vm.runInNewContext(script+"\n;globalThis.__test={parseList,parseChange,refresh,apply,render, get model(){return model}};",
  context,{timeout:3000});
 return {api:context.__test,elements,auth,
  authChange:u=>authChange(u),getListCalls:()=>listCalls,
  getChangeCalls:()=>changeCalls,getLastArgs:()=>lastArgs};
}
const uid="owner_A234";
const candidate={uid,displayName:"追加Owner",approved:false};
const validList={
 scope:"explicit-additional-hub-owners",
 role:"primary-owner",
 ownerGrantVersion:1,
 candidates:[candidate],
 financeIncluded:false,canEditOriginalOwnerUid:false
};
const validAck={updated:true,ownerGrantVersion:2,delegatedOwnerUid:uid,approved:true};

test("only reviewed Owner list shape may reach the screen",()=>{
 const {api}=load();
 const r=api.parseList(validList);
 assert.equal(r.version,1);
 assert.equal(r.people.length,1);
 assert.equal(r.people[0].uid,uid);
 assert.equal(r.people[0].approved,false);
 assert(Object.isFrozen(r.people[0]));
 for(const wrong of [
  {...validList,role:"partner"},
  {...validList,scope:"revenue"},
  {...validList,financeIncluded:true},
  {...validList,canEditOriginalOwnerUid:true},
  {...validList,ownerGrantVersion:-1},
  {...validList,ownerGrantVersion:1000000},
  {...validList,companyId:"another"},
  {...validList,revenue:400000},
  {...validList,candidates:[{...candidate,unitPrice:10000}]},
  {...validList,candidates:[{...candidate,approved:"true"}]},
  {...validList,candidates:[{...candidate,displayName:"10000円"}]},
  {...validList,candidates:[candidate,candidate]},
  {...validList,candidates:Array.from({length:11},(_,i)=>({...candidate,uid:"id_"+i}))}
 ])assert.throws(()=>api.parseList(wrong),/OWNER_DELEGATE_RESPONSE_NOT_REVIEWED/);
});

test("ack must match exact selected uid, expected version and requested state",()=>{
 const {api}=load();
 assert.equal(api.parseChange(validAck,{uid,approved:true,version:1}),true);
 for(const wrong of [
  {...validAck,updated:false},
  {...validAck,ownerGrantVersion:1},
  {...validAck,delegatedOwnerUid:"different_owner"},
  {...validAck,approved:false},
  {...validAck,unitPrice:50000},
  {...validAck,countChange:true}
 ])assert.throws(()=>api.parseChange(wrong,{uid,approved:true,version:1}),
  /OWNER_DELEGATE_RESPONSE_NOT_REVIEWED/);
});

test("page is safely unavailable with no backend or without a logged-in verified principal",async()=>{
 const f=load();
 await f.api.refresh();
 assert.equal(f.getListCalls(),0);
 assert.equal(f.elements.get("delegatesBox").hidden,true);
 assert.match(f.elements.get("status").textContent,/未ログイン/);
 f.auth.currentUser={uid:"primary",emailVerified:false};
 await f.api.refresh();
 assert.equal(f.getListCalls(),0);
 f.auth.currentUser={uid:"primary",emailVerified:true};
 await f.api.refresh();
 assert.equal(f.getListCalls(),1);
 assert.equal(f.elements.get("delegatesBox").hidden,true);
 assert.match(f.elements.get("status").textContent,/APIを確認できません/);
 assert.equal(f.getChangeCalls(),0);
});

test("verified primary Owner can view candidates and cancel a grant without a write",async()=>{
 const f=load({listResult:validList,confirm:()=>false});
 f.auth.currentUser={uid:"primary",emailVerified:true};
 await f.api.refresh();
 assert.equal(f.getListCalls(),1);
 assert.equal(f.elements.get("delegatesBox").hidden,false);
 const r=f.api.model;
 assert.equal(r.people.length,1);
 await f.api.apply(r.people[0]);
 assert.equal(f.getChangeCalls(),0);
});

test("confirmation performs exactly one version-gated change and ONLY one read refresh",async()=>{
 const f=load({
  listResult:validList,changeResult:validAck,confirm:()=>true
 });
 f.auth.currentUser={uid:"primary",emailVerified:true};
 await f.api.refresh();
 const p=f.api.model.people[0];
 await f.api.apply(p);
 assert.equal(f.getChangeCalls(),1);
 assert.deepEqual(JSON.parse(JSON.stringify(f.getLastArgs())),{});
 // After successful change the only next call is a read refresh.
 assert.equal(f.getListCalls(),2);
 assert.equal(f.elements.get("delegatesBox").hidden,false);
});

test("the page never automatically retries an unconfirmed mutation",async()=>{
 const f=load({listResult:validList,confirm:()=>true,changeResult:null});
 f.auth.currentUser={uid:"primary",emailVerified:true};
 await f.api.refresh();
 await f.api.apply(f.api.model.people[0]);
 assert.equal(f.getChangeCalls(),1);
 assert.equal(f.getListCalls(),2);
});

test("uses Firebase existing Auth only; no direct finance, Rules, impersonation or direct Firestore write",()=>{
 assert.match(html,/getAuth\(app\)/);
 assert.match(html,/onAuthStateChanged\(auth,user=>/);
 assert.match(html,/httpsCallable\(functions,"listHubOwnerDelegates"/);
 assert.match(html,/httpsCallable\(functions,"changeHubOwnerDelegate"/);
 assert.match(html,/window\.confirm\(message\)/);
 assert.match(html,/expectedVersion:m\.version/);
 assert.match(html,/textContent=String\(s\)/);
 assert.doesNotMatch(html,/\b(?:signInWith|createUserWith|deleteDoc|updateDoc|setDoc|writeBatch|runTransaction|setCustomUserClaims|localStorage|sessionStorage|eval)\s*\(/);
 assert.doesNotMatch(html,/httpsCallable\(functions,"(?:correctHubPartnerCounts|submitPartnerWorkspaceCounts|managePartnerWorkspace)"/);
 assert.match(html,/承認APIが有効化されるまでは操作できません/);
});
