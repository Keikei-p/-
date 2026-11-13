import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 countOnlyRegisteredCompanies,mountVerifiedOwnerCorrection
} from "../staging/partner-owner-correction-v3/mobile-bootstrap.mjs";
import {COUNT_KEYS,SB_PARTS} from "../staging/partner-owner-correction-v3/owner-ui.mjs";

const date="2026-10-31",cid="partner";
const zero=()=>Object.fromEntries(COUNT_KEYS.map(k=>[k,0]));
const counts=()=>({...zero(),NURO:1,"SB光・AIR":5});
const split=()=>({"SB光":0,"SB AIR":0,"旧未分類":5});
const row=()=>({
 staffId:"s1",staffName:"担当者A",teamIdSnapshot:"team1",
 counts:counts(),totalCount:6,version:2,sbBreakdown:split()
});
const companies=()=>[
 {partnerCompanyId:cid,name:"協力店A",active:true,teams:[{id:"t1",name:"班A"}]},
 {partnerCompanyId:"inactive",name:"協力店B",active:false,teams:[]}
];
const workspace=()=>({
 role:"hub",date,registeredCompanies:companies(),
 partners:[],categories:COUNT_KEYS,sbBreakdownSchema:"sb-separated-v1"
});
const listing=()=>({
 role:"hub",scope:"existing-partner-counts-only",date,
 partnerCompanyId:cid,entries:[row()],containsFinance:false,
 sbBreakdownSchema:"sb-separated-v1"
});
class FakeElement{
 constructor(tag){this.tag=tag;this.children=[];this.value="";
  this.style={};this.hidden=false;this.disabled=false;
  this.listeners={};this.attrs={};this.textContent="";}
 append(...items){
  this.children.push(...items);
  if(this.tag==="select"&&this.value===""&&items.some(x=>x.tag==="option")){
   this.value=items.find(x=>x.tag==="option").value;
  }
 }
 replaceChildren(...items){this.children=[];this.value="";this.append(...items);}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(k,fn){this.listeners[k]=fn;}
}
const dom={createElement:tag=>new FakeElement(tag)};
function fixture({hub=workspace,enabled=()=>true}={}){
 const owner={uid:"owner",email:"owner@example.com",emailVerified:true,
  getIdTokenResult:async()=>({claims:{
   email:"owner@example.com",email_verified:true
  }})};
 const auth={currentUser:owner},root=new FakeElement("main");
 const authEvents={listener:null,unsubscribed:0};
 const seen={workspace:[],list:[],correct:[],invalidation:[]};
 let latest=listing();
 const fn={
  root,auth,dom,enabled,dateGetter:()=>date,confirmChange:()=>true,
  subscribeAuth:callback=>{
   authEvents.listener=callback;
   callback(auth.currentUser);
   return ()=>{authEvents.unsubscribed++;authEvents.listener=null};
  },
  invalidateRanking:async receipt=>{seen.invalidation.push(receipt)},
  workspaceCallable:async req=>{
   seen.workspace.push(req);return {data:await hub(req)}
  },
  listCallable:async req=>{
   seen.list.push(req);return {data:latest}
  },
  correctCallable:async req=>{
   seen.correct.push(req);
   const newVersion=req.expectedVersion+1;
   latest={...listing(),entries:[{
    ...row(),version:newVersion,counts:req.counts,
    totalCount:Object.values(req.counts).reduce((a,b)=>a+b,0),
    sbBreakdown:req.sbBreakdown
   }]};
   return {data:{
    saved:true,scope:"hub-owner-existing-only",
    partnerCompanyId:cid,staffId:req.staffId,date:req.date,
    version:newVersion,totalCount:latest.entries[0].totalCount,
    containsFinance:false
   }};
  }
 };
 return {owner,auth,root,seen,fn,authEvents,
  notifyAuth(user){
   auth.currentUser=user;
   authEvents.listener?.(user);
  }
 };
}
test("approved hub company discovery returns only active-visible count-only labels",()=>{
 assert.deepEqual(countOnlyRegisteredCompanies(workspace(),date),[
  {partnerCompanyId:cid,name:"協力店A",active:true},
  {partnerCompanyId:"inactive",name:"協力店B",active:false}
 ]);
});

