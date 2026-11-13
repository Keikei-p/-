import test from "node:test";
import assert from "node:assert/strict";
import {verifiedJointCountView,createVerifiedJointRankingPanel,jointRankingEndpoint}
 from "../ranking/verified-joint-ranking-panel.mjs";
class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.textContent="";}
 appendChild(node){this.children.push(node);return node;}
 replaceChildren(...nodes){this.children=nodes;}
}
const document={createElement:tag=>new Node(tag)};
const allText=root=>[root.textContent,...root.children.map(allText)].join(" ");
const user={uid:"owner",emailVerified:true,getIdToken:async()=>"a".repeat(40)};
const make=(role="hub_owner")=>({
 schema:"nico-verified-dual-count-v1",period:"month",role,unit:"件",
 readTime:"2026-11-09T00:00:00.000Z",
 range:{start:"2026-11-01",end:"2026-11-09",
 previousStart:"2026-10-01",previousEnd:"2026-10-09",days:9},
 ...(role==="hub_owner"?{
  summary:{own:3,partner:5,total:8,unidentified:0},
  memberRanking:[
   {id:"hub:one",rank:1,name:"田中",companyName:"自社",count:5},
   {id:"partner:two",rank:2,name:"鈴木",companyName:"協力店",count:3}
  ],
  productRanking:[{id:"nuro",rank:1,name:"NURO光",count:8}],
  companyBreakdown:[
   {id:"hub",name:"自社",kind:"自社",count:3,unidentifiedCount:0},
   {id:"partner",name:"協力店",kind:"協力店",count:5,unidentifiedCount:0}],
  teamBreakdown:[
   {id:"hub:team",companyId:"hub",companyName:"自社",name:"営業班",count:3},
   {id:"partner:team",companyId:"partner",companyName:"協力店",name:"営業班",count:5}]
 }:{
  own:{company:"協力店",count:5,people:[],products:[],unidentifiedCount:0},
  publicRanking:{members:[
   {rank:1,company:"自社",name:"佐藤",count:5},
   {rank:1,company:"協力店",name:"佐藤",count:5}
  ],products:[{rank:1,name:"NURO光",count:8}],
  companies:[{rank:1,name:"協力店",count:5},{rank:2,name:"自社",count:3}],
  teams:[{rank:1,name:"営業班",company:"協力店",count:5},
   {rank:2,name:"営業班",company:"自社",count:3}]}
 })
});
test("same ON-only joint numbers render for owner without any financial data",()=>{
 const view=verifiedJointCountView(make(),{month:"2026-11",role:"hub_owner"});
 assert.equal(view.total,8);
 assert.equal(view.ownCount,3);
 assert.deepEqual(view.products.map(x=>[x.name,x.count]),[["NURO光",8]]);
 assert.equal(view.people.length,2);
});
test("unreported staff retained for Owner audit cannot acquire a public leaderboard rank",()=>{
 const payload=make();
 payload.memberRanking.push({id:"partner:missing",rank:null,name:"未報告の担当者",
  companyName:"協力店",count:0,reportStatus:"未報告"});
 const view=verifiedJointCountView(payload,{month:"2026-11",role:"hub_owner"});
 assert.equal(view.people.length,2);
 assert(!view.people.some(row=>row.name==="未報告の担当者"));
 for(const edit of [
  r=>r.memberRanking.at(-1).rank=3,
  r=>r.memberRanking.at(-1).reportStatus="報告済",
  r=>r.memberRanking.at(-1).count=1
 ]){
  const invalid=structuredClone(payload);edit(invalid);
  assert.throws(()=>verifiedJointCountView(invalid,{month:"2026-11",role:"hub_owner"}),
   /JOINT_RANKING_RESPONSE_UNVERIFIED/);
 }
});
test("partner projection safely handles tied rank and repeated names without personal IDs",()=>{
 const view=verifiedJointCountView(make("partner_owner"),{
  month:"2026-11",role:"partner_owner"
 });
 assert.equal(view.total,null);
 assert.equal(view.ownCount,5);
 assert.equal(view.people.length,2);
 assert.equal(view.people[0].rank,view.people[1].rank);
 assert.notEqual(view.people[0].id,view.people[1].id);
});
test("public and Owner rankings reject count-to-rank contradictions before display",()=>{
 for(const role of ["hub_owner","partner_owner"]){
  const data=make(role);
  const edits=role==="hub_owner"?[
   r=>r.memberRanking[1].count=5, // equal count cannot have a different rank
   r=>r.memberRanking[1].rank=1, // different counts cannot tie
   r=>{r.memberRanking[0].rank=2;r.memberRanking[1].rank=1;},
   r=>{r.productRanking.push({id:"extra",rank:1,name:"別商材",count:1});}
  ]:[
   r=>r.publicRanking.members[1].rank=2,
   r=>r.publicRanking.companies[1].rank=1,
   r=>{r.publicRanking.teams[0].rank=2;r.publicRanking.teams[1].rank=1;},
   r=>{r.publicRanking.products.push({rank:1,name:"別商材",count:1});}
  ];
  for(const edit of edits){
   const invalid=structuredClone(data);edit(invalid);
   assert.throws(()=>verifiedJointCountView(invalid,{
    month:"2026-11",role
   }),/JOINT_RANKING_RESPONSE_UNVERIFIED/);
  }
 }
});
test("omitted private ranks can leave a gap without changing valid order",()=>{
 const data=make("partner_owner");
 data.publicRanking.companies[1].rank=3;
 assert.deepEqual(verifiedJointCountView(data,{
  month:"2026-11",role:"partner_owner"
 }).companies.map(x=>x.rank),[1,3]);
});
test("wrong role, bad summary, malicious names and injected money stop before rendering",()=>{
 for(const modify of [
  r=>r.role="partner_owner",
  r=>r.summary.total=100,
  r=>r.productRanking[0].revenue=20000,
  r=>r.memberRanking[0].name="売上1万円",
  r=>r.memberRanking[0].count=-1,
  r=>r.memberRanking[0].name="<script>ab</script>",
  r=>r.readTime="not-time"
 ]){
  const raw=make();modify(raw);
  // markup is never interpreted; script-shaped names are safe as text.
  if(raw.memberRanking?.[0]?.name?.startsWith("<script>")){
   const v=verifiedJointCountView(raw,{month:"2026-11",role:"hub_owner"});
   assert.equal(v.people[0].name,"<script>ab</script>");
  }else assert.throws(
   ()=>verifiedJointCountView(raw,{month:"2026-11",role:"hub_owner"}),
   /JOINT_RANKING_RESPONSE_UNVERIFIED/
  );
 }
});
test("disabled release flag causes zero network calls, zero data exposure",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 let calls=0;
 const view=createVerifiedJointRankingPanel({
  document,root,auth,featureEnabled:false,
  fetchApi:async()=>{calls++;return {ok:true,json:async()=>make()}},
  roleProvider:()=> "hub_owner"
 });
 assert.equal(await view.refresh("2026-11"),false);
 assert.equal(calls,0);
 assert.equal(allText(root),"");
});
test("enabled view fetches only token-authenticated month count response and renders text",async()=>{
 const root=new Node("main"),auth={currentUser:user},requests=[];
 const view=createVerifiedJointRankingPanel({
  document,root,auth,featureEnabled:true,
  fetchApi:async(url,opts)=>{requests.push({url,opts});return {
   ok:true,json:async()=>make()
  }},
  roleProvider:()=> "hub_owner"
 });
 assert.equal(await view.refresh("2026-11"),true);
 assert.equal(view.getActiveUid(),"owner");
 assert.deepEqual(requests.map(x=>x.url),[
  "https://nico-factory.web.app/v1/owner-visible-counts?month=2026-11"
 ]);
 assert.equal(requests[0].opts.method,"GET");
 assert.equal(requests[0].opts.headers.Authorization,"Bearer "+"a".repeat(40));
 assert(allText(root).includes("合同合計 8件"));
 assert(allText(root).includes("NURO光"));
 assert(!allText(root).includes("単価"));
 view.destroy();
 assert.equal(view.getActiveUid(),null);
 assert.equal(root.children.length,0);
});
test("account switch while network is pending blocks old company's response",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 let finish;const pending=new Promise(resolve=>{finish=resolve});
 let called=0;
 const view=createVerifiedJointRankingPanel({
  document,root,auth,featureEnabled:true,
  fetchApi:async()=>{called++;return pending},
  roleProvider:()=> "hub_owner"
 });
 const action=view.refresh("2026-11");
 for(let i=0;i<20&&called===0;i++)await Promise.resolve();
 auth.currentUser={uid:"other",emailVerified:true,getIdToken:async()=>"b".repeat(40)};
 view.onAuthChange();
 finish({ok:true,json:async()=>make()});
 assert.equal(await action,false);
 assert.equal(root.children.length,0);
 assert.equal(view.getActiveUid(),null);
});
test("server error never claims success, and preserves original counts",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const view=createVerifiedJointRankingPanel({
  document,root,auth,featureEnabled:true,
  fetchApi:async()=>({ok:false}),
  roleProvider:()=> "hub_owner"
 });
 assert.equal(await view.refresh("2026-11"),false);
 assert(allText(root).includes("確認できません"));
 assert(!allText(root).includes("合同合計"));
});

