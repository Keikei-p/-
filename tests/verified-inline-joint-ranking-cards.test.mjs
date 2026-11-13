import test from "node:test";
import assert from "node:assert/strict";
import {buildVerifiedCountDashboard} from "../ranking/verified-dual-count-dashboards.mjs";
import {projectVerifiedInlineJointCards,renderVerifiedInlineJointCards}
 from "../ranking/verified-inline-joint-ranking-cards.mjs";
const TIME="2026-11-13T02:00:00.000Z",DATE="2026-11-13";
const src=(cid,uid,product,n)=>({
 companyId:cid,companyLabel:cid==="hub"?"自社":"協力店A",
 kind:cid==="hub"?"own":"partner",consentVerified:true,isComplete:true,
 readTime:TIME,completeWindows:{current:true,previous:false},
 teams:[{id:"team",name:"一班",goalCount:null}],
 roster:[{uid,name:cid==="hub"?"自社担当":"協力店担当",teamId:"team"}],
 records:[{companyId:cid,sourceId:DATE+"__"+uid,uid,date:DATE,
  teamId:"team",totalCount:n,reportStatus:n===0?"no_result":"submitted",
  memberNameSnapshot:cid==="hub"?"自社担当":"協力店担当",
  teamNameSnapshot:"一班",workLocation:""}],
 lines:[{companyId:cid,sourceId:DATE+"__"+uid+"__0",
  recordId:DATE+"__"+uid,uid,teamId:"team",date:DATE,productId:product,count:n}],
 products:[{companyId:cid,sourceId:product,name:"NURO",active:true,sortOrder:0}]
});
function payload(role,hub=2,partner=3){
 return buildVerifiedCountDashboard({
  hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  context:{serverVerified:true,viewerUid:"testOwner",viewerCompanyId:role==="hub_owner"?"hub":"partner",
   hubCompanyId:"hub",role,approvedCompanyIds:["hub","partner"],
   reciprocalOwnersApproved:true,individualNamesApproved:true,
   userActive:true,memberActive:true,companyActive:true,
   completeSnapshotBudgetApproved:true},
  period:{kind:"day",day:DATE,asOf:DATE},
  productGroups:[{companyId:"hub",productId:"hn",groupId:"NURO",groupName:"NURO"},
   {companyId:"partner",productId:"pn",groupId:"NURO",groupName:"NURO"}],
  sources:[src("hub","owner","hn",hub),src("partner","partnerOwner","pn",partner)]
 });
}
const opts=role=>({expectedRole:role,period:"day",start:DATE,end:DATE});
class Node{
 constructor(tag){this.tagName=tag;this.className="";this.children=[];this.textContent="";}
 appendChild(node){this.children.push(node);return node}
 replaceChildren(...children){this.children=[...children]}
}
const document={createElement:tag=>new Node(tag)};
const roots=()=>Object.fromEntries(["companies","teams","people","products"].map(k=>[k,new Node("div")]));
const walk=root=>[root,...root.children.flatMap(walk)];
const textOf=root=>walk(root).map(x=>x.textContent).filter(Boolean).join(" ");
test("owner and partner existing cards share one verified combined ranking, not partner-only",()=>{
 const projections=["hub_owner","partner_owner"].map(role=>
  projectVerifiedInlineJointCards(payload(role),opts(role)));
 for(const projected of projections){
  assert.equal(projected.companies.length,2);
  assert.deepEqual(projected.companies.map(x=>[x.name,x.count,x.rank]),
   [["協力店A",3,1],["自社",2,2]]);
  assert.equal(projected.teams.length,2);
  assert.equal(projected.people.length,2);
  assert.equal(projected.products.length,1);
  assert.deepEqual([projected.products[0].count,projected.products[0].rank],[5,1]);
  assert(projected.people.some(x=>x.name==="自社担当"));
  assert(projected.people.some(x=>x.name==="協力店担当"));
  assert(!/(売上|単価|収益|cashback|price|revenue|[¥￥])/.test(JSON.stringify(projected)));
 }
 assert.deepEqual(projections[0].companies,projections[1].companies);
 assert.deepEqual(projections[0].teams,projections[1].teams);
 assert.deepEqual(projections[0].people,projections[1].people);
 assert.deepEqual(projections[0].products,projections[1].products);
});
test("both roles render four reusable same-position cards using textContent only",()=>{
 for(const role of ["hub_owner","partner_owner"]){
  const elements=roots();
  const projection=renderVerifiedInlineJointCards({
   document,roots:elements,payload:payload(role),...opts(role)});
  assert.equal(projection.companies.length,2);
  assert(textOf(elements.people).includes("自社担当"));
  assert(textOf(elements.people).includes("協力店担当"));
  assert(textOf(elements.products).includes("5件"));
  assert(textOf(elements.teams).includes("一班"));
  for(const root of Object.values(elements)){
   assert.equal(root.children.length,1);
   assert(!/(売上|単価|キャッシュバック|[¥￥])/.test(textOf(root)));
  }
 }
});
test("unreported staff never acquires a rank, real submitted zero still can",()=>{
 const own=payload("hub_owner",0,0), partner=payload("partner_owner",0,0);
 for(const data of [own,partner]){
  const role=data.role;
  const people=projectVerifiedInlineJointCards(data,opts(role)).people;
  assert.equal(people.length,2);
  assert(people.every(x=>x.count===0&&x.rank===1));
 }
});
test("wrong role, range or injected financial field clears old joined ranks",()=>{
 const elements=roots(),good=payload("partner_owner");
 renderVerifiedInlineJointCards({document,roots:elements,payload:good,...opts("partner_owner")});
 const invalid=structuredClone(good);
 invalid.revenue=90000;
 for(const bad of [invalid,{...good,role:"hub_owner"}]){
  assert.throws(()=>renderVerifiedInlineJointCards({
   document,roots:elements,payload:bad,...opts("partner_owner")}),
   /VERIFIED_INLINE_JOINT_COUNT_BLOCKED/);
  assert(Object.values(elements).every(x=>x.children.length===0));
 }
 assert.throws(()=>projectVerifiedInlineJointCards(good,{
  ...opts("partner_owner"),start:"2026-11-12"}),/VERIFIED_INLINE_JOINT_COUNT_BLOCKED/);
});
test("bad owner product rank is refused before displaying it to a partner",()=>{
 const invalid=payload("hub_owner");
 invalid.productRanking[0].rank=99;
 assert.throws(()=>projectVerifiedInlineJointCards(invalid,opts("hub_owner")));
});
