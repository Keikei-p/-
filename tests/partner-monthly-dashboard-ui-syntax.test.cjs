"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const vm=require("node:vm"),{spawnSync}=require("node:child_process");
const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
const inline=html.match(/<script type="module">([\s\S]*?)<\/script>/);
test("production HTML inline module is syntactically valid (parse-only, no Firebase access)",()=>{
 assert.ok(inline?.[1],"the original app module remains mounted");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"partner-month-parse-"));
 try{
  const file=path.join(dir,"inline.mjs");
  fs.writeFileSync(file,inline[1]);
  const checked=spawnSync(process.execPath,["--check",file],{encoding:"utf8",timeout:15000});
  assert.equal(checked.status,0,checked.stderr||checked.error?.message||"syntax");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
function loadMonthRows(names){
 const start=html.indexOf("function partnerMonthVisibleCountRows(row,keys){");
 const end=html.indexOf("function appendPartnerMonthTeamCard(",start);
 assert.ok(start>0&&end>start);
 return vm.runInNewContext(html.slice(start,end)+"\npartnerMonthVisibleCountRows",{
  partnerPublishedProductNames:new Map(names)
 });
}
test("a normal monthly NURO+new-product detail lists each saved quantity exactly once",()=>{
 const rows=loadMonthRows([["fiberNew","新商材A"]])({
  totalCount:7,counts:{NURO:4,SBMNP:1},extraCounts:{fiberNew:2}
 },["NURO","SBMNP"]);
 assert.deepEqual(Array.from(rows,x=>({name:x.name,count:x.count})),[
  {name:"NURO",count:4},{name:"SBMNP",count:1},
  {name:"新商材A",count:2}
 ]);
 assert.equal(Array.from(rows,x=>x.count).reduce((a,b)=>a+b,0),7);
});
test("a directly counted published product never double-counts the SAME original sale",()=>{
 const rows=loadMonthRows([["nuroId","NURO光"]])({
  totalCount:4,counts:{NURO:4,SBMNP:0},extraCounts:{nuroId:4}
 },["NURO","SBMNP"]);
 assert.deepEqual(Array.from(rows,x=>({name:x.name,count:x.count})),[
  {name:"NURO",count:4}
 ]);
 assert.throws(()=>loadMonthRows([])({
  totalCount:3,counts:{NURO:4,SBMNP:0}
 },["NURO","SBMNP"]),/partner_month_double_count/);
});
test("an unpublished product never discloses the raw ID or guessed price in detail",()=>{
 const rows=loadMonthRows([])({totalCount:3,
  counts:{NURO:1,SBMNP:0},extraCounts:{fiberNew:2}
 },["NURO","SBMNP"]);
 assert.deepEqual(Array.from(rows,x=>({name:x.name,count:x.count})),[
  {name:"NURO",count:1},
  {name:"追加商材（名称未照合）・その他",count:2}
 ]);
 assert.doesNotMatch(JSON.stringify(rows),/fiberNew|unitPrice|totalRevenue|99999/);
});
