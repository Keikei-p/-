import test from "node:test";
import assert from "node:assert/strict";
import {createCountOnlyReadHandler} from "../security/public-count-api.mjs";

const TOKEN="synthetic-auth-token-that-cannot-be-used";
const URL_BASE="https://nico-factory.web.app/v1/public-counts";
const companyId="companyA",teamId="team1";
const userIdentity={
 uid:"partner",companyId,userCompanyId:companyId,memberCompanyId:companyId,
 userActive:true,memberActive:true,
 companyOwnerUid:"owner",userCompanyRole:"member",memberCompanyRole:"member",
 serverVerifiedOwner:false,teamIds:[teamId]
};
const makeRow=(id,team=teamId)=>({
 companyId,sourceId:id,uid:"partner",date:"2026-10-28",teamId:team,
 totalCount:3,reportStatus:"submitted",
 memberNameSnapshot:"担当者",teamNameSnapshot:"1班",workLocation:"テスト会場"
});
function fixture({rows=[makeRow("row0001")],identity=userIdentity,
 auth={uid:"partner",emailVerified:true},enabled=true,
 verify=undefined,member=undefined,query=undefined}={}){
 const calls=[];
 const adapter={
 enabled,
 authenticateBearer:verify??(async token=>{
   calls.push({phase:"token",tokenOk:token===TOKEN});return auth;
 }),
 loadMembership:member??(async uid=>{
   calls.push({phase:"membership",uid});return identity;
 }),
 queryPublicDocuments:query??(async ({collection,companyId:cid,teamId:team,startAfter,limit})=>{
   calls.push({phase:"query",collection,companyId:cid,teamId:team,startAfter,limit});
   return rows.filter(x=>x.companyId===cid&&(!team||x.teamId===team)&&x.sourceId>startAfter)
     .slice(0,limit);
 })
 };
 return {handle:createCountOnlyReadHandler(adapter),calls};
}
async function get(handle,query="collection=publicRecords&teamId=team1",options={}){
 const u=query?URL_BASE+"?"+query:URL_BASE;
 const req=new Request(u,{method:options.method??"GET",headers:{
   "Authorization":options.auth??"Bearer "+TOKEN,
   "Origin":options.origin??"https://nico-factory.web.app"
 }});
 const response=await handle(req);
 return {status:response.status,body:await response.json(),headers:response.headers};
}
test("gateway defaults disabled and never calls any auth or database adapter",async()=>{
 let touched=false;
 const f=fixture({enabled:false,verify:async()=>{touched=true;throw Error("MUST NOT CALL");}});
 const r=await get(f.handle);
 assert.equal(r.status,503);
 assert.equal(touched,false);
 assert.deepEqual(r.body,{error:"request_blocked"});
});
test("only valid GET, explicitly allowlisted origins and safe parameters",async()=>{
 const f=fixture();
 for(const [query,opts,status] of [
  ["collection=records&teamId=team1",{},400],
  ["collection=publicRecords&teamId=team1&companyId=other",{},400],
  ["collection=publicRecords&teamId=team1&limit=51",{},400],
  ["collection=publicRecords&teamId=team1&limit=0",{},400],
  ["collection=publicRecords&teamId=team1&limit=01",{},400],
  ["collection=publicRecords&teamId=team1&cursor=uid/../../x",{},400],
  ["collection=publicRecords&teamId=team1&teamId=team2",{},400],
  ["collection=publicProducts&teamId=team1",{},400],
  ["collection=publicRecords",{},400],
  ["collection=publicRecords&teamId=team1",{method:"POST"},405],
  ["collection=publicRecords&teamId=team1",{origin:"https://evil.example"},403],
  ["collection=publicRecords&teamId=team1",{auth:"Bearer invalid"},401]
 ]){
  const r=await get(f.handle,query,opts);
  assert.equal(r.status,status,JSON.stringify({query,opts}));
  assert.deepEqual(r.body,{error:"request_blocked"});
 }
 assert.equal(f.calls.length,0,"bad requests rejected before any backend call");
 const valid=await get(f.handle,"collection=publicRecords&teamId=team1");
 assert.equal(valid.status,200);
 assert.equal(valid.headers.get("Access-Control-Allow-Origin"),"https://nico-factory.web.app");
});
test("denies unsigned identity, missing membership, suspended user or other-company membership",async()=>{
 const alternatives=[
  {auth:{uid:"partner",emailVerified:false}},
  {auth:{uid:"partner",emailVerified:true},identity:null},
  {identity:{...userIdentity,userActive:false}},
  {identity:{...userIdentity,memberActive:false}},
  {identity:{...userIdentity,userCompanyId:"companyB"}},
  {identity:{...userIdentity,memberCompanyId:"companyB"}},
  {identity:{...userIdentity,uid:"other"}},
  {identity:{...userIdentity,teamIds:["team2"]}},
  {identity:{...userIdentity,teamIds:[teamId,teamId]}},
  {identity:{...userIdentity,teamIds:["../untrusted"]}}
 ];
 for(const alt of alternatives){
  const result=await get(fixture(alt).handle);
  assert.notEqual(result.status,200,JSON.stringify(alt));
  assert.deepEqual(result.body,{error:"request_blocked"});
 }
});
test("cannot promote an ordinary leader to owner through query or a single spoofed server flag",async()=>{
 const plain=fixture({identity:{...userIdentity,serverVerifiedOwner:true}});
 const otherTeam=await get(plain.handle,"collection=publicRecords&teamId=team2");
 assert.equal(otherTeam.status,403);
 const spoof=await get(plain.handle,"collection=publicRecords&teamId=team1&role=owner");
 assert.equal(spoof.status,400);
 const ownerIdentity={...userIdentity,
   uid:"owner",userCompanyRole:"owner",memberCompanyRole:"owner",
   companyOwnerUid:"owner",serverVerifiedOwner:true,teamIds:[]};
 const owner=fixture({
   identity:ownerIdentity,auth:{uid:"owner",emailVerified:true},
   rows:[makeRow("row0001","team2")]
 });
 const other=await get(owner.handle,"collection=publicRecords&teamId=team2");
 assert.equal(other.status,200);
 assert.equal(other.body.items.length,1);
});
test("multi-page 125 rows read once each with cursor, no 2000 hard limit",async()=>{
 const rows=Array.from({length:125},(_,i)=>makeRow("row"+String(i).padStart(4,"0")));
 const f=fixture({rows});
 const seen=[];
 let cursor="";
 for(let page=0;page<3;page++){
  const param="collection=publicRecords&teamId=team1&limit=50"+(cursor?"&cursor="+cursor:"");
  const r=await get(f.handle,param);
  assert.equal(r.status,200);
  seen.push(...r.body.items);
  if(page<2){assert.equal(r.body.items.length,50);assert.ok(r.body.nextCursor);}
  cursor=r.body.nextCursor??"";
 }
 assert.equal(seen.length,125);
 assert.equal(new Set(seen.map(x=>x.sourceId)).size,125);
 assert.equal(seen.reduce((sum,x)=>sum+x.totalCount,0),375);
 assert.equal(seen[124].sourceId,"row0124");
 assert(!JSON.stringify(seen).includes("memberNameSnapshot"),"personal names should not be in public count payload");
 assert(f.calls.some(x=>x.phase==="query"&&x.limit===50));
 assert(f.calls.filter(x=>x.phase==="membership").length===3,
   "must recheck live membership for every page");
});
test("partner response never includes money, raw records, UID or backend role fields",async()=>{
 const f=fixture();
 const r=await get(f.handle);
 assert.equal(r.status,200);
 assert.deepEqual(r.body.items[0],{
   sourceId:"row0001",date:"2026-10-28",teamId:"team1",totalCount:3,reportStatus:"submitted"
 });
 const json=JSON.stringify(r.body);
 for(const token of ["totalRevenue","uid","canViewRevenue","results","cashback","unitPrice","memberNameSnapshot"])
   assert.equal(json.includes(token),false,"leaked "+token);
});
test("backend-injected financial fields, price-bearing IDs and nested results fail without partial output",async()=>{
 const extra=[
   {...makeRow("row0001"),totalRevenue:20000},
   {...makeRow("row0001"),sourceId:"NURO_CB20000"},
   {...makeRow("row0001"),results:{p1:{revenuePerUnit:10000}}},
   {...makeRow("row0001"),teamNameSnapshot:"1万円支店"}
 ];
 for(const changed of extra){
   const f=fixture({rows:[changed]});
   const res=await get(f.handle);
   assert.equal(res.status,503);
   assert.deepEqual(res.body,{error:"request_blocked"});
   assert(!JSON.stringify(res.body).includes("20000"));
 }
});
test("mis-scoped or out-of-order datastore results cannot leak financial or other-team data",async()=>{
 for(const rows of [
   [makeRow("row0001","team2")],
   [{...makeRow("row0001"),companyId:"companyB"}],
   [makeRow("row0002"),makeRow("row0001")],
   [makeRow("row0001"),makeRow("row0001")],
 ]){
   const f=fixture({query:async()=>rows});
   const result=await get(f.handle,"collection=publicRecords&teamId=team1&limit=2");
   assert.equal(result.status,503);
   assert.deepEqual(result.body,{error:"request_blocked"});
 }
});
test("no arbitrary Firestore source: rank view exposes rank only, products expose labels only",async()=>{
 const docs=[
   {collection:"publicProducts",row:{
     companyId,sourceId:"p1",name:"NURO",active:true,sortOrder:1
   },expected:{sourceId:"p1",name:"NURO",active:true,sortOrder:1}},
   {collection:"publicRankEntries",row:{
     companyId,sourceId:"r1",displayName:"担当A",period:"2026-10",kind:"member",rank:1
   },expected:{sourceId:"r1",displayName:"担当A",period:"2026-10",kind:"member",rank:1}}
 ];
 for(const c of docs){
   const f=fixture({query:async scope=>{
     assert.equal(scope.collection,c.collection);
     assert.equal(scope.teamId,null);
     assert.equal(scope.companyId,companyId);
     return [c.row];
   }});
   const r=await get(f.handle,"collection="+c.collection);
   assert.equal(r.status,200);
   assert.deepEqual(r.body.items[0],c.expected);
   assert.equal(JSON.stringify(r.body).includes("totalCount"),false); // rank and product views do not reveal counts
   assert.equal(JSON.stringify(r.body).includes("totalRevenue"),false);
 }
});
test("all backend errors are generic and do not leak user identity, prices or Firestore paths",async()=>{
 const f=fixture({query:async()=>{throw Error("PRIVATE: user u123 has revenuePerUnit 10000");}});
 const result=await get(f.handle);
 assert.equal(result.status,503);
 assert.deepEqual(result.body,{error:"request_blocked"});
 assert.equal(JSON.stringify(result.body).includes("10000"),false);
});
