"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
class Node{
 constructor(tag="div"){
  Object.assign(this,{tag,children:[],parent:null,style:{},dataset:{},attributes:{},
   id:"",isConnected:true,disabled:false,hidden:false,textContent:"",listeners:{}});
 }
 get value(){return this._value??(this.tag==="select"?this.options[0]?.value:"")??"";}
 set value(x){this._value=String(x);}
 get options(){return this.children.filter(x=>x.tag==="option");}
 setAttribute(k,v){this.attributes[k]=String(v);}
 addEventListener(k,fn){this.listeners[k]=fn;this["on"+k]=fn;}
 append(...nodes){for(const node of nodes){node.parent=this;node.isConnected=true;this.children.push(node);}}
 replaceChildren(...nodes){for(const node of this.children){node.parent=null;node.isConnected=false;}
  this.children=[];this._value=undefined;this.append(...nodes);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);
  this.parent=null;this.isConnected=false;}
 descendants(){return this.children.flatMap(x=>[x,...x.descendants()]);}
 querySelector(s){return this.descendants().find(x=>s==="#"+x.id)||null;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let n=0;n<8;n++)await tick();};
async function fixture({released=false,archived=false,badReadback=false,wrongCompany=false,moduleFailure=false}={}){
 const module=await import("../staging/partner-owner-correction-v3/mobile-bootstrap.mjs");
 const html=fs.readFileSync("index.html","utf8");
 const start=html.indexOf("const NICO_SAME_APP_OWNER_CORRECTION_V3_RELEASED=false;");
 const end=html.indexOf("// Original internal owner sees existing teams PLUS",start);
 assert(start>0&&end>start);
 let code=html.slice(start,end).replace('import("./staging/partner-owner-correction-v3/mobile-bootstrap.mjs")',"loadV3Module()");
 if(released)code=code.replace("NICO_SAME_APP_OWNER_CORRECTION_V3_RELEASED=false", "NICO_SAME_APP_OWNER_CORRECTION_V3_RELEASED=true");
 const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const state={date:"2026-10-31",version:1,
  counts:Object.fromEntries(keys.map(k=>[k,k==="NURO"?2:k==="SB光・AIR"?3:0])),
  sbBreakdown:{"SB光":0,"SB AIR":0,"旧未分類":3}};
 const company={partnerCompanyId:"partner",name:"協力店A",active:true};
 const parent=new Node("section"),calls=[],writes=[],events=new Set();
 const owner={uid:"hub_owner",email:"owner@example.test",emailVerified:true,
  getIdTokenResult:async()=>({claims:{email:"owner@example.test",email_verified:true}})};
 const auth={currentUser:owner};
 const listing=()=>({role:"hub",scope:"existing-partner-counts-only",date:state.date,
  partnerCompanyId:wrongCompany?"foreign":"partner",containsFinance:false,
  sbBreakdownSchema:"sb-separated-v1",entries:[{
   staffId:"staff",staffName:archived?"過去の担当者":"担当者",teamIdSnapshot:"old_team",
   counts:{...state.counts,...(badReadback&&writes.length?{NURO:99}:{})},
   totalCount:badReadback&&writes.length?102:Object.values(state.counts).reduce((a,b)=>a+b,0),
   version:state.version,sbBreakdown:{...state.sbBreakdown}}]});
 const sandbox={document:{createElement:t=>new Node(t)},auth,currentCompanyData:{companyKind:"internal"},
  isCurrentCompanyOwner:()=>true,partnerMainValidId:x=>/^[A-Za-z0-9_-]{1,128}$/.test(x),
  partnerMainDate:()=>state.date,partnerCountFunctions:{},loadV3Module:async()=>{
   if(moduleFailure)throw Error("candidate_assets_not_published");return module;
  },
  window:{confirm:()=>true},
  partnerRankingDailyCache:new Map([["old",{}]]),partnerRankingState:{rows:["old"]},
  resetSameAppJointMonth:()=>calls.push({kind:"rank-reset"}),mountSameAppJointMonth:async()=>{},
  onAuthStateChanged:(_auth,callback)=>{events.add(callback);callback(auth.currentUser);return()=>events.delete(callback);},
  readPartnerWorkDay:async input=>{calls.push({kind:"workspace",input});return {data:{
   role:"hub",date:input.date,categories:keys,partners:[],ownerCorrectionAvailable:true,
   registeredCompanies:[{...company,teams:[]}]}};},
  partnerInlineSave:async()=>{throw Error("OWNER_MUST_NOT_USE_PARTNER_SAVE");},
  httpsCallable:(_functions,name)=>{
   assert(["listHubPartnerCounts","correctHubPartnerCounts"].includes(name));
   return async input=>{
    calls.push({kind:name,input});
    if(name==="listHubPartnerCounts")return {data:listing()};
    writes.push(input);state.version++;state.counts={...input.counts};state.sbBreakdown={...input.sbBreakdown};
    return {data:{saved:true,scope:"hub-owner-existing-only",partnerCompanyId:"partner",
     staffId:input.staffId,date:input.date,version:state.version,
     totalCount:Object.values(state.counts).reduce((a,b)=>a+b,0),containsFinance:false}};
   };
  }
 };
 vm.runInNewContext(code,sandbox,{timeout:1000});
 sandbox.openOwnerPartnerCountEditor(parent,company);
 await settle();
 const all=()=>parent.descendants();
 const field=key=>all().find(x=>x.tag==="input"&&x.attributes["aria-label"]===key+"の件数");
 return {sandbox,parent,state,calls,writes,all,field,
  reason:()=>all().find(x=>x.tag==="textarea"),
  save:()=>all().find(x=>x.tag==="button"&&["変更内容を確認して保存","件数訂正は停止中"].includes(x.textContent)),
  notifyAuth(user){auth.currentUser=user;for(const callback of [...events])callback(user);}};
}
test("default Owner dashboard reuses v3 list and displays correction stopped without any writes",async()=>{
 const f=await fixture();
 assert.equal(f.calls.filter(x=>x.kind==="listHubPartnerCounts").length,1);
 assert(f.field("NURO"));assert.equal(f.field("NURO").disabled,true);
 assert.equal(f.save().disabled,true);await f.save().onclick();await settle();
 assert.equal(f.writes.length,0);
 assert(f.all().some(x=>x.textContent.includes("訂正機能は停止中")));
 assert(fs.readFileSync("index.html","utf8").includes("const NICO_SAME_APP_OWNER_CORRECTION_V3_RELEASED=false;"));
});
test("unpublished v3 UI assets are reported separately from API or Owner permission failure",async()=>{
 const f=await fixture({moduleFailure:true});
 assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
 assert.equal(f.save(),undefined);
 assert(f.all().some(x=>x.textContent.includes("画面のファイルを読み込めません")));
 assert(!f.all().some(x=>x.textContent.includes("既存の件数訂正APIを使用できません")));
 const index=fs.readFileSync("index.html","utf8");
 assert(index.includes('import("./staging/partner-owner-correction-v3/mobile-bootstrap.mjs")'));
 const bootstrap=fs.readFileSync("staging/partner-owner-correction-v3/mobile-bootstrap.mjs","utf8");
 assert(bootstrap.includes('from "./owner-client.mjs"'));
 assert(bootstrap.includes('from "./owner-ui.mjs"'));
});
test("reviewed future release uses existing v3 reason and SB contract then GET readback and company refresh",async()=>{
 const f=await fixture({released:true});
 f.field("NURO").value="5";f.field("SB光").value="2";
 f.field("SB AIR").value="1";f.field("旧未分類").value="0";
 f.reason().value="担当者に確認した光とAIRの件数を訂正";
 await f.save().onclick();await settle();
 assert.equal(f.writes.length,1,JSON.stringify(f.all().filter(x=>x.tag==="p").map(x=>x.textContent)));
 assert.equal(f.writes[0].expectedVersion,1);
 assert.equal(f.writes[0].partnerCompanyId,"partner");assert.equal(f.writes[0].counts.NURO,5);
 assert.deepEqual(f.writes[0].sbBreakdown,{"SB光":2,"SB AIR":1,"旧未分類":0});
 assert.equal(f.calls.filter(x=>x.kind==="listHubPartnerCounts").length,2);
 assert.equal(f.calls.filter(x=>x.kind==="workspace").length,2);
 assert.equal(f.sandbox.partnerRankingDailyCache.size,0);
 assert(f.all().some(x=>x.textContent.includes("保存・再照合完了：第2版")));
});
test("invalid quantities and absent or concealed-money reasons never call the Owner writer",async()=>{
 const f=await fixture({released:true});
 f.field("NURO").value="-10";f.reason().value="担当者に確認して件数を訂正";
 await f.save().onclick();await settle();assert.equal(f.writes.length,0);
 f.field("NURO").value="5";f.reason().value="";
 await f.save().onclick();await settle();assert.equal(f.writes.length,0);
 f.reason().value="担当者 ＣＢ５０００ を確認";
 await f.save().onclick();await settle();assert.equal(f.writes.length,0);
});
test("account switch disposes the Owner panel and never invokes the existing writer",async()=>{
 const f=await fixture({released:true}),save=f.save();
 f.notifyAuth({uid:"another_owner",emailVerified:true});
 await save.onclick();assert.equal(f.writes.length,0);
 assert.equal(f.parent.querySelector("#ownerPartnerCorrectionPanel"),null);
});
test("wrong-company list is rejected before any count form or write appears",async()=>{
 const f=await fixture({released:true,wrongCompany:true});
 assert.equal(f.field("NURO").parent.parent.parent.hidden,true);
 assert.equal(f.writes.length,0);
 assert(f.all().some(x=>x.textContent.includes("失敗")));
});
test("uncertain readback never advertises success or retries the Owner correction",async()=>{
 const f=await fixture({released:true,badReadback:true});
 f.field("NURO").value="5";f.reason().value="担当者に確認したNUROの件数を訂正";
 await f.save().onclick();await settle();assert.equal(f.writes.length,1);
 assert(f.all().some(x=>x.textContent.includes("二重登録防止")));
 assert(!f.all().some(x=>x.textContent.includes("保存・再照合完了")));
 assert.equal(f.calls.filter(x=>x.kind==="rank-reset").length,0);
});
test("existing archived staff count stays selectable without any roster or account mutation",async()=>{
 const f=await fixture({released:true,archived:true});
 f.field("NURO").value="6";f.reason().value="過去の担当者に確認して件数を訂正";
 await f.save().onclick();await settle();assert.equal(f.writes.length,1);
 assert.equal(f.writes[0].staffId,"staff");assert.equal(f.state.version,2);
 assert(f.calls.every(x=>!["managePartnerWorkspace","submitPartnerWorkspaceCounts"].includes(x.kind)));
});
