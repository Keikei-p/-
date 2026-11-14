import test from "node:test";
import {buildOwnerVisibleCountRanking as buildFunctionOwnerVisibleCountRanking}
 from "../functions-ranking-approvals/ranking/owner-product-visibility-rankings.mjs";
import {readFileSync} from "node:fs";

import assert from "node:assert/strict";
import {buildOwnerVisibleCountRanking,planOwnerProductToggle}
 from "../ranking/owner-product-visibility-rankings.mjs";

const clock="2026-11-08T12:00:00.000Z",day="2026-11-08";
const products=(cid)=>[
 {companyId:cid,sourceId:cid==="hub"?"nuro":"p-nuro",
  name:"NURO光",active:true,sortOrder:0},
 {companyId:cid,sourceId:cid==="hub"?"air":"p-air",
  name:"SoftBank Air",active:true,sortOrder:1}
];
function source(cid,kind,nuro,air){
 const rec={companyId:cid,sourceId:"r-"+cid,uid:"u-"+cid,
  teamId:"t-"+cid,date:day,totalCount:nuro+air,
  reportStatus:"submitted",memberNameSnapshot:"担当"+cid,
  teamNameSnapshot:"班"+cid,workLocation:""};
 return {companyId:cid,companyLabel:cid==="hub"?"自社":"協力店A",kind,
  consentVerified:true,isComplete:true,readTime:clock,
  completeWindows:{current:true,previous:false},
  roster:[{uid:"u-"+cid,name:"担当"+cid,teamId:"t-"+cid}],
  teams:[{id:"t-"+cid,name:"班"+cid,goalCount:null}],
  products:products(cid),records:[rec],
  lines:[{companyId:cid,recordId:rec.sourceId,
    sourceId:"l-"+cid+"-nuro",uid:rec.uid,teamId:rec.teamId,
    date:day,productId:products(cid)[0].sourceId,count:nuro},
   {companyId:cid,recordId:rec.sourceId,
    sourceId:"l-"+cid+"-air",uid:rec.uid,teamId:rec.teamId,
    date:day,productId:products(cid)[1].sourceId,count:air}]
 };
}
function fixture(partnerNuro=5){
 return {hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  context:{serverVerified:true,viewerUid:"hub-owner",
   viewerCompanyId:"hub",hubCompanyId:"hub",role:"hub_owner",
   approvedCompanyIds:["hub","partner"],reciprocalOwnersApproved:true,
   userActive:true,memberActive:true,companyActive:true,
   individualNamesApproved:true,completeSnapshotBudgetApproved:true},
  sources:[source("hub","own",2,1),source("partner","partner",partnerNuro,4)],
  productGroups:[
   {companyId:"hub",productId:"nuro",groupId:"nuro",groupName:"NURO光"},
   {companyId:"partner",productId:"p-nuro",groupId:"nuro",groupName:"NURO光"},
   {companyId:"hub",productId:"air",groupId:"air",groupName:"SoftBank Air"},
   {companyId:"partner",productId:"p-air",groupId:"air",groupName:"SoftBank Air"}
  ],
  period:{kind:"day",day,asOf:day}
 };
}
const publication=ids=>({serverVerified:true,ownerSettingsRead:true,
 ownerUidVerified:true,productMappingsReviewed:true,
 hubCompanyId:"hub",revision:3,enabledHubProductIds:ids});
const run=(x,p)=>buildOwnerVisibleCountRanking({input:x,publication:p});

test("owner ON-only NURO links company, person and SKU rankings; OFF Air disappears from ALL totals",()=>{
 const input=fixture(),unchanged=structuredClone(input);
 const r=run(input,publication(["nuro"]));
 assert.deepEqual(r.summary,{own:2,partner:5,total:7,unidentified:0});
 assert.deepEqual(r.productRanking.map(x=>[x.name,x.count]),[["NURO光",7]]);
 assert.equal(r.memberRanking.find(x=>x.id==="partner:u-partner").count,5);
 assert.equal(r.companyBreakdown.find(x=>x.id==="partner").count,5);
 assert.equal(r.teamBreakdown.find(x=>x.companyId==="partner").count,5);
 assert.equal(JSON.stringify(r).includes("SoftBank Air"),false);
 assert.deepEqual(input,unchanged,"toggle must NEVER delete or mutate saved rows");
 assert(!/price|revenue|cashback|unitPrice/.test(JSON.stringify(r)));
});

