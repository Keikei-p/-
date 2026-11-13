import test from "node:test";
import assert from "node:assert/strict";
import {buildVerifiedCountDashboard} from "../ranking/verified-dual-count-dashboards.mjs";
import {renderVerifiedDualCountDashboard,createVerifiedDualCountController}
 from "../ranking/verified-dual-count-view.mjs";

const TIME="2026-11-08T02:00:00.000Z";
class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.textContent="";this.className="";
  this.listeners={};this.value="";this.disabled=false;}
 appendChild(child){this.children.push(child);return child;}
 replaceChildren(...items){this.children=[...items];}
 addEventListener(event,fn){(this.listeners[event]??=[]).push(fn);}
 async fire(event){
  for(const listener of this.listeners[event]||[])await listener();
 }
}
const doc={createElement:tag=>new Node(tag)};
const walk=n=>[n,...n.children.flatMap(walk)];
const words=n=>walk(n).map(x=>x.textContent).filter(Boolean).join(" ");
const find=(n,cls)=>walk(n).find(x=>x.className===cls);
function src(cid,person,product,n){
 const r={companyId:cid,sourceId:"2026-11-08__"+person,uid:person,date:"2026-11-08",
  teamId:"team",totalCount:n,reportStatus:n===0?"no_result":"submitted",
  memberNameSnapshot:cid==="hub"?"本社担当":"協力店担当",
  teamNameSnapshot:"第一班",workLocation:""};
 return {companyId:cid,companyLabel:cid==="hub"?"自社":"協力店A",
  kind:cid==="hub"?"own":"partner",consentVerified:true,isComplete:true,
  readTime:TIME,completeWindows:{current:true,previous:false},
  teams:[{id:"team",name:"第一班",goalCount:null}],
  roster:[{uid:person,name:cid==="hub"?"本社担当":"協力店担当",teamId:"team"}],
  records:[r],lines:[{companyId:cid,sourceId:r.sourceId+"__0",
   recordId:r.sourceId,uid:person,teamId:"team",date:r.date,productId:product,count:n}],
  products:[{companyId:cid,sourceId:product,name:"NURO",active:true,sortOrder:0}]};
}
const input=role=>({
 hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
 context:{serverVerified:true,viewerUid:"testOwner",viewerCompanyId:role==="hub_owner"?"hub":"partner",
  hubCompanyId:"hub",role,approvedCompanyIds:["hub","partner"],
  reciprocalOwnersApproved:true,individualNamesApproved:true,
  userActive:true,memberActive:true,companyActive:true,completeSnapshotBudgetApproved:true},
 period:{kind:"day",day:"2026-11-08",asOf:"2026-11-08"},
 productGroups:[
  {companyId:"hub",productId:"hubNuro",groupId:"NURO",groupName:"NURO"},
  {companyId:"partner",productId:"partnerSku01",groupId:"NURO",groupName:"NURO"}],
 sources:[src("hub","owner","hubNuro",2),src("partner","partnerOwner","partnerSku01",3)]
});
test("real aggregate -> owner mobile view: company, two ranking names, all amounts in 件",()=>{
 const root=new Node("main"),data=buildVerifiedCountDashboard(input("hub_owner"));
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 const text=words(root);
 for(const expected of ["全社獲得件数","自社","2件","協力店","3件",
  "全体","5件","会社別内訳","班別内訳","会社ランキング","班ランキング","個人ランキング","商材ランキング","NURO","1位"])
  assert(text.includes(expected),expected);
 assert(!text.includes("売上"));assert(!text.includes("単価"));assert(!text.includes("CB"));
 assert.equal(root.children.length,1);
});
test("internal dashboard presents company/team tied counts as 1,1 without altering original rows",()=>{
 const payload=input("hub_owner");
 payload.sources[0].records[0].totalCount=3;
 payload.sources[0].lines[0].count=3;
 const before=structuredClone(payload),root=new Node("main");
 const data=buildVerifiedCountDashboard(payload);
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 const sections=walk(root).filter(x=>x.className==="nico-dual-ranking");
 assert.equal(sections.length,4);
 for(const section of sections.slice(0,2)){
  const ranks=walk(section).filter(x=>x.className==="nico-dual-rank-number")
   .map(x=>x.textContent);
  assert.deepEqual(ranks,["1位","1位"]);
 }
 assert.deepEqual(payload,before,"presentation cannot change stored count data");
 assert(!words(root).includes("単価"));
 assert(!words(root).includes("キャッシュバック"));
});
test("owner server company/team ranks are verified and unreported companies remain unranked",()=>{
 const good=buildVerifiedCountDashboard(input("hub_owner")),root=new Node("main");
 assert.deepEqual(good.companyBreakdown.map(x=>[x.id,x.rank]),[["hub",2],["partner",1]]);
 assert.deepEqual(good.teamBreakdown.map(x=>[x.companyId,x.rank]),
  [["hub",2],["partner",1]]);
 renderVerifiedDualCountDashboard({document:doc,root,payload:good});
 for(const change of [
  d=>{d.companyBreakdown[0].rank=1;},
  d=>{d.companyBreakdown[1].rank=null;},
  d=>{d.teamBreakdown[0].rank=1;},
  d=>{d.teamBreakdown[0].rank=null;},
  d=>{d.companyBreakdown.push({...d.companyBreakdown[0]});}
 ]){
  const candidate=structuredClone(good);change(candidate);
  assert.throws(()=>renderVerifiedDualCountDashboard({
   document:doc,root,payload:candidate}),/件数の権限/);
  assert.equal(root.children.length,0);
 }
});
test("partner sees own results and public rankings only, not any hub internal team or finance details",()=>{
 const root=new Node("main"),data=buildVerifiedCountDashboard(input("partner_owner"));
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 const text=words(root);
 for(const expected of ["自社の獲得件数・成長","協力店A","3件",
  "自分たちの成果・前期比","公開承認済み・個人ランキング",
  "公開承認済み・会社ランキング","公開承認済み・班ランキング","商材ランキング","自社","第一班"])
  assert(text.includes(expected),expected);
 for(const forbidden of ["班別内訳","会社別内訳","teamId","uid","売上","単価","キャッシュバック","50000円"])
  assert(!text.includes(forbidden),forbidden);
});
test("partner jointly ranks internal company and approved partner teams without exposing team IDs",()=>{
 const root=new Node("main"),data=buildVerifiedCountDashboard(input("partner_owner"));
 assert.deepEqual(data.publicRanking.companies.map(x=>x.rank),[1,2]);
 assert.deepEqual(data.publicRanking.teams.map(x=>x.rank),[1,2]);
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 const text=words(root);
 assert(text.includes("会社ランキング"));
 assert(text.includes("班ランキング"));
 assert(text.includes("協力店A"));
 assert(text.includes("自社"));
 assert(text.includes("第一班"));
 assert(!text.includes("hub:team"));
 assert(!text.includes("partner:team"));
 assert(!text.includes("unitPrice"));
 assert(!text.includes("totalRevenue"));
});
test("shared partner company/team ties are ranked 1,1 (not 1,2), and financial injection fails closed",()=>{
 const same=input("partner_owner");
 same.sources[0].records[0].totalCount=3;
 same.sources[0].lines[0].count=3;
 const root=new Node("main");
 const data=buildVerifiedCountDashboard(same);
 assert.deepEqual(data.publicRanking.companies.map(x=>x.rank),[1,1]);
 assert.deepEqual(data.publicRanking.teams.map(x=>x.rank),[1,1]);
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 assert(words(root).includes("1位"));
 for(const change of [
  d=>{d.publicRanking.companies[0].rank=2;},
  d=>{d.publicRanking.teams[1].rank=2;},
  d=>{d.publicRanking.companies[0].count=-1;},
  d=>{d.publicRanking.teams[0].name="売上50000円";},
  d=>{d.publicRanking.companies[0].unitPrice=99000;},
  d=>{d.publicRanking.teams[0].uid="member-secret";},
  d=>{delete d.publicRanking.companies;},
  d=>{delete d.publicRanking.teams;},
  d=>{d.publicRanking.privateCounts={NURO:10};}
 ]){
  const candidate=structuredClone(data);change(candidate);
  assert.throws(()=>renderVerifiedDualCountDashboard({document:doc,root,payload:candidate}),
   /件数の権限/);
  assert.equal(root.children.length,0,"deny entire result, not partial leaderboard");
  renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 }
});
test("malformed or financial API payload clears stale names and never displays partial data",()=>{
 const root=new Node("main"),good=buildVerifiedCountDashboard(input("hub_owner"));
 renderVerifiedDualCountDashboard({document:doc,root,payload:good});
 assert(words(root).includes("協力店A"));
 for(const change of [
  d=>{d.memberRanking[0].totalRevenue=50000;},
  d=>{d.summary.revenue=50000;},
  d=>{d.companyBreakdown[0].name="NURO_CB50000";},
  d=>{d.memberRanking[0].name="担当 9000円";},
  d=>{d.role="partner_owner";},
  d=>{d.schema="forged";},
  d=>{d.productRanking[0].privateCounts={CB:50000};}
 ]){
  const candidate=structuredClone(good);change(candidate);
  assert.throws(()=>renderVerifiedDualCountDashboard({document:doc,root,payload:candidate}),
   /件数の権限/);
  assert.equal(root.children.length,0);
  assert(!words(root).includes("協力店A"));
  renderVerifiedDualCountDashboard({document:doc,root,payload:good});
 }
});
test("partner ranking renderer rejects NFKC disguised financial labels and keys",()=>{
 const good=buildVerifiedCountDashboard(input("partner_owner"));
 const root=new Node("main");
 renderVerifiedDualCountDashboard({document:doc,root,payload:good});
 for(const mutate of [
  d=>{d.publicRanking.companies[0].name="協力店 ＣＢ２００００";},
  d=>{d.publicRanking.members[0].name="担当 ＣＢ２００００";},
  d=>{d.publicRanking.products[0]["ｒｅｖｅｎｕｅ"]=50000;}
 ]){
  const invalid=structuredClone(good);mutate(invalid);
  assert.throws(()=>renderVerifiedDualCountDashboard({
   document:doc,root,payload:invalid
  }),/件数の権限/);
  assert.equal(root.children.length,0,"invalid financial payload must clear stale content");
  renderVerifiedDualCountDashboard({document:doc,root,payload:good});
 }
});