test("direct Function ingress is a fixed, explicitly selected count-only destination",async()=>{
 assert.equal(jointRankingEndpoint(),
  "https://nico-factory.web.app/v1/owner-visible-counts");
 assert.equal(jointRankingEndpoint("direct-function"),
  "https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking");
 const root=new Node("main"),auth={currentUser:user},requests=[];
 const panel=createVerifiedJointRankingPanel({
  document,root,auth,featureEnabled:true,transport:"direct-function",
  fetchApi:async(url,opts)=>{
   requests.push({url,opts});return {ok:true,json:async()=>make()};
  },
  roleProvider:()=> "hub_owner"
 });
 assert.equal(await panel.refresh("2026-11"),true);
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,
  "https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking?month=2026-11");
 assert.equal(requests[0].opts.method,"GET");
 assert.equal(requests[0].opts.cache,"no-store");
 assert.equal(requests[0].opts.headers.Authorization,"Bearer "+"a".repeat(40));
 assert(!requests[0].url.includes("a".repeat(40)));
 assert(!("body" in requests[0].opts));
 assert(allText(root).includes("合同合計 8件"));
 panel.destroy();
});
test("untrusted URL, token destination and misspelled transport fail before any network",()=>{
 const auth={currentUser:user},root=new Node("main");
 let requests=0;
 for(const transport of [
  "https://evil.example/collect","javascript:alert(1)","function",
  "/getVerifiedJointCountRanking","Direct-Function",null,{},[]
 ]){
  assert.throws(()=>jointRankingEndpoint(transport),
   /JOINT_RANKING_RESPONSE_UNVERIFIED/);
  assert.throws(()=>createVerifiedJointRankingPanel({
   document,root,auth,featureEnabled:true,transport,
   fetchApi:async()=>{requests++;return {ok:true,json:async()=>make()}},
   roleProvider:()=> "hub_owner"
  }),/JOINT_RANKING_RESPONSE_UNVERIFIED/);
 }
 assert.equal(requests,0);
});
test("direct Function stays inert until explicitly enabled",async()=>{
 let requests=0;
 const panel=createVerifiedJointRankingPanel({
  document,root:new Node("main"),auth:{currentUser:user},
  featureEnabled:false,transport:"direct-function",
  fetchApi:async()=>{requests++;throw Error("NETWORK_FORBIDDEN_WHEN_DISABLED")},
  roleProvider:()=> "hub_owner"
 });
 assert.equal(await panel.refresh("2026-11"),false);
 assert.equal(requests,0);
});

