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
test("missing partner report is never displayed as a rank, but submitted zero remains ranked",()=>{
 for(const role of ["hub_owner","partner_owner"]){
  const inputValue=input(role);
  inputValue.sources[1].roster.push({uid:"pMissing",name:"未報告担当X",teamId:"team"});
  inputValue.sources[1].roster.push({uid:"pZero",name:"報告済み0件担当",teamId:"team"});
  const r={companyId:"partner",sourceId:"2026-11-08__pZero",uid:"pZero",
   date:"2026-11-08",teamId:"team",totalCount:0,reportStatus:"no_result",
   memberNameSnapshot:"報告済み0件担当",teamNameSnapshot:"第一班",workLocation:""};
  inputValue.sources[1].records.push(r);
  const value=buildVerifiedCountDashboard(inputValue);
  const missing=(role==="hub_owner"?value.memberRanking:value.own.people)
   .find(p=>p.name==="未報告担当X");
  const zero=(role==="hub_owner"?value.memberRanking:value.own.people)
   .find(p=>p.name==="報告済み0件担当");
  assert.equal(missing.rank,null);
  assert(Number.isSafeInteger(zero.rank));
  const root=new Node("main");
  renderVerifiedDualCountDashboard({document:doc,root,payload:value});
  const output=words(root);
  assert(!output.includes("未報告担当X"));
  assert(output.includes("報告済み0件担当"));
  const forgery=structuredClone(value);
  const forged=(role==="hub_owner"?forgery.memberRanking:forgery.own.people)
   .find(p=>p.name==="未報告担当X");
  forged.rank=999;
  assert.throws(()=>renderVerifiedDualCountDashboard({document:doc,root,payload:forgery}),
   /件数の権限/);
  assert.equal(root.children.length,0);
 }
});
test("owner and partner both exclude unreported company/team, but rank a submitted zero",()=>{
 const makeRole=role=>{
  const source=input(role);
  // partner's official 0 report, unlike an unreported blank roster.
  source.sources[1].records[0].totalCount=0;
  source.sources[1].records[0].reportStatus="no_result";
  source.sources[1].lines[0].count=0;
  const silent=src("silent","silentStaff","silentSku",0);
  silent.companyLabel="未報告の会社";
  silent.records=[];silent.lines=[];
  source.approvedCompanyIds.push("silent");
  source.context.approvedCompanyIds.push("silent");
  source.sources.push(silent);
  return buildVerifiedCountDashboard(source);
 };
 const owner=makeRole("hub_owner"),partner=makeRole("partner_owner");
 assert.equal(owner.companyBreakdown.find(x=>x.id==="partner").reportStatus,"確定0件");
 assert.equal(owner.companyBreakdown.find(x=>x.id==="silent").reportStatus,"未報告");
 assert.equal(owner.teamBreakdown.find(x=>x.companyId==="partner").detail.reportStatus,"確定0件");
 assert.equal(owner.teamBreakdown.find(x=>x.companyId==="silent").detail.reportStatus,"未報告");
 assert.deepEqual(partner.publicRanking.companies.map(x=>[x.name,x.count,x.rank]),[
  ["自社",2,1],["協力店A",0,2]
 ]);
 assert.equal(partner.publicRanking.teams.length,2);
 for(const data of [owner,partner]){
  const root=new Node("main");
  renderVerifiedDualCountDashboard({document:doc,root,payload:data});
  const sections=walk(root).filter(x=>x.className==="nico-dual-ranking");
  assert.equal(sections.length,4);
  for(const panel of sections.slice(0,2)){
   const ranks=walk(panel).filter(x=>x.className==="nico-dual-rank-number");
   assert.equal(ranks.length,2,"submitted zero ranks; unreported row stays unranked");
   assert.deepEqual(ranks.map(x=>x.textContent),["1位","2位"]);
   assert(!words(panel).includes("未報告の会社"));
  }
  assert(!/(売上|単価|キャッシュバック|[¥￥])/.test(words(root)));
 }
});
test("partner sees own results and public rankings only, not any hub internal team or finance details",()=>{
 const root=new Node("main"),data=buildVerifiedCountDashboard(input("partner_owner"));
 renderVerifiedDualCountDashboard({document:doc,root,payload:data});
 const text=words(root);
 for(const expected of ["全社獲得件数・合同ランキング","協力店A","3件",
  "個人ランキング","会社ランキング","班ランキング","商材ランキング","自社","第一班"])
  assert(text.includes(expected),expected);
 for(const forbidden of ["班別内訳","会社別内訳","teamId","uid","売上","単価","キャッシュバック","50000円"])
  assert(!text.includes(forbidden),forbidden);
});
test("Owner and partner use the SAME four ranking cards with no duplicate partner-only boards",()=>{
 const order=["会社ランキング","班ランキング","個人ランキング","商材ランキング"];
 for(const role of ["hub_owner","partner_owner"]){
  const root=new Node("main");
  const payload=buildVerifiedCountDashboard(input(role));
  renderVerifiedDualCountDashboard({document:doc,root,payload});
  const panels=walk(root).filter(x=>x.className==="nico-dual-ranking");
  assert.equal(panels.length,4,role);
  const headings=panels.map(panel=>walk(panel)
   .find(x=>x.className==="nico-dual-title")?.textContent);
  assert.deepEqual(headings,order,role);
  const whole=words(root);
  assert(whole.includes("全社獲得件数・合同ランキング"));
  for(const word of ["自分たちの成果・前期比","公開承認済み・会社ランキング",
   "公開承認済み・班ランキング","公開承認済み・個人ランキング",
   "公開承認済み・商材ランキング"])
   assert(!whole.includes(word),role+": "+word);
  assert(!/(売上|単価|キャッシュバック|[¥￥])/.test(whole));
  const person=panels[2];
  assert(words(person).includes("本社担当"));
  assert(words(person).includes("協力店担当"));
  const product=panels[3];
  assert(words(product).includes("NURO"));
  if(role==="partner_owner")for(const forbidden of ["hub:team","partner:team","uid"])
   assert(!whole.includes(forbidden));
 }
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
  d=>{d.publicRanking.teams[0].name="チーム ｕｎｉｔＰｒｉｃｅ５０００";},
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
  d=>{d.memberRanking[0].name="担当 ｒｅｖｅｎｕｅ５００００";},
  d=>{d.productRanking[0].name="ＮＵＲＯ ＣＢ５０００";},
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
 assert.equal(walk(toolbar).filter(x=>x.tagName==="select").length,5,
  "period plus company/team/person/SKU filters");
 assert(walk(toolbar).some(x=>x.tagName==="input"&&x.type==="date"));
 await ctrl.setFilter("companyId","partner");
 assert.equal(calls.at(-1).filters.companyId,"partner");
 assert.equal(calls.at(-1).period.kind,"day");
 assert(words(root).includes("3件"));
 await ctrl.setPeriod("month","2026-11-08");
 assert.equal(calls.at(-1).period.kind,"month");
 ctrl.destroy();assert.equal(root.children.length,0);
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
 assert.equal(selects.length,1,"month only, no fake unsupported company/person filters");
 assert.deepEqual(selects[0].children.map(x=>x.value),["month"]);
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