test("server-bound controller refresh uses only period/filters and supports owner dropdown filtering",async()=>{
 const auth={currentUser:{uid:"owner",emailVerified:true,getIdToken:async()=>{}}};
 const calls=[],root=new Node("main");
 const load=async ({period,filters})=>{
  calls.push({period,filters});
  return buildVerifiedCountDashboard({
   ...input("hub_owner"),period,filters
  });
 };
 const ctrl=createVerifiedDualCountController({
  document:doc,root,auth,load,asOf:"2026-11-08"
 });
 assert.equal(await ctrl.refresh(),true);
 assert.equal(calls.length,1);
 const toolbar=find(root,"nico-dual-controls");
 assert(toolbar,"interactive filters on the dashboard");
 assert.equal(walk(toolbar).filter(x=>x.tagName==="select").length,6,
  "period, server-verified audience, company/team/person/SKU filters");
 assert(walk(toolbar).some(x=>x.tagName==="input"&&x.type==="date"));
 await ctrl.setFilter("companyId","partner");
 assert.equal(calls.at(-1).filters.companyId,"partner");
 assert.equal(calls.at(-1).period.kind,"day");
 assert(words(root).includes("3件"));
 await ctrl.setPeriod("month","2026-11-08");
 assert.equal(calls.at(-1).period.kind,"month");
 ctrl.destroy();assert.equal(root.children.length,0);
});
test("same local team IDs in two companies never collide in the Owner filter UI",async()=>{
 const auth={currentUser:{uid:"owner",emailVerified:true,getIdToken:async()=>""}};
 const root=new Node("main"),calls=[];
 const ctrl=createVerifiedDualCountController({
  document:doc,root,auth,asOf:"2026-11-08",
  load:async ({period,filters})=>{
   calls.push({...filters});
   return buildVerifiedCountDashboard({...input("hub_owner"),period,filters});
  }
 });
 assert.equal(await ctrl.refresh(),true);
 const selections=()=>walk(find(root,"nico-dual-controls"))
  .filter(node=>node.tagName==="select");
 const get=(index)=>selections()[index];
 assert.deepEqual(get(3).children.map(x=>x.value),[""],
  "unscoped team IDs cannot silently merge two companies");
 assert.deepEqual(get(4).children.map(x=>x.value),[""],
  "unscoped staff identifiers are not cross-company selections");
 assert.throws(()=>ctrl.setFilter("teamId","team"),/件数の権限/);
 assert.throws(()=>ctrl.setFilter("uid","owner"),/件数の権限/);
 assert.equal(await ctrl.setFilter("companyId","partner"),true);
 assert.deepEqual(get(3).children.map(x=>x.value),["","team"]);
 assert.deepEqual(get(4).children.map(x=>x.value),["","partnerOwner"]);
 assert.equal(await ctrl.setFilter("teamId","team"),true);
 assert.equal(calls.at(-1).companyId,"partner");
 assert.equal(calls.at(-1).teamId,"team");
 assert.equal(await ctrl.setFilter("uid","partnerOwner"),true);
 assert.equal(await ctrl.setFilter("companyId","hub"),true);
 assert.deepEqual(calls.at(-1),{companyId:"hub"},
  "old company team/staff filter must be removed atomically");
 assert.deepEqual(get(3).children.map(x=>x.value),["","team"]);
 assert.deepEqual(get(4).children.map(x=>x.value),["","owner"]);
 assert(!words(root).includes("単価"));
 ctrl.destroy();
});