test("OFF→ON recovers original historical counts, correction 5→6 recalculates without double addition",()=>{
 const input=fixture(5);
 const old=run(input,publication(["nuro"]));
 assert.equal(old.summary.partner,5);
 const corrected=fixture(6);
 const next=run(corrected,publication(["nuro"]));
 assert.equal(next.summary.partner,6);
 assert.equal(next.productRanking[0].count,8);
 assert.deepEqual(run(corrected,publication(["nuro"])),next);
 const off=run(input,publication([]));
 assert.equal(off.summary.total,0);
 assert.equal(off.productRanking.length,0);
 assert.equal(off.memberRanking.find(x=>x.id==="partner:u-partner").count,0);
 const back=run(input,publication(["nuro","air"]));
 assert.equal(back.summary.total,12);
 assert.equal(back.productRanking.length,2);
 assert.equal(input.sources[1].records[0].totalCount,9);
});

test("global ON + individual partner OFF excludes partner without dropping internal counts",()=>{
 const gate={...publication(["nuro","air"]),
  partnerOverrides:[{companyId:"partner",enabledHubProductIds:["air"]}]};
 const r=run(fixture(),gate);
 assert.deepEqual(r.summary,{own:3,partner:4,total:7,unidentified:0});
 assert.equal(r.productRanking.find(x=>x.id==="nuro").partnerCount,0);
 assert.equal(r.productRanking.find(x=>x.id==="air").partnerCount,4);
 assert.equal(r.memberRanking.find(x=>x.id==="partner:u-partner").count,4);
});

test("partner audience only receives published count-only public ranking",()=>{
 const x=fixture(),p={...x,context:{...x.context,role:"partner_owner",
  viewerUid:"partner-owner",viewerCompanyId:"partner"}};
 const r=run(p,publication(["nuro"]));
 assert.equal(r.role,"partner_owner");
 assert.equal(r.own.count,5);
 assert.deepEqual(r.publicRanking.products.map(v=>v.name),["NURO光"]);
 assert(!("companyBreakdown" in r));
 assert(!("teamBreakdown" in r));
 assert(!JSON.stringify(r).includes("SoftBank Air"));
});

test("saved total drift blocks every audience even when the extra product is OFF",()=>{
 // Issue #352: an extra saved product row must never be guessed away or
 // reclassified as a confirmed zero by a publication switch.
 for(const role of ["hub_owner","partner_owner"]){
  for(const enabled of [[],["nuro"],["nuro","air"]]){
   const input=fixture();
   input.sources[0].lines.push({...input.sources[0].lines[1],
    sourceId:"l-hub-extra-saved-row",count:1});
   input.context={...input.context,role,
    viewerCompanyId:role==="hub_owner"?"hub":"partner"};
   const before=structuredClone(input);
   assert.throws(()=>run(input,publication(enabled)),
    /VERIFIED_COUNT_DASHBOARD_INCOMPLETE_OR_UNAUTHORIZED/);
   assert.deepEqual(input,before,"inconsistent originals remain untouched for Owner review");
  }
 }
});