test("current workspace readiness hint never grants correction access; disabled writer remains read-only",async()=>{
 const data={...workspace(),ownerCorrectionAvailable:true};
 assert.equal(countOnlyRegisteredCompanies(data,date).length,2);
 assert.throws(()=>countOnlyRegisteredCompanies({...data,ownerCorrectionAvailable:"enabled"},date));
 for(const name of ["協力店 ＣＢ５０００","会社 ＲＥＶＥＮＵＥ８０００","会社 ２万円"]){
  assert.throws(()=>countOnlyRegisteredCompanies({...workspace(),
   registeredCompanies:[{...companies()[0],name}]},date));
 }
 const f=fixture({hub:()=>data});f.fn.canCorrect=()=>false;
 const panel=await mountVerifiedOwnerCorrection(f.fn);
 panel.selectCompany(cid);await new Promise(resolve=>setImmediate(resolve));
 await panel.save();
 assert.equal(f.seen.list.length,1);
 assert.equal(f.seen.correct.length,0);
 const editor=f.root.children[0].children[5];
 assert.equal(editor.children[7].disabled,true);
 assert.equal(editor.children[6].disabled,true);
 assert.match(f.root.children[0].children[6].textContent,/訂正機能は停止中/);
 panel.destroy();
});
test("one mobile screen: hub discovery -> company -> staff -> save -> backend version readback",async()=>{
 const f=fixture();
 const panel=await mountVerifiedOwnerCorrection(f.fn);
 assert.deepEqual(f.seen.workspace,[{date}]);
 assert.equal(panel.companies.length,2);
 const wrap=f.root.children[0];
 assert.equal(wrap.children[0].textContent,"協力店の件数を訂正（自社オーナー専用）");
 const company=wrap.children[3],editor=wrap.children[5],status=wrap.children[6];
 assert.equal(company.children.length,2,"inactive company is not offered as editable");
 company.value=cid;
 await panel.load();
 assert.deepEqual(f.seen.list,[{date,partnerCompanyId:cid}]);
 assert.equal(editor.hidden,false);
 assert.equal(editor.children[1].value,"s1");
 const field=editor.children[2].children.find(x=>x.textContent==="NURO");
 field.children[0].value="3";
 editor.children[6].value="確認済みの契約内容の件数訂正";
 await panel.save();
 assert.equal(f.seen.correct.length,1);
 const req=f.seen.correct[0];
 assert.deepEqual(Object.keys(req).sort(),[
  "date","partnerCompanyId","staffId","expectedVersion",
  "counts","sbBreakdown","correctionReason"
 ].sort());
 assert.equal(req.counts.NURO,3);
 assert.equal(req.expectedVersion,2);
 assert.equal(f.seen.list.length,2);
 assert.deepEqual(f.seen.invalidation,[{
  date,month:"2026-10",partnerCompanyId:cid,version:3
 }]);
 assert.match(status.textContent,/保存・再照合完了：第3版/);
 assert.doesNotMatch(JSON.stringify(f.seen),/privateCounts|totalRevenue|unitPrice|cashback/i);
 panel.destroy();
 assert.equal(f.root.children.length,0);
 await panel.load();
 assert.equal(f.seen.list.length,2,"destroyed screen makes no additional requests");
});
test("fails closed on another role, invalid company, duplicate company, leaked finance or untrusted root key",()=>{
 const valid=workspace();
 const invalid=[
  {...valid,role:"partner"},
  {...valid,date:"2026-11-01"},
  {...valid,revenue:100000},
  {...valid,registeredCompanies:[{...companies()[0],unitPrice:1000}]},
  {...valid,registeredCompanies:[{...companies()[0],name:"売上100円"}]},
  {...valid,registeredCompanies:[companies()[0],companies()[0]]},
  {...valid,registeredCompanies:[{...companies()[0],teams:[{id:"t1",name:"班A",revenue:1}]}]},
  {...valid,registeredCompanies:[{...companies()[0],active:"true"}]},
  {...valid,registeredCompanies:Array.from({length:101},(_,i)=>({
   partnerCompanyId:"p"+i,name:"協力店"+i,active:true,teams:[]
  }))},
  {...valid,registeredCompanies:null}
 ];
 for(const sample of invalid)
  assert.throws(()=>countOnlyRegisteredCompanies(sample,date),
   /OWNER_CORRECTION_BOOT_/);
});
test("disabled, logged out, wrong role or malformed workspace never opens editor or sends a count write",async()=>{
 const cases=[
  fixture({enabled:()=>false}),
  fixture({hub:()=>({...workspace(),role:"partner"})}),
  fixture({hub:()=>({...workspace(),registeredCompanies:[
   {...companies()[0],totalRevenue:20000}
  ]})})
 ];
 cases.push(fixture());
 cases.at(-1).auth.currentUser=null;
 for(const f of cases){
  await assert.rejects(mountVerifiedOwnerCorrection(f.fn),
   /OWNER_CORRECTION_BOOT_/);
  assert.equal(f.root.children.length,0);
  assert.equal(f.seen.correct.length,0);
 }
 assert.equal(cases[0].seen.workspace.length,0);
});
test("account change or date change during discovery discards old company list",async()=>{
 for(const mode of ["user","date","disabled"]){
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  let currentDate=date,isEnabled=true;
  const f=fixture({hub:()=>pending});
  f.fn.dateGetter=()=>currentDate;
  f.fn.enabled=()=>isEnabled;
  const ongoing=mountVerifiedOwnerCorrection(f.fn);
  while(f.seen.workspace.length===0)await Promise.resolve();
  if(mode==="user")f.auth.currentUser={...f.owner};
  if(mode==="date")currentDate="2026-11-01";
  if(mode==="disabled")isEnabled=false;
  release(workspace());
  await assert.rejects(ongoing,/OWNER_CORRECTION_BOOT_STALE_SESSION/);
  assert.equal(f.root.children.length,0);
  assert.equal(f.seen.list.length,0);
  assert.equal(f.seen.correct.length,0);
 }
});
test("discovery failure hides errors and does not send a correction",async()=>{
 const f=fixture({hub:()=>{throw Error("private access token")}});
 await assert.rejects(mountVerifiedOwnerCorrection(f.fn),err=>
  err.message==="OWNER_CORRECTION_BOOT_DISCOVERY_UNAVAILABLE");
 assert.equal(f.root.children.length,0);
 assert.equal(f.seen.correct.length,0);
});
test("logout clears already displayed count data immediately and disposes requests",async()=>{
 const f=fixture(),panel=await mountVerifiedOwnerCorrection(f.fn);
 const company=f.root.children[0].children[3];
 company.value=cid;
 await panel.load();
 assert.equal(f.root.children.length,1);
 assert.equal(f.seen.list.length,1);
 f.notifyAuth(null);
 assert.equal(f.root.children.length,0,"old owner counts must disappear on sign-out");
 assert.equal(f.authEvents.unsubscribed,1);
 await panel.load();
 assert.equal(f.seen.list.length,1,"disposed panel cannot reload");
 panel.destroy();
 assert.equal(f.authEvents.unsubscribed,1,"only one unsubscribe");
});