test("canonical month-only controller renders month picker without unsupported daily/filter actions",async()=>{
 const auth={currentUser:{uid:"owner",emailVerified:true,getIdToken:async()=>{}}};
 const root=new Node("main"),calls=[];
 const ctrl=createVerifiedDualCountController({
  document:doc,root,auth,asOf:"2026-11-08",
  availablePeriods:["month"],allowFilters:false,
  load:async ({period,filters})=>{
   calls.push({period,filters});
   return buildVerifiedCountDashboard({...input("partner_owner"),period});
  }
 });
 assert.equal(await ctrl.refresh(),true);
 const toolbar=find(root,"nico-dual-controls");
 const selects=walk(toolbar).filter(x=>x.tagName==="select");
 assert.equal(selects.length,2,"month and public scope; no company/person filters");
 assert.deepEqual(selects[0].children.map(x=>x.value),["month"]);
 assert.deepEqual(selects[1].children.map(x=>[x.value,x.disabled]),
  [["joint",false],["own",true],["partner",true]],
  "legacy unscoped responses cannot enable unsupported scopes");
 const month=walk(toolbar).find(x=>x.tagName==="input");
 assert.equal(month.type,"month");
 assert.equal(month.value,"2026-11");
 assert.deepEqual(calls[0].filters,{});
 assert.equal(calls[0].period.kind,"month");
 assert.throws(()=>ctrl.setPeriod("day","2026-11-08"),/件数の権限/);
 assert.throws(()=>ctrl.setFilter("companyId","hub"),/件数の権限/);
 assert.equal(calls.length,1);
 ctrl.destroy();
});
test("auth switch while GET pending never displays former company's results",async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});
 const old={uid:"owner",emailVerified:true,getIdToken:async()=>{}};
 const auth={currentUser:old},root=new Node("main");
 const ctrl=createVerifiedDualCountController({
  document:doc,root,auth,asOf:"2026-11-08",
  load:async()=>{await pending;return buildVerifiedCountDashboard(input("hub_owner"));}
 });
 const result=ctrl.refresh();
 auth.currentUser={uid:"other",emailVerified:true,getIdToken:async()=>{}};
 ctrl.onAuthChange();resolve();
 assert.equal(await result,false);
 assert.equal(root.children.length,0);
});
test("bad login, company filter attack and server errors do not reuse private earlier results",async()=>{
 const root=new Node("main"),auth={currentUser:null};
 const ctrl=createVerifiedDualCountController({
  document:doc,root,auth,asOf:"2026-11-08",
  load:async()=>buildVerifiedCountDashboard(input("hub_owner"))
 });
 assert.equal(await ctrl.refresh(),false);
 assert.equal(root.children.length,0);
 assert.throws(()=>ctrl.setFilter("companyId","../../other"));
 assert.throws(()=>ctrl.setPeriod("month","2026-11-32"));
 ctrl.destroy();
});