test("all OFF categories never leak historic reported partner name as a public zero",()=>{
 const base=fixture(),partner={...base,context:{...base.context,
  role:"partner_owner",viewerUid:"partner-owner",viewerCompanyId:"partner"}};
 const before=structuredClone(partner);
 for(const fn of [buildOwnerVisibleCountRanking,buildFunctionOwnerVisibleCountRanking]){
  const off=fn({input:partner,publication:publication([])});
  assert.deepEqual(off.publicRanking,{members:[],products:[],companies:[],teams:[]},
   "OFF must not disclose names or historic participation through a zero rank");
  assert.equal(off.own.count,0);
  const own=off.own.people.find(x=>x.companyId==="partner");
  assert(own&&own.reportStatus==="未報告"&&own.rank===null);
  const internal=fn({input:base,publication:publication([])});
  const reported=internal.memberRanking.find(x=>x.companyId==="partner");
  assert(reported&&reported.reportStatus==="未報告"&&reported.rank===null);
  assert.equal(internal.companyBreakdown.find(x=>x.id==="partner").hasVerifiedSubmission,false);
 }
 assert.deepEqual(partner,before,"neither legacy counts nor audit history change");
});

test("OFF-only positive historical report is not a submitted zero for an ON SKU",()=>{
 const original=fixture(0),partner={...original,context:{...original.context,
  role:"partner_owner",viewerUid:"partner-owner",viewerCompanyId:"partner"}};
 const before=structuredClone(partner);
 for(const fn of [buildOwnerVisibleCountRanking,buildFunctionOwnerVisibleCountRanking]){
  const nuro=fn({input:partner,publication:publication(["nuro"])});
  assert.equal(nuro.own.count,0);
  assert(!nuro.publicRanking.members.some(x=>x.company==="協力店A"),
   "OFF-only saved count cannot publish the person's identity as a zero rank");
  assert(!nuro.publicRanking.companies.some(x=>x.name==="協力店A"),
   "OFF-only company submission is not a confirmed published zero");
  assert.equal(nuro.publicRanking.products[0].count,2,
   "only approved internal NURO rows participate");
  const recovered=fn({input:partner,publication:publication(["air"])});
  assert.equal(recovered.own.count,4);
  assert(recovered.publicRanking.members.some(x=>x.company==="協力店A"&&x.count===4));
 }
 assert.deepEqual(partner,before,"OFF and re-ON never rewrite source history");
});

test("genuine submitted zero remains ranked while unsubmitted remains excluded",()=>{
 const base=fixture(0),partnerSource=base.sources[1];
 partnerSource.lines[1].count=0;
 partnerSource.records[0].totalCount=0;
 const before=structuredClone(base);
 const partner={...base,context:{...base.context,role:"partner_owner",
  viewerUid:"partner-owner",viewerCompanyId:"partner"}};
 for(const fn of [buildOwnerVisibleCountRanking,buildFunctionOwnerVisibleCountRanking]){
  const result=fn({input:partner,publication:publication(["nuro"])});
  assert(result.publicRanking.members.some(x=>x.company==="協力店A"&&x.count===0));
  assert(result.publicRanking.companies.some(x=>x.name==="協力店A"&&x.count===0));
  const owner=fn({input:base,publication:publication(["nuro"])});
  assert.equal(owner.memberRanking.find(x=>x.companyId==="partner").reportStatus,"確定0件");
 }
 assert.deepEqual(base,before);
});

test("isolated ranking Function exactly matches canonical ON/OFF projection",()=>{
 const source=readFileSync(new URL("../ranking/owner-product-visibility-rankings.mjs",import.meta.url),"utf8");
 const isolated=readFileSync(new URL("../functions-ranking-approvals/ranking/owner-product-visibility-rankings.mjs",import.meta.url),"utf8");
 assert.equal(isolated,source,"Function and canonical product gate must be identical");
});