test("switching to another signed-in user clears the previous owner panel",async()=>{
 const f=fixture(),panel=await mountVerifiedOwnerCorrection(f.fn);
 f.root.children[0].children[3].value=cid;
 await panel.load();
 f.notifyAuth({...f.owner,uid:"other"});
 assert.equal(f.root.children.length,0);
 assert.equal(f.authEvents.unsubscribed,1);
 await panel.save();
 assert.equal(f.seen.correct.length,0);
});
test("loss of email verification or feature switch clears mounted counts",async()=>{
 for(const mode of ["unverified","disabled"]){
  let flag=true;
  const f=fixture({enabled:()=>flag});
  const panel=await mountVerifiedOwnerCorrection(f.fn);
  f.root.children[0].children[3].value=cid;
  await panel.load();
  if(mode==="disabled")flag=false;
  f.notifyAuth(mode==="unverified"?{...f.owner,emailVerified:false}:f.owner);
  assert.equal(f.root.children.length,0,mode);
  assert.equal(f.authEvents.unsubscribed,1,mode);
  panel.destroy();
 }
});
test("auth listener unavailable, throws, or sync logout rejects and empties panel",async()=>{
 for(const mode of ["throws","missing","sync-logout"]){
  const f=fixture();
  f.fn.subscribeAuth=mode==="throws"?()=>{throw Error("auth-provider-internal-secret")}:
   mode==="missing"?()=>undefined:
   callback=>{callback(null);return ()=>{f.authEvents.unsubscribed++}};
  await assert.rejects(mountVerifiedOwnerCorrection(f.fn),err=>
   err.message==="OWNER_CORRECTION_BOOT_AUTH_LISTENER_UNVERIFIED");
  assert.equal(f.root.children.length,0,mode);
  assert.equal(f.seen.correct.length,0);
 }
});

