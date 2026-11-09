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
   {id:"hub:one",rank:1,name:"田中",count:5},
   {id:"partner:two",rank:2,name:"鈴木",count:3}
  ],
  productRanking:[{id:"nuro",rank:1,name:"NURO光",count:8}]
 }:{
  own:{company:"協力店",count:5,people:[],products:[],unidentifiedCount:0},
  publicRanking:{members:[
   {rank:1,company:"自社",name:"佐藤",count:5},
   {rank:1,company:"協力店",name:"佐藤",count:5}
  ],products:[{rank:1,name:"NURO光",count:8}]}
 })
});
test("same ON-only joint numbers render for owner without any financial data",()=>{
 const view=verifiedJointCountView(make(),{month:"2026-11",role:"hub_owner"});
 assert.equal(view.total,8);
 assert.equal(view.ownCount,3);
 assert.deepEqual(view.products.map(x=>[x.name,x.count]),[["NURO光",8]]);
 assert.equal(view.people.length,2);
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