test("same-named employees from different companies remain distinguishable in partner rankings",async()=>{
 const root=new Node("main"),auth={currentUser:user};
 const view=createVerifiedJointRankingPanel({
  document,root,auth,featureEnabled:true,
  fetchApi:async()=>({ok:true,json:async()=>make("partner_owner")}),
  roleProvider:()=> "partner_owner"
 });
 assert.equal(await view.refresh("2026-11"),true);
 const content=allText(root);
 assert(content.includes("佐藤（自社）"));
 assert(content.includes("佐藤（協力店）"));
 assert.equal(content.split("佐藤（").length-1,2);
 assert(!content.includes("売上"));
 view.destroy();
});
test("owner sees different company labels for equally named employees",async()=>{
 const root=new Node("main");
 const raw=make();
 raw.memberRanking[0].name="佐藤";
 raw.memberRanking[1].name="佐藤";
 const view=createVerifiedJointRankingPanel({
  document,root,auth:{currentUser:user},featureEnabled:true,
  fetchApi:async()=>({ok:true,json:async()=>raw}),
  roleProvider:()=> "hub_owner"
 });
 assert.equal(await view.refresh("2026-11"),true);
 assert(allText(root).includes("佐藤（自社）"));
 assert(allText(root).includes("佐藤（協力店）"));
});
test("ranking never displays a different requested month or impossible calendar range",async()=>{
 for(const change of [
  r=>r.range.start="2026-10-01",
  r=>r.range.end="2026-10-31",
  r=>r.range.end="2026-11-31",
  r=>r.range.end="2026-11-00",
  r=>r.range.days=31,
  r=>r.range.days=0,
  r=>r.range.days=9.5
 ]){
  const raw=make();change(raw);
  assert.throws(()=>verifiedJointCountView(raw,{month:"2026-11",role:"hub_owner"}),
   /JOINT_RANKING_RESPONSE_UNVERIFIED/);
 }
 const root=new Node("main"),raw=make();
 raw.range.start="2026-10-01";
 const view=createVerifiedJointRankingPanel({
  document,root,auth:{currentUser:user},featureEnabled:true,
  fetchApi:async()=>({ok:true,json:async()=>raw}),
  roleProvider:()=> "hub_owner"
 });
 assert.equal(await view.refresh("2026-11"),false);
 assert(!allText(root).includes("合同合計"));
 assert(allText(root).includes("確認できません"));
});
test("injected financial or malformed organization labels never appear",()=>{
 for(const label of ["自社の売上1万円","協力店 3000円",null,""]){
  const raw=make("partner_owner");
  raw.publicRanking.members[0].company=label;
  assert.throws(()=>verifiedJointCountView(raw,{month:"2026-11",role:"partner_owner"}),
   /JOINT_RANKING_RESPONSE_UNVERIFIED/);
 }
});

