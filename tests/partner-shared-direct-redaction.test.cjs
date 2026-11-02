"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readDirectDayCounts,MAX_DIRECT_RECORDS_PER_DAY}=
 require("../functions-partner-workspace/shared-direct-counts.cjs");
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
function fakeDb(seed){
 const paths=new Map(Object.entries(seed));
 const reads=[];
 return {
  reads,
  collection(group){
   return {
    where(k,op,v){
     assert.equal(op,"==");
     const filters=[{k,v}];
     const query={
      where(k2,op2,v2){assert.equal(op2,"==");filters.push({k:k2,v:v2});return query;},
      limit(max){return {
       async get(){
        reads.push({group,filters:structuredClone(filters),max});
        const docs=[...paths].filter(([path,data])=>path.startsWith(group+"/")&&
          !path.slice(group.length+1).includes("/")&&
          filters.every(f=>data[f.k]===f.v)).map(([path,data])=>({
           id:path.split("/").at(-1),data:()=>data
          })).slice(0,max);
        return {size:docs.length,docs};
       }
      }}
     };
     return query;
    }
   };
  }
 };
}
test("verified direct members, original teams and ID-only products are redacted to safe counts",async()=>{
 const db=fakeDb({
  "products/prod1":{companyId:"hub",name:"ニューロ光",unitPrice:38000},
  "products/prod2":{companyId:"hub",name:"ソフトバンク光",unitPrice:45000},
  "products/unrelated":{companyId:"someone-else",name:"NURO",unitPrice:100},
  "records/r1":{companyId:"hub",date:"2026-10-31",uid:"person1",
    memberNameSnapshot:"担当一",teamId:"team1",teamNameSnapshot:"第一班",
    results:{prod1:{count:2,revenuePerUnit:38000},prod2:{count:1,revenuePerUnit:45000}},
    totalCount:3,totalRevenue:121000},
  "records/r2":{companyId:"hub",date:"2026-10-31",uid:"person1",
    memberNameSnapshot:"担当一",teamId:"team1",teamNameSnapshot:"第一班",
    results:{prod1:{count:1,revenuePerUnit:38000}},totalCount:1,totalRevenue:38000},
  "records/r3":{companyId:"hub",date:"2026-10-31",uid:"person2",
    memberNameSnapshot:"contact@example.com",teamId:"team2",teamNameSnapshot:"第二班",
    results:[{productName:"フレシャス",count:2,revenuePerUnit:10000}],
    totalCount:2,totalRevenue:20000}
 });
 const data=await readDirectDayCounts(db,"hub","2026-10-31",KEYS);
 assert.equal(data.totalCount,6);
 assert.equal(data.recordsVerified,3);
 assert.equal(data.counts.NURO,3);
 assert.equal(data.counts["SB光・AIR"],1);
 assert.equal(data.counts["ウォーター"],2);
 assert.equal(data.otherCount,0);
 assert.deepEqual(data.people.map(x=>x.totalCount),[4,2]);
 assert.equal(data.people[1].name,"担当者未確認","emails must not leak as display names");
 assert.equal(data.teams.length,2);
 assert.equal(data.teams[0].name,"第一班");
 assert.equal(data.teams[0].totalCount,4);
 assert.equal(data.people[0].teamKey,data.teams[0].key);
 assert.match(data.people[0].key,/^[a-f0-9]{64}$/);
 assert.equal(db.reads.length,2);
 assert.deepEqual(db.reads[0].filters,[{k:"companyId",v:"hub"},{k:"date",v:"2026-10-31"}]);
 assert.deepEqual(db.reads[1].filters,[{k:"companyId",v:"hub"}]);
 assert.doesNotMatch(JSON.stringify(data),/unitPrice|revenuePerUnit|totalRevenue|38000|45000|121000|contact@example|person1|person2|prod1/);
});
test("count-only export fails closed when record quantity or stored total does not reconcile",async()=>{
 for(const bad of [-1,0.5,10000]){
  const db=fakeDb({"records/a":{companyId:"hub",date:"2026-10-31",uid:"u",
   results:[{productName:"NURO",count:bad}],totalCount:bad}});
  await assert.rejects(readDirectDayCounts(db,"hub","2026-10-31",KEYS),/DIRECT_INVALID_QUANTITY/);
 }
 const db=fakeDb({"records/a":{companyId:"hub",date:"2026-10-31",uid:"u",
  results:[{productName:"NURO",count:2}],totalCount:8,totalRevenue:123}});
 await assert.rejects(readDirectDayCounts(db,"hub","2026-10-31",KEYS),/DIRECT_TOTAL_MISMATCH/);
});
test("count-only export never publishes partial budget-exceeded rankings",async()=>{
 const records={};
 for(let i=0;i<4;i++)records["records/r"+i]={companyId:"hub",date:"2026-10-31",
  uid:"u"+i,results:[{productName:"NURO",count:1}],totalCount:1};
 const db=fakeDb(records);
 await assert.rejects(readDirectDayCounts(db,"hub","2026-10-31",KEYS,{maxRecords:3}),/DIRECT_READ_BUDGET_EXCEEDED/);
 assert.equal(MAX_DIRECT_RECORDS_PER_DAY,3000);
});


test("unattributed legacy records preserve totals without creating fake individuals",async()=>{
 const db=fakeDb({
  "records/unknown":{companyId:"hub",date:"2026-10-31",
   memberNameSnapshot:"仮担当",teamId:"t1",teamNameSnapshot:"直営1班",
   results:[{productName:"NURO",count:2}],totalCount:2,totalRevenue:999999},
  "records/known":{companyId:"hub",date:"2026-10-31",uid:"real",
   memberNameSnapshot:"実在担当",teamId:"t1",teamNameSnapshot:"直営1班",
   results:[{productName:"NURO",count:3}],totalCount:3,totalRevenue:777777}
 });
 const data=await readDirectDayCounts(db,"hub","2026-10-31",KEYS);
 assert.equal(data.totalCount,5,"company totals must not lose valid sales counts");
 assert.equal(data.counts.NURO,5);
 assert.equal(data.teams[0].totalCount,5,"historical team retains unattributed counts");
 assert.equal(data.peopleVerified,false);
 assert.equal(data.unverifiedPersonRecords,1);
 assert.equal(data.people.length,1,"unknown records must not create imaginary staff");
 assert.equal(data.people[0].name,"実在担当");
 assert.equal(data.people[0].totalCount,3);
 assert.doesNotMatch(JSON.stringify(data),/仮担当|records\/unknown|999999|777777/);
});