test("identity switching before listener registration never leaves counts displayed",async()=>{
 const f=fixture();
 let unsubscribed=0;
 f.fn.subscribeAuth=()=>{f.auth.currentUser={...f.owner,uid:"other"};
  return ()=>{unsubscribed++}};
 await assert.rejects(mountVerifiedOwnerCorrection(f.fn),
  /OWNER_CORRECTION_BOOT_STALE_SESSION/);
 assert.equal(f.root.children.length,0);
 assert.equal(unsubscribed,1);
 assert.equal(f.seen.correct.length,0);
});

test("ranking invalidation callback failure does not re-submit successful correction",async()=>{
 const f=fixture();
 f.fn.invalidateRanking=async()=>{throw Error("stale ranking")};
 const panel=await mountVerifiedOwnerCorrection(f.fn);
 f.root.children[0].children[3].value=cid;
 await panel.load();
 const wrap=f.root.children[0],editor=wrap.children[5],status=wrap.children[6];
 editor.children[2].children.find(x=>x.textContent==="NURO").children[0].value="3";
 editor.children[6].value="確認済みの契約内容を修正しました";
 await panel.save();
 assert.equal(f.seen.correct.length,1);
 assert.equal(f.seen.list.length,2);
 assert.match(status.textContent,/保存・再照合完了：第3版/);
 assert.match(status.textContent,/ランキングは未更新/);
 assert.doesNotMatch(status.textContent,/二重登録防止/);
 panel.destroy();
});
test("no ranking invalidation without a verified write/readback",async()=>{
 const f=fixture(),panel=await mountVerifiedOwnerCorrection(f.fn);
 f.root.children[0].children[3].value=cid;
 await panel.load();
 await panel.save();
 assert.equal(f.seen.correct.length,0);
 assert.deepEqual(f.seen.invalidation,[]);
 panel.destroy();
});
test("ranking invalidation cannot be omitted on integrated bootstrap",async()=>{
 const f=fixture();
 delete f.fn.invalidateRanking;
 await assert.rejects(mountVerifiedOwnerCorrection(f.fn),
  /OWNER_CORRECTION_BOOT_DEPENDENCIES/);
 assert.equal(f.root.children.length,0);
 assert.equal(f.seen.workspace.length,0);
});
test("staged code contains no Firebase initialization, Firestore reads or credential storage",()=>{
 const source=readFileSync(new URL("../staging/partner-owner-correction-v3/mobile-bootstrap.mjs",import.meta.url),"utf8");
 assert.match(source,/STAGING ONLY \/ NO DEPLOY/);
 assert.doesNotMatch(source,/firebase deploy|localStorage|sessionStorage|document\.cookie/);
 assert.doesNotMatch(source,/getFirestore|deleteDoc\(|updateDoc\(|setDoc\(/);
 assert.doesNotMatch(source,/console\.|getAuth\(|httpsCallable\(|functions\.net/);
});

test("owner can switch company using one action in the same verified Auth session",async()=>{
 const f=fixture(),panel=await mountVerifiedOwnerCorrection(f.fn);
 assert.equal(typeof panel.selectCompany,"function");
 assert.equal(panel.selectCompany("inactive"),false);
 assert.equal(f.seen.list.length,0);
 assert.equal(panel.selectCompany(cid),true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.seen.list,[{date,partnerCompanyId:cid}]);
 assert.equal(f.seen.correct.length,0);
 f.notifyAuth(null);
 assert.equal(panel.selectCompany(cid),false);
 assert.equal(f.seen.list.length,1,"no stale requests after sign-out");
});
