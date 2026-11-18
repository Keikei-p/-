import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {verifyPartnerOptionalTabData,createPartnerPublishedOptionalTabClient}
 from "../ranking/published-partner-optional-client.mjs";
const day="2026-11-18";
const base=(tab,extra)=>({
 schema:"nico-published-partner-optional-v1",tab,date:day,
 companyName:"協力店A",reportStatus:"報告済",
 totalCount:5,reportedStaffCount:1,...extra
});
const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const counts=n=>Object.fromEntries(keys.map((k,i)=>[k,i===0?n:0]));
const fixtures=[
 base("report",{lines:["協力店A｜2026-11-18 営業実績報告",
  "報告状況：報告済","総件数：5件","報告した担当者：1人","NURO：5件"]}),
 base("daily",{products:keys.map((name,i)=>({name,count:i===0?5:0}))}),
 base("history",{audits:[{staffId:"staff1",staffName:"担当A",version:2,
  totalCount:5,previousTotalCount:4,counts:counts(5),
  previousCounts:counts(4)}]}),
 base("goal",{actualCount:5})
];
test("four optional tab payloads have strict count-only responses",()=>{
 for(const item of fixtures){
  const before=structuredClone(item);
  const out=verifyPartnerOptionalTabData(item,{tab:item.tab,date:day});
  assert.deepEqual(out,item);
  assert.deepEqual(item,before);
  assert.equal(JSON.stringify(out).includes("unitPrice"),false);
  assert.equal(JSON.stringify(out).includes("CB"),false);
  assert.equal(JSON.stringify(out).includes("privateCounts"),false);
 }
});
test("each optional response rejects extra financial fields, wrong company or forged tab",()=>{
 for(const fixture of fixtures){
  for(const mutate of [
   x=>{x.revenue=9000;},x=>{x.companyName="協力店 売上5万円";},
   x=>{x.tab="other";},x=>{x.reportedStaffCount=-1;},
   x=>{x.totalCount=-1;},x=>{x.date="2026-02-30";}
  ]){
   const modified=structuredClone(fixture);mutate(modified);
   assert.throws(()=>verifyPartnerOptionalTabData(modified,{tab:fixture.tab,date:day}),
    /PARTNER_OPTIONAL_TAB_RESPONSE_UNVERIFIED/);
  }
 }
});
test("history cannot carry private original, audit emails, or forged count delta",()=>{
 const item=structuredClone(fixtures[2]);
 item.audits[0].privateCounts={p1:100};
 assert.throws(()=>verifyPartnerOptionalTabData(item,{tab:"history",date:day}));
 const wrong=structuredClone(fixtures[2]);
 wrong.audits[0].previousTotalCount=400;
 assert.throws(()=>verifyPartnerOptionalTabData(wrong,{tab:"history",date:day}));
});
test("member report and confirmed zero aren't confused with unreported",()=>{
 const zero={...base("daily",{products:keys.map(name=>({name,count:0}))}),
  reportStatus:"確定0件",totalCount:0,reportedStaffCount:1};
 assert.equal(verifyPartnerOptionalTabData(zero,{tab:"daily",date:day}).totalCount,0);
 const noReport={...zero,reportStatus:"未報告",reportedStaffCount:0};
 assert.equal(verifyPartnerOptionalTabData(noReport,{tab:"daily",date:day}).reportStatus,
  "未報告");
 const fake={...noReport,totalCount:1};
 assert.throws(()=>verifyPartnerOptionalTabData(fake,{tab:"daily",date:day}));
});
test("OFF gates refuse token lookup, callable, or data access",()=>{
 let calls=0;
 for(const [a,b] of [[false,false],[true,false],[false,true]]){
  assert.throws(()=>createPartnerPublishedOptionalTabClient({
   enabled:a,serverGuardVerified:b,auth:{currentUser:null},
   httpsCallable:()=>{calls++;return ()=>({})},
   getWorkspaceCompanyId:()=>""}),/PARTNER_OPTIONAL_TAB_RESPONSE_UNVERIFIED/);
 }
 assert.equal(calls,0);
});
test("one callable for exact requested authorized tab, verified session and company",async()=>{
 const auth={currentUser:{uid:"owner1",emailVerified:true}};
 let company="partner1",requests=[];
 const client=createPartnerPublishedOptionalTabClient({
  enabled:true,serverGuardVerified:true,auth,functions:{},
  httpsCallable:(_fn,name)=>async payload=>{
   requests.push({name,payload});
   return {data:fixtures.find(x=>x.tab===payload.tab)};
  },
  getWorkspaceCompanyId:()=>company
 });
 for(const fixture of fixtures){
  const out=await client.load({tab:fixture.tab,date:day});
  assert.equal(out.tab,fixture.tab);
 }
 assert.equal(requests.length,4);
 assert(requests.every(r=>r.name==="getPartnerPublishedOptionalTab"));
 assert(requests.every(r=>r.payload.workspaceCompanyId==="partner1"));
 assert(requests.every(r=>Object.keys(r.payload).sort().join("|")===
  "date|tab|workspaceCompanyId"));
 const reject=()=>client.load({tab:"history",date:"2026-02-30"});
 await assert.rejects(reject,/PARTNER_OPTIONAL_TAB_RESPONSE_UNVERIFIED/);
 assert.equal(requests.length,4);
});
test("auth or workspace switch midflight cannot display stale history",async()=>{
 const auth={currentUser:{uid:"owner1",emailVerified:true}};
 let company="partner1",resolve;
 const pending=new Promise(done=>{resolve=done});
 const client=createPartnerPublishedOptionalTabClient({
  enabled:true,serverGuardVerified:true,auth,functions:{},
  httpsCallable:()=>async()=>pending,
  getWorkspaceCompanyId:()=>company
 });
 const first=client.load({tab:"history",date:day});
 company="partner2";resolve({data:fixtures[2]});
 await assert.rejects(first,/PARTNER_OPTIONAL_TAB_RESPONSE_UNVERIFIED/);
});
test("existing same-screen input and financial source remain untouched, tab UI gate stays OFF",()=>{
 const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
 assert(html.includes('const NICO_PARTNER_TAB_UI_ENABLED = false;'));
 assert(html.includes('const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;'));
 assert(html.includes('if(partnerOptionalPublicationProtectionActive()){'));
 assert(html.includes('loadPartnerPublishedOptionalPanel(name)'));
 assert(html.includes('"./ranking/published-partner-optional-client.mjs"'));
 assert(html.includes('const readPartnerWorkDay = httpsCallable(partnerCountFunctions,"getPartnerWorkspace");'));
 assert(html.includes('const partnerInlineSave = httpsCallable(partnerCountFunctions,"submitPartnerWorkspaceCounts");'));
});
