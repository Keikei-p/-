import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const from=html.indexOf("function verifiedDirectDayCounts(date){");
const until=html.indexOf("\nfunction appendSharedRankingRows(",from);
assert.ok(from>=0&&until>from,"direct count reader must remain inspectable");
const reader=html.slice(from,until);
const data=date=>({
 canLoadPartnerRanking:()=>true,
 recordsReady:true,recordsSubscribedMonth:"2026-10",
 dashboardMonth:{value:"2026-10"},
 currentUserData:{companyId:"hub"},
 products:[{id:"nuro",name:"ニューロ光",unitPrice:99999}],
 records:[
  {date:"2026-10-31",companyId:"hub",uid:"staffA",
   teamId:"red",teamNameSnapshot:"赤班",memberNameSnapshot:"担当A",
   results:[{productId:"nuro",count:2}],totalCount:2,totalRevenue:199998},
  {date:"2026-10-31",companyId:"hub",id:"old-1",
   teamId:"red",teamNameSnapshot:"赤班",memberNameSnapshot:"担当未確認",
   results:[{productId:"nuro",count:1}],totalCount:1,totalRevenue:99999}
 ],
 getRecordResults:row=>row.results,
 getCurrentMemberName:row=>row.memberNameSnapshot,
 getCurrentTeamName:row=>row.teamNameSnapshot,
 sharedVerifiedProductCategory:name=>name==="ニューロ光"?"NURO":null
});
function run(date,context){
 return runInNewContext(reader+"\nverifiedDirectDayCounts("+JSON.stringify(date)+")",context);
}
test("product ID lookup uses original catalog instead of a local Map",()=>{
 const snapshot=run("2026-10-31",data());
 assert.equal(snapshot.totalCount,3);
 assert.equal(snapshot.products.length,1);
 assert.equal(snapshot.products[0].name,"NURO");
 assert.equal(snapshot.products[0].count,3);
 assert.equal(snapshot.teams[0].totalCount,3);
 assert.doesNotMatch(JSON.stringify(snapshot),/unitPrice|totalRevenue|99999/);
});
test("historical records without staff ID contribute to totals but never fake personal ranks",()=>{
 const snapshot=run("2026-10-31",data());
 assert.equal(snapshot.peopleVerified,false);
 assert.equal(snapshot.unverifiedPersonRecords,1);
 assert.equal(snapshot.people.length,1);
 assert.equal(snapshot.people[0].totalCount,2);
 assert.equal(snapshot.people[0].name,"直営｜担当A");
 assert.equal(snapshot.totalCount,3);
 assert.equal(snapshot.teams[0].totalCount,3);
});
test("verified person with repeated records aggregates by immutable ID; impossible input fails",()=>{
 const ctx=data();
 ctx.records[1].uid="staffA";
 let snapshot=run("2026-10-31",ctx);
 assert.equal(snapshot.peopleVerified,true);
 assert.equal(snapshot.unverifiedPersonRecords,0);
 assert.equal(snapshot.people.length,1);
 assert.equal(snapshot.people[0].totalCount,3);
 ctx.records[1].results[0].count=-1;
 assert.throws(()=>run("2026-10-31",ctx),/direct_count_invalid/);
});
test("shared company and team display use true staff verification, not just record presence",()=>{
 assert.match(html,/report\.direct\.people,report\.direct\.peopleVerified===true/);
 assert.doesNotMatch(html,/report\.direct\.people,report\.direct\.recordsVerified>0/);
 assert.match(html,/未報告・未照合の実績があります/);
});
