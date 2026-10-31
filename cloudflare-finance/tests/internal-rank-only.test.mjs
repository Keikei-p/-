import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildInternalRankOnly as rank} from "../src/internal-rank-only.mjs";
const companyId="direct",month="2026-10";
const make=(id,uid,name,totalCount,date="2026-10-01")=>({
 id,companyId,uid,memberNameSnapshot:name,date,totalCount,
 results:totalCount?{nu:{productId:"nu",count:totalCount,revenuePerUnit:12345}}:{}
});
const set=()=>[make("1","u1","佐藤",3),make("2","u2","田中",1),make("3","u3","山田",1)];
test("individual ranks contain names and ranks only, no company amounts or raw identifiers",()=>{
 const r=rank({companyId,month,records:set(),complete:true});
 assert.equal(r.schema,"nico-internal-person-rank-only-v1");
 assert.deepEqual(r.individuals.map(x=>x.rank),[1,2,2]);
 for(const person of r.individuals)
   assert.deepEqual(Object.keys(person).sort(),["champion","name","rank"]);
 const s=JSON.stringify(r);
 for(const forbidden of ["revenuePerUnit","totalRevenue","uid","companyId","count","cashback","unitPrice","12345","u1","u2","u3"]){
  assert.equal(s.includes('"'+forbidden+'"'),false);
 }
});
test("historical member transfer leaves personal counts together without rewriting saved records",()=>{
 const rows=[make("old","one","佐藤",1),make("next","one","佐藤",4,"2026-10-21")];
 const before=JSON.stringify(rows);
 const r=rank({companyId,month,records:rows,complete:true});
 assert.equal(r.individuals.length,1);
 assert.equal(r.individuals[0].rank,1);
 assert.equal(JSON.stringify(rows),before);
});
test("failed/incomplete pages and malformed records must not publish a rank",()=>{
 const variants=[
  {complete:false},
  {records:[...set(),{...set()[0]}]},
  {records:[{...set()[0],companyId:"external"}]},
  {records:[{...set()[0],totalCount:999}]},
  {records:[{...set()[0],date:"2026-10-99"}]},
  {records:[{...set()[0],memberNameSnapshot:"佐藤 90000円"}]},
  {records:[{...set()[0],memberNameSnapshot:"CB3000"}]},
  {records:[{...set()[0],results:{p:{count:1}}}]}
 ];
 for(const override of variants){
  assert.throws(()=>rank({companyId,month,records:set(),complete:true,...override}),
   /incomplete_or_unauthorized/);
 }
});
test("no-result record can be zero, but no money is ever emitted",()=>{
 const r=rank({companyId,month,records:[make("r","u1","佐藤",0)],complete:true});
 assert.deepEqual(r.individuals,[{rank:1,name:"佐藤",champion:false}]);
});
test("actual Worker route is OFF-by-default and validates signed caller before Firestore",()=>{
 const server=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 const config=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 const code=server.slice(server.indexOf('if(url.pathname==="/v1/internal-ranks")'),
  server.indexOf('if(url.pathname==="/v1/partner-count-catalog")'));
 assert.match(config,/INTERNAL_RANKS_ENABLED = "disabled"/);
 assert.match(code,/INTERNAL_RANKS_ENABLED==="enabled"/);
 assert.match(code,/FINANCE_GATEWAY_ENABLED==="enabled"/);
 assert.match(code,/verifiedToken\(auth\.slice\(7\)\)/);
 assert.match(code,/memberPolicy\(env,principal\)/);
 assert.match(code,/policy\.isPartner/);
 assert.match(code,/firestoreMonthlyRecords\(env,policy\.companyId/);
 assert.match(code,/buildInternalRankOnly/);
 assert.doesNotMatch(code,/\b(?:updateDoc|setDoc|deleteDoc|firebase\s+deploy|wrangler\s+deploy|documents:commit)\b/);
});
