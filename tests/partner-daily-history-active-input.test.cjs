"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
function source(name){
 const at=html.indexOf("function "+name+"(");
 assert(at>=0,"Missing "+name);
 const end=html.indexOf("\n}",at);
 assert(end>at,"Missing function closing brace for "+name);
 return html.slice(at,end+2);
}
const helpers=["partnerInlineEditableStaff","partnerInlineDailyRankingTotals"];
const code=helpers.map(source).join("\n");
const ctx=vm.createContext({Set,Map,Number,Object});
vm.runInContext(code,ctx);
const snap={
 companyName:"Example Partner",
 teams:[
  {id:"old",name:"Retired Team",active:false},
  {id:"now",name:"Current Team",active:true}
 ],
 staff:[
  {id:"r",name:"Retired Employee",active:false,teamId:"old"},
  {id:"m",name:"Moved Employee",active:true,teamId:"old"},
  {id:"a",name:"Active Employee",active:true,teamId:"now"},
  {id:"n",name:"Inactive Employee",active:false,teamId:"now"}
 ],
 categories:["NURO","U-NEXT"],
 records:[
  {staffId:"r",teamIdSnapshot:"old",counts:{"NURO":2,"U-NEXT":1},totalCount:3},
  {staffId:"m",teamIdSnapshot:"old",counts:{"NURO":1,"U-NEXT":0},totalCount:1},
  {staffId:"a",teamIdSnapshot:"now",counts:{"NURO":3,"U-NEXT":0},totalCount:3},
  {staffId:"n",teamIdSnapshot:"now",counts:{"NURO":0,"U-NEXT":2},totalCount:2}
 ]
};
test("new entry selector requires a live staff member in a live team",()=>{
 const candidates=ctx.partnerInlineEditableStaff(snap).map(x=>x.id);
 assert.deepEqual(Array.from(candidates),["a"]);
 assert.equal(ctx.partnerInlineEditableStaff({...snap,teams:[]}).length,0);
 assert.equal(ctx.partnerInlineEditableStaff({...snap,staff:[]}).length,0);
});
test("daily team, personal, and product ranking never drops saved retired staff or team counts",()=>{
 const original=JSON.stringify(snap);
 const {byTeam,byPerson,byProduct}=ctx.partnerInlineDailyRankingTotals(snap);
 assert.deepEqual(Array.from(byTeam.entries()),[["old",4],["now",5]]);
 assert.deepEqual(Array.from(byPerson.map(x=>x.name)),[
  "Retired Employee","Moved Employee","Active Employee","Inactive Employee"
 ]);
 assert.deepEqual(Array.from(byPerson.map(x=>x.n)),[3,1,3,2]);
 assert.deepEqual(Array.from(byProduct.entries()),[["NURO",6],["U-NEXT",3]]);
 assert.equal(JSON.stringify(snap),original,"never mutate saved records");
});
test("the real input and ranking UI use separate candidate sets, with retired teams labeled",()=>{
 const start=html.indexOf("function partnerInlineRender(){");
 const end=html.indexOf("\n}\n",start);
 assert(start>=0&&end>start);
 const render=html.slice(start,end+2);
 assert.match(render,/const editableStaff=partnerInlineEditableStaff\(snap\)/);
 assert.match(render,/partnerInlineFillSelect\("pInlineStaff",editableStaff/);
 assert.match(render,/partnerInlineDailyRankingTotals\(snap\)/);
 assert.match(render,/const teamById=new Map\(\(snap\.teams\|\|\[\]\)\.map/);
 assert.match(render,/teamById\.get\(id\)\?\.active===false\?"（過去班）"/);
 assert.match(html,/if\(!partnerInlineEditableStaff\(snap\)\.some\(p=>p\.id===staffId\)\)throw Error\("staff"\)/);
});
test("these count-only helpers do not access, recalculate, or write money or Firestore",()=>{
 assert.doesNotMatch(code,/revenue|price|cashback|\.delete\s*\(|setDoc\s*\(|updateDoc\s*\(|writeBatch\s*\(/i);
});
