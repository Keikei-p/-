import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {buildSameAppJointCountProjection as project}
 from "../ranking/same-app-joint-count-projection.mjs";
const range={start:"2026-11-18",end:"2026-11-18",
 previousStart:"2026-11-17",previousEnd:"2026-11-17",days:1};
const owner=()=>({
 schema:"nico-verified-dual-count-v1",role:"hub_owner",unit:"件",
 period:"day",range,readTime:"2026-11-18T09:00:00.000Z",
 summary:{own:5,partner:3,total:8,unidentified:0},
 memberRanking:[
  {rank:1,companyName:"直営",name:"Aさん",count:5,reportStatus:"報告済"},
  {rank:2,companyName:"協力店A",name:"Bさん",count:3,reportStatus:"報告済"},
  {rank:null,companyName:"協力店A",name:"未報告さん",count:0,reportStatus:"未報告"}
 ],
 productRanking:[
  {rank:1,id:"nuro",name:"NURO",count:5},
  {rank:2,id:"partnerUnmatched:partnerSku05",name:"SB光・AIR（旧合算・未分類）",count:3}
 ],
 companyBreakdown:[
  {id:"hub1",name:"直営",count:5,unidentifiedCount:0,kind:"自社",reportStatus:"報告済"},
  {id:"partner1",name:"協力店A",count:3,unidentifiedCount:0,kind:"協力店",reportStatus:"報告済"}
 ],
 teamBreakdown:[
  {id:"hub1:t1",companyId:"hub1",companyName:"直営",name:"1班",count:5,
   detail:{schema:"nico-team-count-detail-v1",goalCount:null,memberCount:1,
    reportStatus:"報告済",members:[{id:"A",name:"Aさん",count:5,reportStatus:"報告済"}],
    products:[{id:"nuro",name:"NURO",count:5}]}},
  {id:"partner1:tx",companyId:"partner1",companyName:"協力店A",
   name:"登録当時の班",count:3,
   detail:{schema:"nico-team-count-detail-v1",goalCount:null,memberCount:1,
    reportStatus:"報告済",members:[{id:"B",name:"Bさん",count:3,reportStatus:"報告済"}],
    products:[{id:"partnerUnmatched:partnerSku05",
      name:"SB光・AIR（旧合算・未分類）",count:3}]}}
 ],
 filters:{scope:"joint"}
});
const partner=()=>({
 schema:"nico-verified-dual-count-v1",role:"partner_owner",unit:"件",
 period:"day",range,readTime:"2026-11-18T09:00:00.000Z",
 own:{company:"協力店A",count:3,unidentifiedCount:0,people:[],products:[]},
 publicRanking:{
  members:[{rank:1,company:"直営",name:"Aさん",count:5},
   {rank:2,company:"協力店A",name:"Bさん",count:3}],
  products:[{rank:1,name:"NURO",count:5},
   {rank:2,name:"SB光・AIR（旧合算・未分類）",count:3}],
  companies:[{rank:1,name:"直営",count:5},
   {rank:2,name:"協力店A",count:3}],
  teams:[{rank:1,company:"直営",name:"1班",count:5},
   {rank:2,company:"協力店A",name:"1班",count:3}]
 }
});
test("same owner view: 5 own + 3 partner = 8 verified, no count writes",()=>{
 const input=owner(),before=structuredClone(input);
 const view=project(input);
 assert.equal(view.total,8);assert.equal(view.ownCount,5);
 assert.equal(view.partnerCount,3);
 assert.equal(view.personRows.length,2); // unreported no fake rank 0
 assert.equal(view.companyRows.length,2);
 assert.equal(view.teamDetails[1].members[0].count,3);
 assert.equal(view.teamDetails[1].products[0].name,"SB光・AIR（旧合算・未分類）");
 assert.deepEqual(input,before);
 assert.equal(view.financeIncluded,false);
 assert.equal("unitPrice" in view,false);
 assert.equal("records" in view,false);
});
test("same partner view: visible joint ranks only, other members' detail excluded",()=>{
 const input=partner(),before=structuredClone(input);
 const view=project(input,{partner:true});
 assert.equal(view.role,"partner");
 assert.equal(view.ownCount,3);
 assert.equal(view.total,null); // partner cannot see Owner-only summary envelope
 assert.equal(view.companyRows.length,2);
 assert.equal(view.personRows[0].name,"直営・Aさん");
 assert.equal(view.teamDetails[0].members.length,0);
 assert.equal(view.teamDetails[0].products.length,0);
 assert.deepEqual(input,before);
});
test("different rank on same count, spoofed total, or malformed detail is blocked",()=>{
 const x=owner();x.memberRanking[1].count=5;x.memberRanking[1].rank=2;
 assert.throws(()=>project(x));
 const y=owner();y.productRanking[0].count=6;
 assert.throws(()=>project(y));
 const z=owner();z.teamBreakdown[1].detail.products[0].count=999;
 assert.throws(()=>project(z));
});
test("no money keys, money-encoded names, or server data with unknown fields",()=>{
 const x=owner();x.productRanking[0].unitPrice=50000;
 assert.throws(()=>project(x));
 const y=owner();y.teamBreakdown[0].name="1班 売上100万円";
 assert.throws(()=>project(y));
 const z=partner();z.teamBreakdown=owner().teamBreakdown;
 assert.throws(()=>project(z,{partner:true}));
 const w=owner();w.summary.revenue=555;
 assert.throws(()=>project(w));
});
test("unreported people are never given a rank and zero-report remains ranked",()=>{
 const x=owner();x.memberRanking[1].count=0;x.memberRanking[1].rank=2;
 x.memberRanking[1].reportStatus="確定0件";
 // Independent ranking totals and product sums can still be unchanged here.
 const v=project(x);
 assert.equal(v.personRows[1].rank,2);
 assert.equal(v.personRows[1].count,0);
 const y=owner();y.memberRanking[2].reportStatus="incorrect";
 assert.throws(()=>project(y));
});
test("a partner cannot impersonate the hub response through its local role",()=>{
 assert.throws(()=>project(owner(),{partner:true}));
 assert.throws(()=>project(partner(),{partner:false}));
});

