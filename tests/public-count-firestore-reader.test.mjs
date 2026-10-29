import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicRunQuery,decodePublicRunQuery,createPublicFirestoreReader
} from "../security/public-count-firestore-reader.mjs";
import {createCountOnlyReadHandler} from "../security/public-count-api.mjs";

const db="projects/sales-management-cc116/databases/(default)/documents";
const stamp="2026-10-28T14:00:00.000000Z";
const opt={collection:"publicRecords",companyId:"companyA",teamId:"team1",
  startAfter:"",snapshotTime:null,limit:50};
function doc(i,{companyId="companyA",teamId="team1",extra={},readTime=stamp}={}){
 const id="record"+String(i).padStart(5,"0");
 const fields={
  companyId:{stringValue:companyId},sourceId:{stringValue:id},
  uid:{stringValue:"synthetic-user"},date:{stringValue:"2026-10-28"},
  teamId:{stringValue:teamId},totalCount:{integerValue:"1"},
  reportStatus:{stringValue:"submitted"},
  memberNameSnapshot:{stringValue:"担当者"},teamNameSnapshot:{stringValue:"1班"},
  workLocation:{stringValue:"店舗"},...extra
 };
 return {document:{name:db+"/publicRecords/"+id,fields},readTime};
}
test("fixed query permits public collections only and pins same snapshot",()=>{
 const q=buildPublicRunQuery(opt);
 assert.equal(q.method,"POST");
 assert.equal(q.endpoint,"https://firestore.googleapis.com/v1/"+db+":runQuery");
 assert.deepEqual(q.body.structuredQuery.from,[{collectionId:"publicRecords"}]);
 assert.equal(q.body.structuredQuery.limit,50);
 assert.equal(q.body.structuredQuery.where.compositeFilter.filters.length,2);
 assert.equal(q.body.readTime,undefined);
 const p=buildPublicRunQuery({...opt,startAfter:"record00049",snapshotTime:stamp});
 assert.equal(p.body.readTime,stamp);
 assert.deepEqual(p.body.structuredQuery.startAt,{
   before:false,values:[{referenceValue:db+"/publicRecords/record00049"}]});
 for(const bad of [
  {...opt,collection:"records"}, {...opt,collection:"recordCorrections"},
  {...opt,limit:51}, {...opt,limit:0},
  {...opt,teamId:""}, {...opt,teamId:"team2/../"},
  {...opt,startAfter:"../price"}, {...opt,snapshotTime:"yesterday"},
  {...opt,collection:"publicProducts",teamId:"team1"}
 ]) assert.throws(()=>buildPublicRunQuery(bad),/Invalid public-only/);
});
test("typed Firestore numeric count and full document ID are preserved",()=>{
 const page=decodePublicRunQuery([doc(1)],opt);
 assert.equal(page.readTime,stamp);
 assert.equal(page.items.length,1);
 assert.equal(page.items[0].sourceId,"record00001");
 assert.equal(page.items[0].totalCount,1);
 assert.equal(page.items[0].teamId,"team1");
});
test("query decoder rejects money-bearing nested results and unsafe cross-company pages at API layer",async()=>{
 const identity={uid:"partner",companyId:"companyA",userCompanyId:"companyA",
  memberCompanyId:"companyA",userActive:true,memberActive:true,
  companyOwnerUid:"owner",userCompanyRole:"member",memberCompanyRole:"member",
  serverVerifiedOwner:false,teamIds:["team1"]};
 async function serve(rows){
  const handle=createCountOnlyReadHandler({
   enabled:true,authenticateBearer:async()=>({uid:"partner",emailVerified:true}),
   loadMembership:async()=>identity,
   queryPublicDocuments:createPublicFirestoreReader({executeRunQuery:async()=>rows})
  });
  return handle(new Request("https://nico-factory.web.app/v1/public-counts?collection=publicRecords&teamId=team1",{
    headers:{Authorization:"Bearer "+"x".repeat(30),Origin:"https://nico-factory.web.app"}
  }));
 }
 for(const rows of [
  [doc(1,{extra:{totalRevenue:{integerValue:"50000"}}})],
  [doc(1,{extra:{results:{mapValue:{fields:{money:{integerValue:"50000"}}}}}})],
  [doc(1,{companyId:"otherCompany"})],
  [doc(1,{teamId:"otherTeam"})],
  [doc(1),doc(1)],
  [doc(1),doc(2,{readTime:"2026-10-28T14:05:00Z"})],
  [doc(1,{extra:{totalCount:{integerValue:"9007199254740993"}}})]
 ]){
  const r=await serve(rows);
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:"request_blocked"});
 }
});
test("2,501 synthetic contracts pass through actual handler + fixed query builder without undercounting",async()=>{
 const dataset=Array.from({length:2501},(_,i)=>doc(i));
 const captures=[];
 const adapter=createPublicFirestoreReader({
  executeRunQuery:async ({method,endpoint,body})=>{
    captures.push({method,endpoint,body});
    const query=body.structuredQuery;
    const last=query.startAt?.values[0]?.referenceValue?.split("/").at(-1);
    let start=last?dataset.findIndex(x=>x.document.name.endsWith("/"+last))+1:0;
    assert(start>=0);
    const selected=dataset.slice(start,start+query.limit);
    const rows=selected.length?selected:[{readTime:stamp}];
    return rows;
  }
 });
 const handle=createCountOnlyReadHandler({
  enabled:true,
  authenticateBearer:async()=>({uid:"partner",emailVerified:true}),
  loadMembership:async()=>({
   uid:"partner",companyId:"companyA",userCompanyId:"companyA",
   memberCompanyId:"companyA",userActive:true,memberActive:true,
   companyOwnerUid:"owner",userCompanyRole:"member",memberCompanyRole:"member",
   serverVerifiedOwner:false,teamIds:["team1"]
  }),
  queryPublicDocuments:adapter
 });
 let cursor="",snapshot="",total=0,seen=new Set(),pages=0;
 for(;;){
   pages++;
   const url=new URL("https://nico-factory.web.app/v1/public-counts");
   url.searchParams.set("collection","publicRecords");
   url.searchParams.set("teamId","team1");
   url.searchParams.set("limit","50");
   if(cursor){url.searchParams.set("cursor",cursor);url.searchParams.set("snapshot",snapshot);}
   const response=await handle(new Request(url.toString(),{headers:{
    Authorization:"Bearer "+"x".repeat(30),Origin:"https://nico-factory.web.app"
   }}));
   assert.equal(response.status,200,"must not silently skip pages");
   const data=await response.json();
   assert.equal(data.snapshotTime,stamp);
   for(const row of data.items){assert(!seen.has(row.sourceId));seen.add(row.sourceId);total+=row.totalCount;}
   cursor=data.nextCursor??"";snapshot=data.snapshotTime;
   if(!cursor)break;
   assert(pages<60,"paging must finish");
 }
 assert.equal(total,2501);
 assert.equal(seen.size,2501);
 assert.equal(pages,51);
 assert(captures.every(x=>x.endpoint.endsWith("/documents:runQuery")));
 assert(captures.every(x=>x.body.structuredQuery.where.compositeFilter.filters.length===2));
 assert.equal(captures[1].body.readTime,stamp);
});
test("changing snapshot halfway fails closed rather than reporting a partial count page",async()=>{
 const adapter=createPublicFirestoreReader({executeRunQuery:async q=>[
  doc(1,{readTime:q.body.readTime?"2026-10-28T14:01:00Z":stamp})
 ]});
 const o={...opt};
 await adapter(o);
 await assert.rejects(
   adapter({...o,startAfter:"record00000",snapshotTime:stamp}),
   /Invalid public-only/);
});
