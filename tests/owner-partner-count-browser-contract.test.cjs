"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

class Node{
 constructor(tag="div"){
  this.tag=tag;this.children=[];this.parent=null;this.style={};
  this.dataset={};this.attributes={};this.id="";this._value=undefined;
  this.isConnected=true;this.disabled=false;this.hidden=false;
  this.textContent="";this.onclick=null;this.onchange=null;
 }
 get value(){
  if(this.tag==="select"&&this._value===undefined)return this.options[0]?.value||"";
  return this._value??"";
 }
 set value(next){this._value=String(next);}
 get options(){return this.tag==="select"?this.children.filter(x=>x.tag==="option"):[];}
 setAttribute(key,value){this.attributes[key]=String(value);}
 append(...children){
  for(const child of children){
   child.parent=this;child.isConnected=true;this.children.push(child);
  }
 }
 replaceChildren(...children){
  for(const child of this.children){child.parent=null;child.isConnected=false;}
  this.children=[];if(this.tag==="select")this._value=undefined;
  this.append(...children);
 }
 remove(){
  if(this.parent){
   this.parent.children=this.parent.children.filter(child=>child!==this);
   this.parent=null;
  }
  this.isConnected=false;
 }
 descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){
  const all=this.descendants();
  if(selector.startsWith("#"))return all.filter(x=>x.id===selector.slice(1));
  if(selector==="input[data-count-key]")
   return all.filter(x=>x.tag==="input"&&typeof x.dataset.countKey==="string");
  throw Error("Unexpected query: "+selector);
 }
}
function loadOwnerEditor(){
 const html=fs.readFileSync("index.html","utf8");
 const start=html.indexOf("let ownerPartnerCorrectionNonce=0;");
 const end=html.indexOf("// Original internal owner sees existing teams PLUS",start);
 assert(start>0&&end>start,"owner count editor exists in original app");
 const code=html.slice(start,end);
 const parent=new Node("section"),calls=[],writes=[];
 const state={date:"2026-10-31",counts:{
  NURO:2,SBMNP:0,YMMNP:0,"YM純新規":0,"SB光・AIR":0,
  "ウォーター":0,"つばさ・HTB":0,"太陽光・蓄電池AP":0,"U-NEXT":0
 },version:1};
 const names=Object.keys(state.counts);
 const company={partnerCompanyId:"partner",name:"協力店A",active:true};
 const auth={currentUser:{uid:"hub-owner"}};
 const sandbox={
  document:{createElement:tag=>new Node(tag)},
  auth,currentCompanyData:{companyKind:"internal"},
  isCurrentCompanyOwner:()=>true,
  partnerMainDate:()=>state.date,
  readPartnerWorkDay:async payload=>{
   calls.push(payload);
   return {data:{role:"hub",ownerCorrectionAvailable:true,
    ownerCorrectionEntries:{
     partnerCompanyId:"partner",companyName:"協力店A",date:payload.date,
     categories:names,enabledCategories:["NURO"],
     staff:[{id:"staff",name:"担当者",active:true}],
     records:[{staffId:"staff",counts:{...state.counts},
      totalCount:state.counts.NURO,version:state.version}]
    }}};
  },
  partnerInlineSave:async payload=>{
   writes.push(payload);
   state.counts={...payload.counts};state.version++;
   return {data:{saved:true,version:state.version}};
  }
 };
 vm.runInNewContext(code,sandbox,{timeout:1000});
 return {sandbox,parent,calls,writes,company,state};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("hub Owner editor reads authorized partner counts and saves only current ON category",async()=>{
 const {sandbox,parent,company,calls,writes}=loadOwnerEditor();
 sandbox.openOwnerPartnerCountEditor(parent,company);
 await tick();
 assert.equal(calls.length,1);
 assert.equal(calls[0].includeOwnerCorrectionEntries,true);
 assert.equal(calls[0].partnerCompanyId,"partner");
 const panel=parent.querySelector("#ownerPartnerCorrectionPanel");
 assert(panel);
 const inputs=panel.querySelectorAll("input[data-count-key]");
 assert.equal(inputs.length,1,"OFF categories must not be shown as editable inputs");
 assert.equal(inputs[0].dataset.countKey,"NURO");
 inputs[0].value="5";
 const save=panel.descendants().find(x=>x.tag==="button"&&x.textContent==="件数を保存・訂正");
 assert(save);
 assert.equal(save.disabled,false);
 await save.onclick();
 assert.equal(writes.length,1);
 assert.equal(writes[0].ownerPartnerCompanyId,"partner");
 assert.equal(writes[0].expectedVersion,1);
 assert.equal(writes[0].counts.NURO,5);
 assert.equal(writes[0].counts.SBMNP,0);
 assert.equal(Object.keys(writes[0].counts).length,9);
 assert.equal(calls.length,2,"read-after-write verification is mandatory");
 assert.equal(panel.descendants().some(x=>x.textContent.includes("保存・再取得照合が成功")),true);
});
test("invalid owner count is rejected before a remote write",async()=>{
 const {sandbox,parent,company,writes}=loadOwnerEditor();
 sandbox.openOwnerPartnerCountEditor(parent,company);
 await tick();
 const panel=parent.querySelector("#ownerPartnerCorrectionPanel");
 const input=panel.querySelectorAll("input[data-count-key]")[0];
 const save=panel.descendants().find(x=>x.textContent==="件数を保存・訂正");
 input.value="-10";
 await save.onclick();
 assert.equal(writes.length,0);
 assert.equal(panel.descendants().some(x=>x.textContent.includes("0〜9999")),true);
});
test("original app exposes correction controls only when Owner flag is present",()=>{
 const src=fs.readFileSync("index.html","utf8");
 assert.match(src,/result\.ownerCorrectionAvailable===true&&company\.active===true/);
 assert.match(src,/includeOwnerCorrectionEntries:true/);
 assert.match(src,/ownerPartnerCompanyId:company\.partnerCompanyId/);
 assert.match(src,/saved\?\.version!==response\.version/);
 assert(!src.includes("ownerCorrectionEnabled=true"),
  "browser must not turn a server release flag on");
});

test("owner editor refuses save after Firebase identity changes",async()=>{
 const {sandbox,parent,company,writes}=loadOwnerEditor();
 sandbox.openOwnerPartnerCountEditor(parent,company);
 await tick();
 const panel=parent.querySelector("#ownerPartnerCorrectionPanel");
 assert(panel);
 const save=panel.descendants().find(x=>
  x.tag==="button"&&x.textContent==="件数を保存・訂正");
 assert.equal(save?.disabled,false,"current verified Owner may edit existing count");
 sandbox.auth.currentUser={uid:"second-owner"};
 await save.onclick();
 assert.equal(writes.length,0,
  "old Owner's count editor must not submit under a different signed-in identity");
});

test("stale Owner editor does not fetch or display partner data after login switch",async()=>{
 const {sandbox,parent,company,calls,writes}=loadOwnerEditor();
 sandbox.openOwnerPartnerCountEditor(parent,company);
 await tick();
 const panel=parent.querySelector("#ownerPartnerCorrectionPanel");
 const reload=panel.descendants().find(x=>x.tag==="button"&&x.textContent==="読み直す");
 assert(reload);
 assert.equal(calls.length,1);
 sandbox.auth.currentUser={uid:"another-owner"};
 reload.onclick();
 await tick();
 assert.equal(calls.length,1,"account switch may not trigger a stale partner read");
 const save=panel.descendants().find(x=>x.textContent==="件数を保存・訂正");
 await save.onclick();
 assert.equal(writes.length,0);
});