test("count dashboard DOM visually separates unreported from confirmed zero",()=>{
 for(const role of ["hub_owner","partner_owner"]){
  const original=input(role),company=original.sources[1];
  company.roster.push({uid:"missing",name:"未報告スタッフ",teamId:"team"});
  company.roster.push({uid:"zero",name:"報告済0件",teamId:"team"});
  company.records.push({companyId:"partner",
   sourceId:"2026-11-08__zero",uid:"zero",date:"2026-11-08",
   teamId:"team",totalCount:0,reportStatus:"no_result",
   memberNameSnapshot:"報告済0件",teamNameSnapshot:"第一班",workLocation:""});
  const before=structuredClone(original),root=new Node("main");
  const data=buildVerifiedCountDashboard(original);
  renderVerifiedDualCountDashboard({document:doc,root,payload:data});
  const findRow=name=>walk(root).find(node=>
   node.className==="nico-dual-rank-row"&&node.children.some(child=>
    child.className==="nico-dual-rank-name"&&child.textContent===name));
  const missing=findRow("未報告スタッフ"),reportedZero=findRow("報告済0件");
  if(role==="hub_owner"){
   assert(missing,"hub Owner sees unreported in own private scope only");
  }else{
   assert(missing,"partner Owner still sees own unreported staff");
   assert(!data.publicRanking.members.some(x=>x.name==="未報告スタッフ"));
  }
  assert(reportedZero,"explicit zero must remain listed and ranked");
  const metric=(row,cls)=>row.children.find(x=>x.className===cls)?.textContent;
  assert.equal(metric(missing,"nico-dual-rank-number"),"—");
  assert.equal(metric(missing,"nico-dual-rank-score"),"未報告");
  assert.match(metric(reportedZero,"nico-dual-rank-number"),/^[1-9][0-9]*位$/);
  assert.equal(metric(reportedZero,"nico-dual-rank-score"),"0件");
  assert.deepEqual(original,before,"DOM rendering never mutates count originals");
 }
});

