import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeOwnerCorrectionClient} from "../staging/partner-owner-correction-v3/owner-client.mjs";
import {
 COUNT_KEYS,correctionPayload,verifyCorrectionReadback
} from "../staging/partner-owner-correction-v3/owner-ui.mjs";
const date="2026-10-31",company="partner";
const ZERO=()=>Object.fromEntries(COUNT_KEYS.map(x=>[x,0]));
const counts=()=>({...ZERO(),NURO:1,"SB光・AIR":5});
const split=()=>({"SB光":0,"SB AIR":0,"旧未分類":5});
const rows=()=>[{
 staffId:"s1",staffName:"担当者A",teamIdSnapshot:"t1",
 version:2,counts:counts(),totalCount:6,sbBreakdown:split()
}];
const listValue=()=>({
 role:"hub",scope:"existing-partner-counts-only",date,
 partnerCompanyId:company,entries:rows(),
 sbBreakdownSchema:"sb-separated-v1",containsFinance:false
});
const writeReq=()=>({
 date,partnerCompanyId:company,staffId:"s1",expectedVersion:2,
 counts:{...counts(),NURO:3},sbBreakdown:{"SB光":2,"SB AIR":2,"旧未分類":1},
 correctionReason:"契約内容を確認して件数を訂正"
});
const resultFor=req=>({
 saved:true,scope:"hub-owner-existing-only",
 partnerCompanyId:req.partnerCompanyId,staffId:req.staffId,
 date:req.date,version:req.expectedVersion+1,
 totalCount:Object.values(req.counts).reduce((a,b)=>a+b,0),
 containsFinance:false
});
function fixture({
 listResponse=()=>listValue(),correctResponse=resultFor,enabled=()=>true
}={}){
 const user={uid:"owner",email:"owner@example.com",emailVerified:true,
  getIdTokenResult:async()=>({
   claims:{email:"owner@example.com",email_verified:true}
  })
 };
 const auth={currentUser:user},seen={list:[],correct:[]};
 const client=makeOwnerCorrectionClient({auth,enabled,
  listCallable:async arg=>{
   seen.list.push(arg);return {data:await listResponse(arg)}
  },
  correctCallable:async arg=>{
   seen.correct.push(arg);return {data:await correctResponse(arg)}
  }
 });
 return {user,auth,client,seen};
}
test("verified owner loads strictly count-only response and forwards only company/date",async()=>{
 const f=fixture();
 const data=await f.client.list({date,partnerCompanyId:company});
 assert.deepEqual(f.seen.list,[{date,partnerCompanyId:company}]);
 assert.deepEqual(data,listValue());
 assert.notEqual(data,listValue(),"fresh sanitized copy");
 assert.doesNotMatch(JSON.stringify(data),/unitPrice|cashback|privateCounts|totalRevenue/i);
 assert.equal(f.seen.correct.length,0);
});
test("the staged panel payload, callable save and server readback work together",async()=>{
 let savedVersion=2,current=rows();
 const f=fixture({
  listResponse:()=>({...listValue(),entries:current}),
  correctResponse:req=>{
   savedVersion++;
   current=[{...current[0],version:savedVersion,counts:req.counts,
    totalCount:Object.values(req.counts).reduce((a,b)=>a+b,0),
    sbBreakdown:req.sbBreakdown}];
   return resultFor(req);
  }
 });
 const original=(await f.client.list({date,partnerCompanyId:company})).entries[0];
 const req=correctionPayload({
  date,partnerCompanyId:company,previous:original,
  draftCounts:writeReq().counts,draftSb:writeReq().sbBreakdown,
  correctionReason:writeReq().correctionReason
 });
 const saved=await f.client.correct(req);
 assert.deepEqual(f.seen.correct,[writeReq()]);
 assert.equal(saved.version,3);
 const after=await f.client.list({date,partnerCompanyId:company});
 assert.equal(verifyCorrectionReadback(saved,req,after),true);
 assert.equal(f.seen.list.length,2);
});
test("client never starts if disabled, unsigned or unverified",async()=>{
 const disabled=fixture({enabled:()=>false});
 await assert.rejects(disabled.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_DISABLED/);
 assert.equal(disabled.seen.list.length,0);
 const f=fixture();
 f.auth.currentUser=null;
 await assert.rejects(f.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_SIGNIN_REQUIRED/);
 f.auth.currentUser=f.user;
 f.user.emailVerified=false;
 await assert.rejects(f.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_SIGNIN_REQUIRED/);
 assert.equal(f.seen.list.length,0);
});
test("stale/revoked claims or identity change during token read cannot call the server",async()=>{
 const f=fixture();
 f.user.getIdTokenResult=async()=>({claims:{
  email:"someone@example.com",email_verified:true
 }});
 await assert.rejects(f.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_SESSION_UNVERIFIED/);
 f.user.getIdTokenResult=async()=>({claims:{
  email:"owner@example.com",email_verified:false
 }});
 await assert.rejects(f.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_SESSION_UNVERIFIED/);
 f.user.getIdTokenResult=async()=>{throw Error("secret identity error")};
 await assert.rejects(f.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_SESSION_UNVERIFIED/);
 f.user.getIdTokenResult=async()=>{
  f.auth.currentUser={...f.user};
  return {claims:{email:"owner@example.com",email_verified:true}};
 };
 await assert.rejects(f.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_SESSION_UNVERIFIED/);
 assert.equal(f.seen.list.length,0);
});
test("account switching or signout while callable is pending refuses the old response",async()=>{
 const f=fixture();
 let complete;
 const waiting=new Promise(resolve=>{complete=resolve});
 const original=fixture({
  listResponse:async()=>{await waiting;return listValue()}
 });
 const pending=original.client.list({date,partnerCompanyId:company});
 // Resume asynchronously only after request is observed.
 while(original.seen.list.length===0)await Promise.resolve();
 original.auth.currentUser=f.user;
 complete();
 await assert.rejects(pending,/OWNER_CORRECTION_STALE_SESSION/);
 assert.equal(original.seen.correct.length,0);
});
test("financial fields, corrupted rows and another company cannot be silently accepted",async()=>{
 const bad=[
  {...listValue(),revenue:100000},
  {...listValue(),containsFinance:true},
  {...listValue(),role:"partner"},
  {...listValue(),partnerCompanyId:"another"},
  {...listValue(),entries:[{...rows()[0],privateCounts:{secret:5}}]},
  {...listValue(),entries:[{...rows()[0],totalCount:999}]},
  {...listValue(),entries:[{...rows()[0],sbBreakdown:{"SB光":5,"SB AIR":5,"旧未分類":0}}]},
  {...listValue(),entries:[...rows(),...rows()]},
  {...listValue(),entries:[{...rows()[0],version:0}]},
  {...listValue(),entries:[{...rows()[0],staffName:"売上100円"}]},
  {...listValue(),sbBreakdownSchema:"unspecified"}
 ];
 for(const value of bad){
  const f=fixture({listResponse:()=>value});
  await assert.rejects(f.client.list({date,partnerCompanyId:company}),
   /OWNER_CORRECTION_/);
 }
});
test("requests with forged actor, finance, other fields or malformed split never reach Functions",async()=>{
 const f=fixture();
 for(const invalid of [
  {...writeReq(),uid:"owner"},
  {...writeReq(),unitPrice:1000},
  {...writeReq(),role:"hub"},
  {...writeReq(),workspaceCompanyId:"internal"},
  {...writeReq(),counts:{...writeReq().counts,revenue:2}},
  {...writeReq(),sbBreakdown:{"SB光":2,"SB AIR":4,"旧未分類":1}},
  {...writeReq(),expectedVersion:1000},
  {...writeReq(),correctionReason:"売上10000円に修正"},
  {...writeReq(),correctionReason:"短い"}
 ])await assert.rejects(f.client.correct(invalid),/OWNER_CORRECTION_/);
 await assert.rejects(f.client.list({date,partnerCompanyId:company,uid:"owner"}),
  /OWNER_CORRECTION_REQUEST_UNVERIFIED/);
 assert.equal(f.seen.correct.length,0);
 assert.equal(f.seen.list.length,0);
});
test("corrupted response version, finance flag or total cannot fake success",async()=>{
 const req=writeReq();
 for(const result of [
  {...resultFor(req),totalRevenue:100000},
  {...resultFor(req),containsFinance:true},
  {...resultFor(req),version:4},
  {...resultFor(req),totalCount:99},
  {...resultFor(req),scope:"other"},
  {...resultFor(req),partnerCompanyId:"another"}
 ]){
  const f=fixture({correctResponse:()=>result});
  await assert.rejects(f.client.correct(req),
   /OWNER_CORRECTION_WRITE_RESULT_UNVERIFIED/);
  assert.equal(f.seen.correct.length,1);
 }
});
test("concurrent writes denied; failures are never retried and errors sanitized",async()=>{
 let resolveWrite;
 const pending=new Promise(resolve=>{resolveWrite=resolve});
 const f=fixture({correctResponse:()=>pending});
 const first=f.client.correct(writeReq());
 while(f.seen.correct.length===0)await Promise.resolve();
 await assert.rejects(f.client.correct(writeReq()),/OWNER_CORRECTION_WRITE_BUSY/);
 resolveWrite(resultFor(writeReq()));
 assert.equal((await first).version,3);
 assert.equal(f.seen.correct.length,1);
 const failure=fixture({correctResponse:async()=>{throw Error("secret token")}})
 await assert.rejects(failure.client.correct(writeReq()),err=>
  err.message==="OWNER_CORRECTION_WRITE_UNCERTAIN_RELOAD_ONLY");
 assert.equal(failure.seen.correct.length,1);
});
test("dispose rejects an in-flight read and every later operation, without storage or logging",async()=>{
 let resume;
 const waiting=new Promise(resolve=>{resume=resolve});
 const f=fixture({listResponse:async()=>{await waiting;return listValue()}});
 const request=f.client.list({date,partnerCompanyId:company});
 while(f.seen.list.length===0)await Promise.resolve();
 f.client.dispose();
 resume();
 await assert.rejects(request,/OWNER_CORRECTION_STALE_SESSION/);
 await assert.rejects(f.client.list({date,partnerCompanyId:company}),
  /OWNER_CORRECTION_DISABLED/);
 assert.equal(f.seen.correct.length,0);
 const src=readFileSync(new URL("../staging/partner-owner-correction-v3/owner-client.mjs",
  import.meta.url),"utf8");
 assert.match(src,/STAGING ONLY \/ NO DEPLOY/);
 assert.doesNotMatch(src,/firebase deploy|localStorage|sessionStorage|document\.cookie|console\./);
 assert.doesNotMatch(src,/getFirestore|collection\(|functions\.net|firebaseapp\.com/);
});