test("both roles see four ON-only count ranking types without original finance",async()=>{
 for(const role of ["hub_owner","partner_owner"]){
  const root=new Node("main"),auth={currentUser:user};
  const view=createVerifiedJointRankingPanel({
   document,root,auth,featureEnabled:true,
   fetchApi:async()=>({ok:true,json:async()=>make(role)}),
   roleProvider:()=>role
  });
  assert.equal(await view.refresh("2026-11"),true);
  const text=allText(root);
  for(const label of ["個人ランキング","会社ランキング","班ランキング",
   "商材ランキング","NURO光","協力店","営業班"])
   assert(text.includes(label),role+" missing "+label);
  assert(!/(?:売上|単価|キャッシュバック|円)/.test(text));
 }
});
test("same-name teams remain separated by approved company labels",()=>{
 const view=verifiedJointCountView(make("partner_owner"),{
  month:"2026-11",role:"partner_owner"
 });
 assert.equal(view.teams.length,2);
 assert.equal(view.teams[0].company,"協力店");
 assert.equal(view.teams[1].company,"自社");
 assert.equal(view.companies.map(x=>x.count).join(","),"5,3");
 assert.equal(view.companies.reduce((n,x)=>n+x.count,0),8);
});
test("owner company/team ranks use safe source counts and competition ties",()=>{
 const raw=make();
 raw.companyBreakdown[0].count=4;
 raw.companyBreakdown[1].count=4;
 raw.teamBreakdown[0].count=4;
 raw.teamBreakdown[1].count=4;
 const view=verifiedJointCountView(raw,{month:"2026-11",role:"hub_owner"});
 assert.deepEqual(view.companies.map(x=>x.rank),[1,1]);
 assert.deepEqual(view.teams.map(x=>x.rank),[1,1]);
});
test("missing team/company ranking and injected money fails closed without displaying count",async()=>{
 for(const role of ["hub_owner","partner_owner"]){
  for(const modify of [
   d=>{if(role==="hub_owner")delete d.companyBreakdown;
    else delete d.publicRanking.companies;},
   d=>{if(role==="hub_owner")delete d.teamBreakdown;
    else delete d.publicRanking.teams;},
   d=>{if(role==="hub_owner")d.teamBreakdown[0].companyName="売上1万円";
    else d.publicRanking.teams[0].company="売上1万円";},
   d=>{if(role==="hub_owner")d.companyBreakdown[0].count=-1;
    else d.publicRanking.companies[0].count=-1;}
  ]){
   const raw=make(role);modify(raw);
   const root=new Node("main");
   const panel=createVerifiedJointRankingPanel({
    document,root,auth:{currentUser:user},featureEnabled:true,
    fetchApi:async()=>({ok:true,json:async()=>raw}),
    roleProvider:()=>role
   });
   assert.equal(await panel.refresh("2026-11"),false);
   assert(!allText(root).includes("合同合計"));
  }
 }
});

test("mismatched company total cannot claim a valid cross-company leaderboard",()=>{
 for(const role of ["hub_owner","partner_owner"]){
  const raw=make(role);
  if(role==="hub_owner")raw.companyBreakdown[0].count=9;
  else raw.publicRanking.companies[0].count=9;
  assert.throws(()=>verifiedJointCountView(raw,{month:"2026-11",role}),
   /JOINT_RANKING_RESPONSE_UNVERIFIED/);
 }
});