test("a missing company count cannot be silently displayed as a verified total",()=>{
 const x=owner();
 x.companyBreakdown[1].count=2; // Stored 3, UI would otherwise display 2.
 assert.throws(()=>project(x));
 const p=partner();
 p.publicRanking.companies[1].count=2;
 assert.throws(()=>project(p,{partner:true}));
});
test("partner public company and product sums must reconcile without name-only guesses",()=>{
 const p=partner();
 p.publicRanking.products[0].count=4;
 assert.throws(()=>project(p,{partner:true}));
 const u=partner();
 u.own.count=999;
 assert.throws(()=>project(u,{partner:true}));
});
test("unreported records never become ranked zero or hide a positive count",()=>{
 const x=owner();
 x.memberRanking[2].rank=2;
 assert.throws(()=>project(x));
 const y=owner();
 y.memberRanking[2].count=1;
 assert.throws(()=>project(y));
 const z=owner();
 z.companyBreakdown[1].reportStatus="未報告";
 assert.throws(()=>project(z));
 const w=owner();
 w.teamBreakdown[1].detail.reportStatus="未報告";
 assert.throws(()=>project(w));
});
test("wire-up must fail closed on 200 contract drift and 401/403, not silently rank stale data",()=>{
 const source=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 assert(source.includes('throw Error(httpStatus===503?"SAME_APP_JOINT_NOT_RELEASED":'));
 assert(source.includes('if(error?.message!=="SAME_APP_JOINT_NOT_RELEASED"){'));
 assert(source.includes('httpStatus=reply?.status??null;'));
 assert(source.includes('date!==pInline(field).value'));
 assert(source.includes('if(seq!==sharedDailyRankingGeneration||auth.currentUser?.uid!==uid)return;'));
});

test("offline +1 partner count reaches BOTH company dashboards with no old-count mutation",()=>{
 const hubBefore=owner(),partnerBefore=partner();
 const frozenPrevious=structuredClone({hubBefore,partnerBefore});
 const beforeHub=project(hubBefore);
 const beforePartner=project(partnerBefore,{partner:true});
 assert.equal(beforeHub.total,8);
 assert.equal(beforeHub.partnerCount,3);
 assert.equal(beforePartner.ownCount,3);
 // Model a new verified server GET after one additional submitted count.
 // This is NOT a Firebase write and NOT a live end-to-end assertion.
 const hubAfter=structuredClone(hubBefore),partnerAfter=structuredClone(partnerBefore);
 hubAfter.summary.partner+=1;hubAfter.summary.total+=1;
 hubAfter.memberRanking[1].count+=1;
 hubAfter.productRanking[1].count+=1;
 hubAfter.companyBreakdown[1].count+=1;
 hubAfter.teamBreakdown[1].count+=1;
 hubAfter.teamBreakdown[1].detail.members[0].count+=1;
 hubAfter.teamBreakdown[1].detail.products[0].count+=1;
 partnerAfter.own.count+=1;
 partnerAfter.publicRanking.members[1].count+=1;
 partnerAfter.publicRanking.products[1].count+=1;
 partnerAfter.publicRanking.companies[1].count+=1;
 partnerAfter.publicRanking.teams[1].count+=1;
 const nextHub=project(hubAfter);
 const nextPartner=project(partnerAfter,{partner:true});
 assert.equal(nextHub.total-beforeHub.total,1);
 assert.equal(nextHub.partnerCount-beforeHub.partnerCount,1);
 assert.equal(nextHub.ownCount,beforeHub.ownCount);
 assert.equal(nextPartner.ownCount-beforePartner.ownCount,1);
 assert.equal(nextHub.productRows.find(v=>v.name.includes("SB光")).count,4);
 assert.equal(nextPartner.productRows.find(v=>v.name.includes("SB光")).count,4);
 assert.equal(nextHub.teamDetails[1].members[0].count,4);
 assert.equal(nextPartner.teamRows[1].count,4);
 assert.equal(nextHub.financeIncluded,false);
 assert.equal(nextPartner.financeIncluded,false);
 assert.deepEqual({hubBefore,partnerBefore},frozenPrevious);
});
test("rank parity is maintained for an additional zero/one-count tie",()=>{
 const hub=owner();
 hub.memberRanking[0].count=3;hub.memberRanking[0].rank=1;
 hub.memberRanking[1].count=3;hub.memberRanking[1].rank=1;
 const same=project(hub);
 assert.equal(same.personRows[0].rank,1);
 assert.equal(same.personRows[1].rank,1);
 const corrupted=structuredClone(hub);
 corrupted.memberRanking[1].rank=2;
 assert.throws(()=>project(corrupted));
});