test("hub Owner count-only scope filters the same verified companies, teams, people, products",()=>{
 const data=buildVerifiedCountDashboard(input("hub_owner")),snapshot=structuredClone(data);
 const root=new Node("main");
 const render=audience=>{
  renderVerifiedDualCountDashboard({document:doc,root,payload:data,audience});
  return words(root);
 };
 assert(render("joint").includes("5件"));
 const own=render("own");
 assert(own.includes("ランキング表示：自社のみ"));
 assert(own.includes("本社担当"));assert(own.includes("2件"));
 assert(!own.includes("協力店担当"));assert(!own.includes("3件"));
 let ranks=walk(root).filter(x=>x.className==="nico-dual-ranking");
 assert.equal(ranks.length,4);
 assert.deepEqual(walk(ranks[0]).filter(x=>x.className==="nico-dual-rank-score")
  .map(x=>x.textContent),["2件"]);
 const partner=render("partner");
 assert(partner.includes("ランキング表示：協力店のみ"));
 assert(partner.includes("協力店担当"));assert(partner.includes("3件"));
 assert(!partner.includes("本社担当"));assert(!partner.includes("2件"));
 ranks=walk(root).filter(x=>x.className==="nico-dual-ranking");
 assert.deepEqual(walk(ranks[0]).filter(x=>x.className==="nico-dual-rank-score")
  .map(x=>x.textContent),["3件"]);
 assert.deepEqual(data,snapshot,"changing scopes must never mutate published counts");
 for(const unsafe of ["private","",null]){
  assert.throws(()=>renderVerifiedDualCountDashboard({document:doc,root,payload:data,audience:unsafe}),
   /件数の権限/);
  assert.equal(root.children.length,0);
 }
});

