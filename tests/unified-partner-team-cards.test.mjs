import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 projectOwnerPartnerTeamCards,renderOwnerPartnerTeamCards
} from "../ranking/unified-partner-team-cards.mjs";

const payload=()=>({
 schema:"nico-verified-dual-count-v1",
 period:"month",range:{start:"2026-11-01",end:"2026-11-13",days:13},
 readTime:"2026-11-13T01:00:00.000Z",unit:"件",role:"hub_owner",
 summary:{own:10,partner:7,total:17,unidentified:0},
 companyBreakdown:[
  {id:"hub",name:"NICO FACTORY",kind:"自社",count:10,unidentifiedCount:0},
  {id:"companyA",name:"協力店A",kind:"協力店",count:5,unidentifiedCount:0},
  {id:"companyB",name:"協力店B",kind:"協力店",count:2,unidentifiedCount:0}
 ],
 teamBreakdown:[
  {id:"hub:t1",companyId:"hub",companyName:"NICO FACTORY",name:"1班",count:10},
  {id:"companyA:t1",companyId:"companyA",companyName:"協力店A",name:"1班",count:5},
  {id:"companyB:t1",companyId:"companyB",companyName:"協力店B",name:"1班",count:2}
 ],
 memberRanking:[
  {id:"hub:u1",name:"社員A",count:10,rank:1,
   companyId:"hub",companyName:"NICO FACTORY",teamId:"t1",teamName:"1班",reportStatus:"報告済"},
  {id:"companyA:u1",name:"協力店スタッフA",count:3,rank:2,
   companyId:"companyA",companyName:"協力店A",teamId:"t1",teamName:"1班",reportStatus:"報告済"},
  {id:"companyA:u2",name:"協力店スタッフB",count:2,rank:3,
   companyId:"companyA",companyName:"協力店A",teamId:"t1",teamName:"1班",reportStatus:"報告済"},
  {id:"companyB:u1",name:"協力店スタッフC",count:2,rank:3,
   companyId:"companyB",companyName:"協力店B",teamId:"t1",teamName:"1班",reportStatus:"報告済"}
 ],
 productRanking:[
  {id:"approved-nuro",name:"NURO",rank:1,count:17,ownCount:10,partnerCount:7,
   companies:[{companyId:"hub",companyName:"NICO FACTORY",count:10},
    {companyId:"companyA",companyName:"協力店A",count:5},
    {companyId:"companyB",companyName:"協力店B",count:2}]}
 ],
 filters:{}
});
function detailedPayload(){
 const x=payload();
 for(const team of x.teamBreakdown){
  team.detail={schema:"nico-team-count-detail-v1",
   goalCount:null,memberCount:2,reportStatus:"報告済",
   members:x.memberRanking.filter(p=>p.companyId===team.companyId).map(p=>({
    id:p.id,name:p.name,count:p.count,reportStatus:p.reportStatus})),
   products:[{id:"approved-nuro",name:"NURO",count:team.count}]};
 }
 return x;
}
function change(f){const x=payload();f(x);return x}
class Node{
 constructor(tag,text=""){this.tag=tag;this.children=[];this._text=text;this.dataset={};this.attrs={};this.listeners={};this.className="";}
 appendChild(item){this.children.push(item);return item}
 replaceChildren(...items){this.children=[...items]}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(k,fn){this.listeners[k]=fn}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join("")}
 set textContent(t){this._text=String(t);this.children=[]}
 get nodes(){return [this,...this.children.flatMap(x=>x.nodes)]}
}
const document={
 createElement:tag=>new Node(tag),
 createDocumentFragment:()=>new Node("#fragment")
};
test("owner-only snapshot groups same-named teams by company without moving originals",()=>{
 const out=projectOwnerPartnerTeamCards(detailedPayload(),{month:"2026-11"});
 assert.equal(out.companies.length,2);
 assert.equal(out.total,7);
 assert.equal(out.companies[0].teams[0].key,JSON.stringify(["companyA","t1"]));
 assert.equal(out.companies[1].teams[0].key,JSON.stringify(["companyB","t1"]));
 assert.equal(out.companies[0].teams[0].people.length,2);
 assert.equal(out.companies[0].teams[0].peopleVerified,true);
 assert.equal(out.companies[0].products[0].count,5);
});
test("render reuses existing team overview card CSS and opens one company team at a time",()=>{
 const root=new Node("root");
 const model=renderOwnerPartnerTeamCards({document,root,response:detailedPayload(),month:"2026-11"});
 assert.equal(model.total,7);
 const rootChildren=root.nodes;
 assert.equal(rootChildren.filter(x=>x.className==="team-overview-card").length,2);
 const partnerA=rootChildren.find(x=>x.className==="team-overview-card"&&x.dataset.teamKey===JSON.stringify(["companyA","t1"]));
 assert.ok(partnerA);
 partnerA.listeners.click();
 assert.equal(partnerA.attrs["aria-pressed"],"true");
 assert.match(root.textContent,/協力店スタッフA.*3件/);
 assert.doesNotMatch(root.textContent,/¥|単価|キャッシュバック|売上/);
 assert.match(root.textContent,/NURO.*5件/);
});
test("historical unknown team stays separate and cannot be silently assigned",()=>{
 const x=change(d=>{
  d.teamBreakdown.find(t=>t.companyId==="companyA").count=4;
  const changed=d.memberRanking.find(p=>p.companyId==="companyA"&&p.id.endsWith("u2"));
  changed.count=1;
  // Keep the fixture's global ranking consistent with the new count.
  // companyB:u1 (2件) remains 3位; companyA:u2 (1件) becomes 4位.
  // Only the company's unmatched historical 1件 remains unassigned.
  changed.rank=4;
 });
 const out=projectOwnerPartnerTeamCards(x,{month:"2026-11"});
 assert.equal(out.companies[0].unassignedCount,1);
 assert.equal(out.companies[0].teams[0].peopleVerified,false);
});
test("incomplete historical staff attribution hides misleading names",()=>{
 const x=change(d=>{
  d.memberRanking.find(p=>p.id==="companyA:u2").teamId="another";
 });
 const out=projectOwnerPartnerTeamCards(x,{month:"2026-11"});
 assert.equal(out.companies[0].teams[0].peopleVerified,false);
 assert.deepEqual(out.companies[0].teams[0].people,[]);
});
test("rejects wrong period, company ID collisions, overcount and any financial leak",()=>{
 assert.throws(()=>projectOwnerPartnerTeamCards(payload(),{month:"2026-10"}));
 assert.throws(()=>projectOwnerPartnerTeamCards(change(d=>{
  d.teamBreakdown[1].id="hub:t1";
 }),{month:"2026-11"}));
 assert.throws(()=>projectOwnerPartnerTeamCards(change(d=>{
  d.teamBreakdown[1].count=6;
 }),{month:"2026-11"}));
 assert.throws(()=>projectOwnerPartnerTeamCards(change(d=>{
  d.companyBreakdown[1].name="協力店A 売上 ¥8000";
 }),{month:"2026-11"}));
 assert.throws(()=>projectOwnerPartnerTeamCards(change(d=>{
  d.memberRanking[1].unitPrice=880;
 }),{month:"2026-11"}));
 assert.throws(()=>projectOwnerPartnerTeamCards(change(d=>{
  d.companyBreakdown[1].count=2;
 }),{month:"2026-11"}));
});
test("module never opens financial database or writes company data",()=>{
 const s=readFileSync(new URL("../ranking/unified-partner-team-cards.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(s,/getFirestore\(|collection\(|getDocs\(|setDoc\(|updateDoc\(|deleteDoc\(|localStorage\./);
 assert.match(s,/verifiedJointCountView\(/);
 assert.match(s,/root\.replaceChildren\(fragment\)/);
 assert.match(s,/team-overview-grid/);
 assert.match(s,/team-overview-card/);
});

test("legacy equal totals cannot prove attribution after reciprocal transfers",()=>{
 const x=payload(); // both totals match but no historical detail contract
 const out=projectOwnerPartnerTeamCards(x,{month:"2026-11"});
 assert.equal(out.companies[0].teams[0].peopleVerified,false);
 assert.deepEqual(out.companies[0].teams[0].people,[]);
});
test("explicit team detail must reconcile both members and mapped products",()=>{
 for(const field of ["members","products"]){
  const x=detailedPayload();
  x.teamBreakdown[1].detail[field][0].count++;
  assert.throws(()=>projectOwnerPartnerTeamCards(x,{month:"2026-11"}));
 }
 const x=detailedPayload();
 x.teamBreakdown[1].detail.members.push({...x.teamBreakdown[1].detail.members[0]});
 assert.throws(()=>projectOwnerPartnerTeamCards(x,{month:"2026-11"}));
});

test("count goal, remaining and progress render without monetary cells",()=>{
 const x=detailedPayload();
 x.teamBreakdown[1].detail.goalCount=10;
 const root=new Node("root");
 renderOwnerPartnerTeamCards({document,root,response:x,month:"2026-11"});
 assert.match(root.textContent,/目標10件 \/ 残5件 \/ 進捗50%/);
 assert.doesNotMatch(root.textContent,/Infinity|NaN|¥|円|単価|売上/);
 x.teamBreakdown[1].detail.goalCount=0;
 renderOwnerPartnerTeamCards({document,root,response:x,month:"2026-11"});
 assert.match(root.textContent,/目標0件 \/ 残0件 \/ 進捗率対象外/);
});

test("team detail rejects nested unexpected fields and fullwidth financial names",()=>{
 for(const field of ["members","products"]){
  const x=detailedPayload();
  x.teamBreakdown[1].detail[field][0].privateNote="hidden";
  assert.throws(()=>projectOwnerPartnerTeamCards(x,{month:"2026-11"}));
 }
 const x=detailedPayload();
 x.teamBreakdown[1].detail.products[0].name="ＮＵＲＯ ￥８０００";
 assert.throws(()=>projectOwnerPartnerTeamCards(x,{month:"2026-11"}));
});
