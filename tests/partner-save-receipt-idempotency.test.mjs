import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const extract=(from,to)=>{
 const i=html.indexOf(from),j=html.indexOf(to,i);
 assert(i>=0&&j>i,"missing protected save source: "+from);
 return html.slice(i,j);
};
const identity=extract("function currentCountIdentity(){","// The server-verified count contract");
const handler=extract('$("save").onclick=()=>action(async()=>{','\nconst setLoginMode=code=>');
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const counts=(v)=>Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?v:0]));
const serverResponse=(v,version=2)=>({date:"2026-11-19",companyName:"協力店A",role:"owner",
 records:[{staffId:"A",counts:counts(v),version,privateCounts:{}}]});
function fixture({code=true,failFirstRead=false}={}){
 const auth={currentUser:code?null:{uid:"email-1",emailVerified:true}};
 const nodes={
  date:{value:"2026-11-19"},staffSelect:{value:"A"},save:{},
 };
 const calls={save:[],get:[]};
 let failRead=failFirstRead,received=null;
 const ctx=vm.createContext({
  KEYS,auth,activeCodeSession:code?"T".repeat(43):"",
  codeCountSessionEpoch:1,workspaceCompanyId:code?"":"partner-C",
  pendingPartnerSaveReceipts:new Map(),data:{
   date:"2026-11-19",companyName:"協力店A",
   records:[{staffId:"A",version:1,counts:counts(3),privateCounts:{}}]
  },
  $:id=>nodes[id],values:()=>counts(5),privateValues:()=>({}),
  save:async request=>{calls.save.push(request);return {data:{
   saved:true,date:request.date,staffId:request.staffId,version:2
  }}},
  get:async request=>{calls.get.push(request);if(failRead){failRead=false;throw Error("offline")}return {data:received||serverResponse(5)}},
  action:fn=>fn()
 });
 vm.runInContext(identity+handler,ctx);
 return {ctx,auth,calls,nodes,setRead:x=>{received=x},run:()=>vm.runInContext('$("save").onclick()',ctx)};
}
test("acknowledged write with failed read-back is NEVER silently retried",async()=>{
 const s=fixture({failFirstRead:true});
 await assert.rejects(s.run(),e=>e.code==="save/verification-pending");
 assert.equal(s.calls.save.length,1);
 assert.equal(s.calls.get.length,1);
 assert.equal(s.ctx.pendingPartnerSaveReceipts.size,1);
 const message=await s.run();
 assert.match(message,/前回の保存を確認/);
 assert.equal(s.calls.save.length,1);
 assert.equal(s.calls.get.length,2);
 assert.equal(s.ctx.pendingPartnerSaveReceipts.size,0);
});
test("normal committed write still passes exact read-back verification",async()=>{
 const s=fixture();
 const message=await s.run();
 assert.match(message,/保存・再取得照合が成功/);
 assert.equal(s.calls.save.length,1);
 assert.equal(s.calls.get.length,1);
 assert.equal(s.ctx.pendingPartnerSaveReceipts.size,0);
 assert.equal(s.ctx.data.records[0].version,1); // server data is never edited by client
});
test("older version cannot release pending receipt or create duplicate audit",async()=>{
 const s=fixture({failFirstRead:true});
 await assert.rejects(s.run());
 s.setRead(serverResponse(3,1));
 await assert.rejects(s.run(),e=>e.code==="save/verification-pending");
 assert.equal(s.calls.save.length,1);
 assert.equal(s.ctx.pendingPartnerSaveReceipts.size,1);
});
test("same version but changed counts reports discrepancy without a duplicate save",async()=>{
 const s=fixture({failFirstRead:true});
 await assert.rejects(s.run());
 s.setRead(serverResponse(4,2));
 await assert.rejects(s.run(),e=>e.code==="save/verified-different");
 assert.equal(s.calls.save.length,1);
 assert.equal(s.ctx.pendingPartnerSaveReceipts.size,0);
});
test("different company read-back cannot confirm another company's receipt",async()=>{
 const s=fixture({failFirstRead:true});
 await assert.rejects(s.run());
 s.setRead({...serverResponse(5),companyName:"協力店B"});
 await assert.rejects(s.run(),e=>e.code==="save/verification-pending");
 assert.equal(s.calls.save.length,1);
 assert.equal(s.ctx.pendingPartnerSaveReceipts.size,1);
});
test("receipt checker is identity and date scoped; read-only and no finance collection",()=>{
 assert.match(html,/pendingPartnerSaveReceipts\.clear\(\)/);
 assert.match(html,/reviewPendingPartnerSaves\(res\)/);
 assert.match(html,/save\/verification-pending/);
 assert.match(html,/const counts=values\(\),privateCounts=privateValues\(\),priorVersion=/);
 assert.doesNotMatch(identity+handler,/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|firebase deploy|revenueGoals|unitPrice|canViewRevenue)\b/);
});