test("hub Owner selector reloads only verified count GET without passing client audience as role",async()=>{
 const owner={uid:"owner",emailVerified:true,getIdToken:async()=>"stub"};
 const auth={currentUser:owner},root=new Node("main"),calls=[];
 const ctrl=createVerifiedDualCountController({
  document:doc,root,auth,asOf:"2026-11-08",
  availablePeriods:["month"],allowFilters:false,
  load:async args=>{calls.push(args);return buildVerifiedCountDashboard({
   ...input("hub_owner"),period:args.period
  });}
 });
 assert.equal(await ctrl.refresh(),true);
 const toolbar=find(root,"nico-dual-controls");
 const selects=walk(toolbar).filter(x=>x.tagName==="select");
 assert.equal(selects.length,2,"month and joint/own/partner scope");
 assert.deepEqual(selects[1].children.map(o=>o.value),["joint","own","partner"]);
 assert.equal(await ctrl.setAudience("partner"),true);
 assert(words(root).includes("ランキング表示：協力店のみ"));
 assert(!words(root).includes("本社担当"));
 assert.deepEqual(calls.at(-1).filters,{});
 assert.deepEqual(Object.keys(calls.at(-1)).sort(),["filters","period","scope"]);
 assert.equal(calls.at(-1).scope,"partner");
 assert.equal(await ctrl.setAudience("own"),true);
 assert(words(root).includes("本社担当"));
 assert(!words(root).includes("協力店担当"));
 assert.throws(()=>ctrl.setAudience("hidden"),/件数の権限/);
 ctrl.onAuthChange();
 assert.equal(root.children.length,0,"identity switch clears the selected ranking");
 ctrl.destroy();
});

test("partner audience cannot claim hub-only internal or alternate company boards",()=>{
 const data=buildVerifiedCountDashboard(input("partner_owner")),root=new Node("main");
 for(const scope of ["own","partner"]){
  assert.throws(()=>renderVerifiedDualCountDashboard({
   document:doc,root,payload:data,audience:scope
  }),/件数の権限/);
  assert.equal(root.children.length,0);
 }
});

test("server-approved partner scopes reconcile all four boards for day, week and month without exposing IDs",()=>{
 for(const kind of ["day","week","month"]){
  const original={...input("partner_owner"),period:{kind,day:"2026-11-08",asOf:"2026-11-08"}};
  const before=structuredClone(original);
  for(const [scope,total] of [["joint",5],["own",2],["partner",3]]){
   const data=buildVerifiedCountDashboard({...original,scope});
   assert.equal(data.scope,scope);
   assert.equal(data.own.count,3,"own-company detail is independent of the public scope");
   for(const rows of Object.values(data.publicRanking)){
    assert.equal(rows.reduce((n,x)=>n+x.count,0),total);
    assert.equal(rows[0].rank,1,"each selected scope starts at rank one");
   }
   assert.doesNotMatch(JSON.stringify(data.publicRanking),/companyId|teamId|uid|hubNuro|partnerSku|revenue|unitPrice/);
   const root=new Node("main");
   renderVerifiedDualCountDashboard({document:doc,root,payload:data,audience:scope});
   assert(words(root).includes({joint:"合同",own:"自社のみ",partner:"協力店のみ"}[scope]));
   assert.throws(()=>renderVerifiedDualCountDashboard({document:doc,root,payload:data,
    audience:scope==="joint"?"own":"joint"}),/件数の権限/);
  }
  assert.deepEqual(original,before,"scope changes never rewrite original counts");
 }
});

test("scoped public rankings keep submitted zero and exclude unreported staff and companies",()=>{
 const original=input("partner_owner");
 original.sources[1]=src("partner","partnerOwner","partnerSku01",0);
 const zero=buildVerifiedCountDashboard({...original,scope:"partner"});
 for(const rows of Object.values(zero.publicRanking)){
  assert.equal(rows.length,1);assert.equal(rows[0].count,0);assert.equal(rows[0].rank,1);
 }
 original.sources[1].records=[];original.sources[1].lines=[];
 const missing=buildVerifiedCountDashboard({...original,scope:"partner"});
 assert.deepEqual(missing.publicRanking,{members:[],products:[],companies:[],teams:[]});
});

test("partner scope selector fetches the requested public scope and resets on account change",async()=>{
 const auth={currentUser:{uid:"partnerOwner",emailVerified:true,getIdToken:async()=>"stub"}},root=new Node("main"),calls=[];
 let wrongEcho=false;
 const ctrl=createVerifiedDualCountController({document:doc,root,auth,asOf:"2026-11-08",
  availablePeriods:["day","week","month"],allowFilters:false,
  load:async args=>{calls.push(args);return buildVerifiedCountDashboard({
   ...input("partner_owner"),period:args.period,scope:wrongEcho?"joint":args.scope});}
 });
 assert.equal(await ctrl.refresh(),true);assert.equal(calls[0].scope,"joint");
 const scopes=walk(find(root,"nico-dual-controls")).filter(x=>x.tagName==="select")[1];
 assert.deepEqual(scopes.children.map(x=>[x.value,x.disabled]),
  [["joint",false],["own",false],["partner",false]]);
 for(const scope of ["own","partner"]){assert.equal(await ctrl.setAudience(scope),true);assert.equal(calls.at(-1).scope,scope);}
 wrongEcho=true;assert.equal(await ctrl.setAudience("own"),false);
 assert(!words(root).includes("会社ランキング"),"a wrong-scope response never renders");
 ctrl.onAuthChange();wrongEcho=false;
 assert.equal(await ctrl.refresh(),true);assert.equal(calls.at(-1).scope,"joint");
 ctrl.destroy();
});


