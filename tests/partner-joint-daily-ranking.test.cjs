"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs");
const {buildPublicRanking,readCombinedDailyRanking,KEYS,mapCategory}=require("../functions-partner-quick/joint-ranking.cjs");
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const fail=(code="permission-denied")=>{const e=Error(code);e.code=code;throw e;};
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const today="2026-11-01";
class Query{
 constructor(db,path,filters=[]){this.db=db;this.path=path;this.filters=filters;}
 doc(id){return new Ref(this.db,this.path+"/"+id);}
 where(k,op,v){assert.equal(op,"==");return new Query(this.db,this.path,[...this.filters,[k,v]]);}
 limit(n){return {get:async()=>{
   const docs=[...this.db.store.entries()].filter(([path,v])=>
    path.startsWith(this.path+"/")&&!path.slice(this.path.length+1).includes("/")&&
    this.filters.every(([k,value])=>v[k]===value)).slice(0,n).map(([path,v])=>({
     id:path.split("/").at(-1),data:()=>copy(v)
    }));
   return {docs,size:docs.length};
  }};}
}
class Ref{
 constructor(db,path){this.db=db;this.path=path;this.id=path.split("/").at(-1);}
 collection(name){return new Query(this.db,this.path+"/"+name);}
 async get(){const item=this.db.store.get(this.path);return {id:this.id,exists:!!item,data:()=>copy(item)};}
}
class DB{
 constructor(){this.store=new Map();}
 collection(name){return new Query(this,name);}
 seed(path,value){this.store.set(path,copy(value));}
}
const quickAllowed=(rel,grant,id,hub,owner,partnerOwner)=>
 rel.partnerCompanyId===id&&rel.hubCompanyId===hub&&
 (rel.active===true&&rel.countSharingApproved===true||
  rel.active===false&&rel.countSharingApproved===false&&grant?.approved===true&&
   grant.partnerCompanyId===id&&grant.hubCompanyId===hub&&
   grant.partnerOwnerUid===partnerOwner&&grant.approvedByUid===owner);
