import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createPartnerCountBrowserClient}
 from "../client/partner-count-browser-client.mjs";

const origin="https://nico-factory.web.app";
const url="https://approved-partner-worker.example";
const key="retry_safe_partner_20261030";
const report={date:"2026-10-30",teamId:"team1",status:"submitted",
 lines:[{catalogId:"shared:hub:NURO",count:2},
  {catalogId:"custom:partnerA:own",count:1}]};
function fixture({dropFirstReply=false,corruptRead=false}={}){
 let current={found:false,date:report.date,teamId:report.teamId};
 let calls=[],posts=0,reads=0;
 let dropped=false;
 const fetcher=async(path,options={})=>{
  const u=new URL(path);
  assert.equal(u.origin,url);
  assert.equal(options.credentials,"omit");
  assert.equal(options.cache,"no-store");
  assert.equal(options.headers.Authorization,"Bearer "+"a".repeat(60));
  calls.push({path:u.pathname,method:options.method,body:options.body?JSON.parse(options.body):null});
  const ok=(value)=>new Response(JSON.stringify(value),{status:200});
  if(u.pathname==="/v1/partner-own-day"){
   assert.equal(options.method,"GET");
   assert.deepEqual([...u.searchParams.keys()].sort(),["date","teamId"]);
   reads++;
   return ok(corruptRead?{...current,unitPrice:90000}:current);
  }
  if(u.pathname==="/v1/partner-counts"){
   assert.equal(options.method,"POST");
   posts++;
   const body=JSON.parse(options.body);
   assert(Object.keys(body).every(k=>!["revenue","cashback","unitPrice"].includes(k)));
   if(body.action==="create"){
    assert.equal(body.retryKey,key);
    assert.equal(current.found,false);
    current={found:true,date:body.request.date,teamId:body.request.teamId,
      recordId:"pc_test",version:1,status:body.request.status,
      lines:body.request.lines,ownCount:body.request.lines.reduce((n,r)=>n+r.count,0),
      sharedCount:body.request.lines.filter(r=>r.catalogId.startsWith("shared:"))
       .reduce((n,r)=>n+r.count,0)};
   }else{
    assert.equal(body.action,"correct");
    assert.equal(body.recordId,"pc_test");
    assert.equal(body.expectedVersion,current.version);
    current={...current,version:current.version+1,status:body.request.status,
      lines:body.request.lines,
      ownCount:body.request.lines.reduce((n,r)=>n+r.count,0),
      sharedCount:body.request.lines.filter(r=>r.catalogId.startsWith("shared:"))
       .reduce((n,r)=>n+r.count,0)};
   }
   if(dropFirstReply&&!dropped){
    dropped=true;throw Error("Simulated lost connection AFTER server commit");
   }
   return ok({saved:true,status:body.action==="create"?"registered":"corrected",
    recordId:current.recordId,version:current.version,
    ownCount:current.ownCount,sharedCount:current.sharedCount});
  }
  throw Error("Only two protected count routes are allowed");
 };
 return {
  make:()=>createPartnerCountBrowserClient({enabled:true,origin,
   gatewayBase:url,getIdToken:async()=> "a".repeat(60),fetcher,
   mintRetryKey:()=>key}),
  get posts(){return posts;},get reads(){return reads;},get calls(){return calls;},
  setCurrent:x=>{current=x;},get current(){return current;}
 };
}
test("first report performs GET, POST and verification GET; same report never re-posts",async()=>{
 const f=fixture(),api=f.make();
 const first=await api.saveDay(report);
 assert.deepEqual(first,{confirmed:true,alreadyCurrent:false,recordId:"pc_test",
  version:1,ownCount:3,sharedCount:2});
 assert.deepEqual(f.calls.map(c=>[c.method,c.path]),[
  ["GET","/v1/partner-own-day"],["POST","/v1/partner-counts"],
  ["GET","/v1/partner-own-day"]]);
 const again=await api.saveDay(report);
 assert.equal(again.alreadyCurrent,true);
 assert.equal(f.posts,1);
 assert.equal(f.reads,3);
});
test("ambiguous server ACK is not success; next retry fetches confirmed saved state",async()=>{
 const f=fixture({dropFirstReply:true}),api=f.make();
 await assert.rejects(api.saveDay(report),/Simulated lost connection/);
 assert.equal(f.posts,1);
 const recovered=await api.saveDay(report);
 assert.equal(recovered.confirmed,true);
 assert.equal(recovered.alreadyCurrent,true);
 assert.equal(f.posts,1,"never double-register after an unknown POST outcome");
});
test("correction carries latest exact version and keeps strict count-only inputs",async()=>{
 const f=fixture(),api=f.make();
 await api.saveDay(report);
 const correction={...report,lines:[{catalogId:"shared:hub:NURO",count:5}]};
 const updated=await api.saveDay(correction);
 assert.equal(updated.version,2);
 assert.equal(updated.ownCount,5);
 assert.equal(updated.sharedCount,5);
 assert.equal(f.posts,2);
 assert.equal(f.calls.findLast(x=>x.method==="POST").body.expectedVersion,1);
});
test("zero-result day saves with status=no_result, no fake count line",async()=>{
 const f=fixture(),api=f.make();
 const zero={date:report.date,teamId:report.teamId,status:"no_result",lines:[]};
 const r=await api.saveDay(zero);
 assert.equal(r.ownCount,0);
 assert.equal(r.sharedCount,0);
 assert.equal(f.calls.find(x=>x.method==="POST").body.request.status,"no_result");
});
test("rejects old host, disabled feature, malformed schema and price injected by caller",async()=>{
 for(const args of [
  {enabled:false,origin,gatewayBase:url,getIdToken:async()=>"a".repeat(60)},
  {enabled:true,origin:"https://keikei-p.github.io",gatewayBase:url,getIdToken:async()=>"a".repeat(60)},
  {enabled:true,origin,gatewayBase:"http://insecure.example",getIdToken:async()=>"a".repeat(60)},
  {enabled:true,origin,gatewayBase:url+"/sub/path",getIdToken:async()=>"a".repeat(60)}
 ])assert.throws(()=>createPartnerCountBrowserClient(args),/partner_count_client_blocked/);
 const f=fixture(),api=f.make();
 for(const bad of [
  {...report,totalRevenue:9000},
  {...report,lines:[{catalogId:"shared:hub:NURO",count:1,unitPrice:1000}]},
  {...report,lines:[{catalogId:"shared:hub:NURO",count:0}]},
  {...report,date:"2026-02-30"},
  {...report,status:"no_result"}
 ])await assert.rejects(api.saveDay(bad),/partner_count_client_blocked/);
 assert.equal(f.calls.length,0);
 const tampered=fixture({corruptRead:true}),unsafe=tampered.make();
 await assert.rejects(unsafe.saveDay(report),/partner_count_client_blocked/);
 assert.equal(tampered.posts,0);
});
test("source never imports raw Firestore SDK or stores credentials/financial fields",()=>{
 const src=readFileSync(new URL("../client/partner-count-browser-client.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/firebase-firestore|getFirestore\(|onSnapshot\(|localStorage|sessionStorage|recordsCollectionQuery/);
 assert.match(src,/\/v1\/partner-own-day/);
 assert.match(src,/\/v1\/partner-counts/);
 assert.match(src,/credentials:"omit"/);
});