test("partner shows four joint leaderboard sections in exactly the hub order before own results",()=>{
 const root=new Node("main"),data=buildVerifiedCountDashboard(input("partner_owner"));
 const frozen=structuredClone(data);
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 const titles=walk(root).filter(x=>x.className==="nico-dual-ranking")
  .map(section=>find(section,"nico-dual-title")?.textContent);
 assert.deepEqual(titles,[
  "公開承認済み・会社ランキング",
  "公開承認済み・班ランキング",
  "公開承認済み・個人ランキング",
  "公開承認済み・商材ランキング",
  "自分たちの成果・前期比",
  "自社の商材別件数"
 ]);
 const text=words(root);
 assert(text.includes("合同ランキング（公開承認済み・件数のみ）"));
 assert(text.includes("自分の会社の件数内訳"));
 for(const privateValue of ["単価","キャッシュバック","50000円","totalRevenue"])
  assert(!text.includes(privateValue));
 assert.deepEqual(data,frozen,"partner UI must not mutate verified counts");
});

test("own partner SKU ranking keeps count ties as 1,1 without affecting public joint ranks",()=>{
 const value=input("partner_owner"),partner=value.sources[1];
 partner.records[0].totalCount=4;
 partner.lines[0].count=2;
 partner.lines.push({...partner.lines[0],
  sourceId:partner.lines[0].recordId+"__1",productId:"partnerSku02",count:2});
 partner.products.push({companyId:"partner",sourceId:"partnerSku02",
  name:"U-NEXT",active:true,sortOrder:1});
 value.productGroups.push({companyId:"partner",productId:"partnerSku02",
  groupId:"U-NEXT",groupName:"U-NEXT"});
 const snapshot=structuredClone(value);
 const data=buildVerifiedCountDashboard(value),root=new Node("main");
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 const sections=walk(root).filter(x=>x.className==="nico-dual-ranking");
 const ownProduct=sections[5],ranks=walk(ownProduct)
  .filter(x=>x.className==="nico-dual-rank-number")
  .map(x=>x.textContent);
 assert.deepEqual(ranks,["1位","1位"]);
 assert(words(sections[3]).includes("公開承認済み・商材ランキング"));
 assert.deepEqual(value,snapshot,"ranking ties must not rewrite source rows");
});


test("hub leaderboard excludes unreported company and keeps saved zero",()=>{
 const missing=input("hub_owner");
 missing.sources[1].records=[];missing.sources[1].lines=[];
 const original=structuredClone(missing),root=new Node("main");
 renderVerifiedDualCountDashboard({document:doc,root,
  payload:buildVerifiedCountDashboard(missing)});
 const sections=walk(root).filter(x=>x.className==="nico-dual-ranking");
 const companies=sections.find(x=>words(x).includes("会社ランキング"));
 assert(companies);assert(words(companies).includes("自社"));
 assert(!words(companies).includes("協力店A"));
 assert(words(root).includes("未報告"));
 assert.deepEqual(missing,original);
 const zero=input("hub_owner");
 zero.sources[1].records[0].totalCount=0;
 zero.sources[1].records[0].reportStatus="no_result";
 zero.sources[1].lines[0].count=0;
 const zeroRoot=new Node("main");
 renderVerifiedDualCountDashboard({document:doc,root:zeroRoot,
  payload:buildVerifiedCountDashboard(zero)});
 const ranked=walk(zeroRoot).filter(x=>x.className==="nico-dual-ranking")
  .find(x=>words(x).includes("会社ランキング"));
 assert(words(ranked).includes("協力店A"));
 assert(words(ranked).includes("0件"));
});