test("wrong owner, forged settings, disabled SKU, unknown IDs and missing SKU mapping reject",()=>{
 const x=fixture(),orig=publication(["nuro"]);
 const bad=[
  null,{...orig,serverVerified:false},
  {...orig,ownerUidVerified:false},
  {...orig,productMappingsReviewed:false},
  {...orig,ownerSettingsRead:false},
  {...orig,hubCompanyId:"foreign"},
  {...orig,enabledHubProductIds:["air","air"]},
  {...orig,enabledHubProductIds:["unknown"]},
  {...orig,partnerOverrides:[{companyId:"foreign",enabledHubProductIds:["nuro"]}]},
  {...orig,partnerOverrides:[{companyId:"partner",enabledHubProductIds:["unknown"]}]}
 ];
 for(const gate of bad)
  assert.throws(()=>run(x,gate),/VISIBILITY_UNVERIFIED/);
 const noMap=fixture();
 noMap.productGroups=noMap.productGroups.filter(v=>v.productId!=="nuro");
 assert.throws(()=>run(noMap,orig),/VISIBILITY_UNVERIFIED/);
 const inactive=fixture();inactive.sources[0].products[0].active=false;
 assert.throws(()=>run(inactive,orig),/VISIBILITY_UNVERIFIED/);
 const money=fixture();money.sources[1].records[0].revenue=50000;
 assert.throws(()=>run(money,orig));
});

test("owner-only ON/OFF change plans respect active products and do not modify raw catalog",()=>{
 const hubProducts=products("hub");
 const context={companyId:"hub",companyRole:"owner",serverVerified:true};
 const before=structuredClone(hubProducts);
 const off=planOwnerProductToggle({actor:context,hubCompanyId:"hub",
  hubProducts,currentEnabledIds:["nuro","air"],productId:"air",enabled:false});
 assert.deepEqual(off.enabledHubProductIds,["nuro"]);
 const on=planOwnerProductToggle({actor:context,hubCompanyId:"hub",
  hubProducts,currentEnabledIds:off.enabledHubProductIds,productId:"air",enabled:true});
 assert.deepEqual(on.enabledHubProductIds,["air","nuro"]);
 assert.deepEqual(hubProducts,before);
 assert.throws(()=>planOwnerProductToggle({actor:{...context,companyRole:"member"},
  hubCompanyId:"hub",hubProducts,currentEnabledIds:["nuro"],productId:"air",enabled:true}),
  /VISIBILITY_UNVERIFIED/);
 assert.throws(()=>planOwnerProductToggle({actor:context,
  hubCompanyId:"hub",hubProducts,currentEnabledIds:["nuro"],productId:"fake",enabled:true}),
  /VISIBILITY_UNVERIFIED/);
});

test("all four partner leaderboards honor exact hub SKU ON/OFF and corrections",()=>{
 const base=fixture(5), original=structuredClone(base);
 const state=publication(["nuro"]);
 const partner={...base,context:{...base.context,role:"partner_owner",
  viewerUid:"partner-owner",viewerCompanyId:"partner"}};
 const rank=run(partner,state);
 assert.deepEqual(rank.publicRanking.companies.map(x=>x.count),[5,2]);
 assert.deepEqual(rank.publicRanking.teams.map(x=>x.count),[5,2]);
 assert.equal(rank.publicRanking.members.find(x=>x.company==="協力店A").count,5);
 assert.equal(rank.publicRanking.products[0].count,7);
 assert.deepEqual(rank.publicRanking.teams.map(x=>Object.keys(x).sort()),[
  ["rank","name","company","count"].sort(),
  ["rank","name","company","count"].sort()
 ]);
 const off=run(partner,publication([]));
 assert.equal(off.publicRanking.companies.reduce((n,x)=>n+x.count,0),0);
 assert.equal(off.publicRanking.teams.reduce((n,x)=>n+x.count,0),0);
 assert.equal(off.publicRanking.products.length,0);
 const corrected=fixture(6);
 const partnerCorrected={...corrected,context:{...corrected.context,
  role:"partner_owner",viewerUid:"partner-owner",viewerCompanyId:"partner"}};
 const update=run(partnerCorrected,state);
 assert.equal(update.publicRanking.companies[0].count,6);
 assert.equal(update.publicRanking.teams[0].count,6);
 assert.equal(update.publicRanking.products[0].count,8);
 assert.deepEqual(base,original,"past original count records stay untouched");
});
