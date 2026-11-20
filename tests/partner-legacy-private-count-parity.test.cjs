"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildApprovedPartnerCountStandings,KEYS}=
 require("../functions-partner-workspace/shared-count-standings.cjs");

const counts=value=>Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?value:0]));
const snapshot=({visible=1,privateCount=0,declaredPrivate=privateCount,
 privateId="historicCustom",privateValue={}}={})=>{
 const date="2026-11-20",cid="partner-a",hubId="hub-a",staff="staff-a";
 const data={companyId:cid,hubCompanyId:hubId,date,staffId:staff,
  teamIdSnapshot:"team-a",staffNameSnapshot:"社員A",version:1,
  counts:counts(visible),totalCount:visible,
  ...(privateCount?{privateCounts:{[privateId]:privateCount},
   privateTotalCount:declaredPrivate}:{}),...privateValue};
 const result=()=>buildApprovedPartnerCountStandings({
  hubId,start:date,end:date,
  sources:[{cid,name:"協力店A",approved:true,
   allowedCategories:["NURO"],teams:[{id:"team-a",name:"1班"}],
   entries:[{id:date+"__"+staff,data}],
   reports:[{date,data:{hubCompanyId:hubId,
    partnerCompanyId:cid,date,source:"staff-entries-v1",
    counts:counts(visible),totalCount:visible}}]
  }]
 });
 return {result,data};
};

test("ordinary original 9-category count remains complete without any prior private products",()=>{
 const a=snapshot().result();
 assert.equal(a.totalCount,1);
 assert.equal(a.reportCount,1);
 assert.equal(a.legacyPrivateCountMappingPending,false);
 assert.equal(a.partnerCountsComplete,true);
 assert.equal(a.peopleComplete,true);
 assert.equal(a.teamComplete,true);
 assert.equal(a.companies[0].totalCount,1);
});

test("historic private counts survive in original ledger but cannot be silently certified as fully linked",()=>{
 const {result,data}=snapshot({visible:2,privateCount:5,privateId:"oldSku42"});
 const before=JSON.stringify(data),out=result();
 assert.equal(JSON.stringify(data),before,"original staff entry MUST be unchanged");
 assert.equal(out.totalCount,2,"ON-only ranking stays 2; never manufacture SKU identity");
 assert.equal(out.legacyPrivateCountMappingPending,true);
 assert.equal(out.partnerCountsComplete,false);
 assert.equal(out.peopleComplete,false);
 assert.equal(out.teamComplete,false);
 assert.equal(out.companies[0].totalCount,2);
 assert(!JSON.stringify(out).includes("oldSku42"),"no private SKU id exposure");
 assert(!JSON.stringify(out).includes("privateTotalCount"),"no private ledger exposure");
});

test("private-only historical report must not create false 0-count ranked staff, team or company",()=>{
 const out=snapshot({visible:0,privateCount:4}).result();
 assert.equal(out.legacyPrivateCountMappingPending,true);
 assert.equal(out.partnerCountsComplete,false);
 assert.equal(out.reportCount,0);
 assert.equal(out.companies.length,0);
 assert.equal(out.people.length,0);
 assert.equal(out.teams.length,0);
 assert.equal(out.unreportedCompanies.length,1);
});

test("true all-zero original count report is distinguishable from private-only positive report",()=>{
 const out=snapshot({visible:0}).result();
 assert.equal(out.legacyPrivateCountMappingPending,false);
 assert.equal(out.reportCount,1);
 assert.equal(out.companies.length,1);
 assert.equal(out.companies[0].totalCount,0);
 assert.equal(out.people.length,1);
});

test("a corrupt historical private total must fail closed, never double-count or silently drop",()=>{
 const bad=snapshot({visible:1,privateCount:3,declaredPrivate:2});
 assert.throws(bad.result,/PARTNER_RANK_SNAPSHOT_UNVERIFIED/);
 const invalid=snapshot({visible:1,privateCount:3,
  privateValue:{privateCounts:{"bad!":3},privateTotalCount:3}});
 assert.throws(invalid.result,/PARTNER_RANK_SNAPSHOT_UNVERIFIED/);
 const negative=snapshot({visible:1,privateCount:3,
  privateValue:{privateCounts:{custom:-1},privateTotalCount:-1}});
 assert.throws(negative.result,/PARTNER_RANK_SNAPSHOT_UNVERIFIED/);
 const invalidArray=snapshot({visible:1,privateCount:3,
  privateValue:{privateCounts:[3],privateTotalCount:3}});
 assert.throws(invalidArray.result,/PARTNER_RANK_SNAPSHOT_UNVERIFIED/);
});

test("historical OFF standard SKU plus private category never creates an imaginary 0-rank",()=>{
 const date="2026-11-20",cid="partner-a",hubId="hub-a";
 const out=buildApprovedPartnerCountStandings({
  hubId,start:date,end:date,
  sources:[{cid,name:"協力店A",approved:true,
   allowedCategories:["YMMNP"],teams:[{id:"team-a",name:"1班"}],
   entries:[{id:date+"__staff-a",data:{
    companyId:cid,hubCompanyId:hubId,date,staffId:"staff-a",
    teamIdSnapshot:"team-a",staffNameSnapshot:"社員A",version:1,
    counts:counts(3),totalCount:3,
    privateCounts:{archived:5},privateTotalCount:5
   }}],reports:[{date,data:{hubCompanyId:hubId,partnerCompanyId:cid,date,
    source:"staff-entries-v1",counts:counts(3),totalCount:3}}]}]
 });
 assert.equal(out.legacyPrivateCountMappingPending,true);
 assert.equal(out.reportCount,0);
 assert.equal(out.companies.length,0);
 assert.equal(out.people.length,0);
});