function fixtures(){
 const db=new DB();
 db.seed("companies/hub",{ownerUid:"hubOwner",active:true,companyKind:"internal"});
 db.seed("companies/p",{ownerUid:"pOwner",active:true,companyKind:"partner",hubCompanyId:"hub",name:"協力店P"});
 db.seed("companies/q",{ownerUid:"qOwner",active:true,companyKind:"partner",hubCompanyId:"hub",name:"協力店Q"});
 db.seed("companies/foreign",{ownerUid:"otherOwner",active:true,companyKind:"partner",hubCompanyId:"else",name:"他社"});
 db.seed("partnerRelations/p",{partnerCompanyId:"p",hubCompanyId:"hub",active:false,countSharingApproved:false});
 db.seed("partnerQuickCountApprovals/p",{partnerCompanyId:"p",hubCompanyId:"hub",partnerOwnerUid:"pOwner",approvedByUid:"hubOwner",approved:true});
 db.seed("partnerRelations/q",{partnerCompanyId:"q",hubCompanyId:"hub",active:true,countSharingApproved:true});
 db.seed("partnerRelations/foreign",{partnerCompanyId:"foreign",hubCompanyId:"else",active:true,countSharingApproved:true});
 db.seed("records/r1",{companyId:"hub",date:today,uid:"a",memberNameSnapshot:"直営A",
  teamId:"teamA",teamNameSnapshot:"直営第1班",totalCount:3,
  results:{nuro:{productName:"NURO光",count:2,revenuePerUnit:100000},
   sb:{productName:"SBMNP",count:1,unitPrice:90000}},totalRevenue:999999});
 db.seed("records/r2",{companyId:"hub",date:today,uid:"b",memberNameSnapshot:"直営B",
  teamId:"teamA",teamNameSnapshot:"直営第1班",totalCount:1,
  results:[{productId:"nuro",productName:"NURO",count:1,unitPrice:12345}]});
 db.seed("records/other",{companyId:"else",date:today,uid:"other",memberNameSnapshot:"他社スタッフ",
  teamId:"other",totalCount:1000,results:[{productName:"NURO",count:1000}]});
 db.seed("companies/hub/partnerQuickCountDays/"+today+"/reports/p",{hubCompanyId:"hub",
  partnerCompanyId:"p",date:today,version:1,counts:{...zero(),NURO:2},totalCount:2});
 db.seed("companies/hub/partnerQuickCountDays/"+today+"/reports/q",{hubCompanyId:"hub",
  partnerCompanyId:"q",date:today,version:1,counts:{...zero(),NURO:99},totalCount:99});
 db.seed("companies/hub/partnerWorkCountDays/"+today+"/reports/q",{source:"staff-entries-v1",
  hubCompanyId:"hub",partnerCompanyId:"q",date:today,
  counts:{...zero(),SBMNP:3},totalCount:3});
 db.seed("companies/q/partnerWorkTeams/tq",{companyId:"q",name:"協力店Q第1班",active:true});
 db.seed("companies/q/partnerWorkEntries/"+today+"__qa",{companyId:"q",hubCompanyId:"hub",
  date:today,staffId:"qa",staffNameSnapshot:"協力店Q担当A",teamIdSnapshot:"tq",
  counts:{...zero(),SBMNP:3},totalCount:3,version:1,
  privateCounts:{},privateTotalCount:0});
 return {db,scope:{kind:"hub",hubId:"hub",cid:"hub"},
  args:{db,date:today,fail,grantRef:id=>db.collection("partnerQuickCountApprovals").doc(id),quickAllowed}};
}
test("real person ranks only: quick company counts join products/teams but cannot fabricate individuals",async()=>{
 const {args,scope}=fixtures();
 const result=await readCombinedDailyRanking({...args,scope});
 assert.equal(result.date,today);assert.equal(result.complete,true);
 assert.equal(result.products.find(x=>x.name==="NURO").count,5); // direct 3 + quick 2
 assert.equal(result.products.find(x=>x.name==="SBMNP").count,4); // direct 1 + staff 3
 assert.equal(result.teams.find(x=>x.name==="協力店P｜会社報告").count,2);
 assert.equal(result.teams.find(x=>x.name==="協力店Q第1班").count,3);
 assert.equal(result.individual.length,3);
 assert.equal(result.individual[0].rank,1);
 assert.equal(result.individual[0].name,"協力店Q担当A"); // tie sorted by company name
 assert.equal(result.individual[1].rank,1);
 assert.equal(result.individual[2].rank,3);
 assert.equal(result.companyOnlyPartnerReports,1);
 assert.equal(JSON.stringify(result).includes("999999"),false);
 for(const needle of ["revenuePerUnit","totalRevenue","unitPrice","privateCounts",
  "partnerOwnerUid","staffId","uid","999999","90000","12345"])
   assert.equal(JSON.stringify(result).includes(needle),false,"leaked "+needle);
});
test("partner sees shared ranks but no other company personal names, finance or raw data",async()=>{
 const {args}=fixtures();const result=await readCombinedDailyRanking({...args,scope:{
   kind:"partner",hubId:"hub",cid:"p"}});
 assert.equal(result.individual.length,3);
 assert.ok(result.individual.every(p=>!p.name.includes("直営A")&&!p.name.includes("協力店Q担当")));
 assert.deepEqual(result.individual.map(x=>x.rank),[1,1,3]);
 assert.equal(result.products.find(x=>x.name==="NURO").count,5);
 assert.equal(JSON.stringify(result).includes("totalRevenue"),false);
});
test("revocation, cross hub, active share and duplicate quick vs staff are enforced without mutation",async()=>{
 const {db,args,scope}=fixtures();const before=copy([...db.store]);
 const a=await readCombinedDailyRanking({...args,scope});assert.equal(a.companyOnlyPartnerReports,1);
 db.seed("partnerQuickCountApprovals/p",{...db.store.get("partnerQuickCountApprovals/p"),approved:false});
 const b=await readCombinedDailyRanking({...args,scope});
 assert.equal(b.products.find(x=>x.name==="NURO").count,3);
 assert.equal(b.companyOnlyPartnerReports,0);
 assert.equal(b.individual.length,3);
 assert.equal(db.store.get("records/r1").totalRevenue,999999);
 assert.deepEqual([...db.store].filter(([p])=>p.startsWith("records/")),
  before.filter(([p])=>p.startsWith("records/")));
});
test("malformed financial-looking names and inconsistent totals fail closed",async()=>{
 const {args,scope,db}=fixtures();
 db.seed("records/r1",{...db.store.get("records/r1"),totalCount:100});
 await assert.rejects(readCombinedDailyRanking({...args,scope}),e=>e.code==="data-loss");
 const source=fs.readFileSync(require.resolve("../functions-partner-quick/joint-ranking.cjs"),"utf8");
 assert.doesNotMatch(source,/\b(?:tx|batch|ref)\.(?:delete|update|create|set)\s*\(/);
 assert.ok(!source.includes("totalRevenue:")&&!source.includes("unitPrice:"));
 assert.equal(mapCategory("エバーグリーン"),"つばさ・HTB");
});
