"use strict";
const fs=require("node:fs");
const vm=require("node:vm");
const test=require("node:test");
const assert=require("node:assert/strict");
const html=fs.readFileSync(require("node:path").join(__dirname,"../index.html"),"utf8");
function fn(name){
  let pos=html.indexOf("function "+name+"(");
  assert(pos>=0,name+" missing");
  if(html.slice(pos-6,pos)==="async ")pos-=6;
  const end=html.indexOf("\n}",pos);
  assert(end>pos,name+" closing brace");
  return html.slice(pos,end+2);
}
function make(names,scope={}){
  const ctx=vm.createContext(scope);
  vm.runInContext(names.map(fn).join("\n"),ctx);
  return ctx;
}
test("existing invitation tab hosts a partner invitation entry without another menu",()=>{
 const begin=html.indexOf('id="companyInviteControls"');
 const end=html.indexOf('id="ownerTransferPanel"',begin);
 assert(begin>=0&&end>begin);
 const part=html.slice(begin,end);
 for(const id of ["partnerInviteInline","partnerInviteCompanyName","partnerInviteEmail","partnerInviteCreateButton","partnerInviteLinkOutput"])
   assert(part.includes('id="'+id+'"'),id);
 assert(part.includes('href="/partner-invite.html"'));
 assert(html.includes('createPartnerCompanyInvitation'));
 assert(html.includes('currentCompanyData?.ownerUid !== currentUser.uid'));
});
test("validated count-only partner month aggregates and refuses partial old snapshots",async()=>{
 const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const empty=()=>Object.fromEntries(keys.map(k=>[k,0]));
 const response=(date,changes)=>{
  const counts={...empty(),...changes};
  return {role:"hub",date,partners:[{partnerCompanyId:"partner_a",name:"協力店A",counts,
   totalCount:Object.values(counts).reduce((a,b)=>a+b,0)}]};
 };
 const requests=[];
 const ctx=make(["validatedPartnerRankingDay","readPartnerRankingMonth",
  "normalizedPartnerRankingLabel","partnerCategoriesForExistingGroup",
  "existingGroupsWithPartnerCounts","productRankingRecordMatchesTeam"],{
    PARTNER_QUICK_RANK_KEYS:keys,getTodayString:()=>"2026-10-31",
    currentPartnerRankingKey:date=>date,partnerRankingDailyCache:new Map(),
    readPartnerQuickDay:async({date})=>{
      requests.push(date);
      return {data:date==="2026-10-31"?response(date,{NURO:2,SBMNP:1}):
        date==="2026-10-30"?response(date,{NURO:4}):
        {role:"hub",date,partners:[]}};
    },
    currentPartnerRankingRows:()=>[{id:"partner_a",name:"協力店A"}],
    products:[{id:"nuro-id",name:"NURO光"},{id:"s",name:"SBMNP"}],
    teams:[],recordBelongsToTeam:()=>false
  });
 const october=await ctx.readPartnerRankingMonth("2026-10");
 assert.equal(october.complete,true);
 assert.equal(requests.length,31);
 assert.equal(october.rows.length,1);
 assert.equal(october.rows[0].totalCount,7);
 assert.equal(october.rows[0].counts.NURO,6);
 assert.equal(october.rows[0].counts.SBMNP,1);
 assert.equal((await ctx.readPartnerRankingMonth("2026-09")).complete,false);
 assert.equal(requests.length,31);
 const cached=await ctx.readPartnerRankingMonth("2026-10");
 assert.equal(cached.rows[0].totalCount,7);
 assert.equal(requests.length,31,"cached historical rows must not be re-fetched");
 const groups=[
  {id:"nuro",name:"NURO光",keys:["id:nuro-id"]},
  {id:"mnp",name:"乗り換え丸件",keys:["id:s"]},
  {id:"electric",name:"新電力",keys:["id:unknown"]}
 ];
 const mapped=ctx.existingGroupsWithPartnerCounts(groups);
 assert.equal(JSON.stringify([...mapped[0].keys]),JSON.stringify(["id:nuro-id","legacy:NURO"]));
 assert.equal(JSON.stringify([...mapped[1].keys]),JSON.stringify(["id:s","legacy:SBMNP","legacy:YMMNP"]));
 assert.equal(JSON.stringify([...mapped[2].keys]),JSON.stringify(["id:unknown"]));
 assert.equal(ctx.productRankingRecordMatchesTeam({__partnerQuickOnly:true,teamId:"quick-partner:partner_a"},"quick-partner:partner_a"),true);
 assert.equal(ctx.productRankingRecordMatchesTeam({__partnerQuickOnly:true,teamId:"quick-partner:partner_a"},"else"),false);
 const malformed=response("2026-10-31",{NURO:1});
 malformed.partners[0].counts["売上"]=100000;
 assert.throws(()=>ctx.validatedPartnerRankingDay(malformed,"2026-10-31"),/partner_quick_row_invalid/);
 const duplicated=ctx.existingGroupsWithPartnerCounts([
  {id:"a",name:"NURO",keys:[]},{id:"b",name:"NURO光",keys:[]}]);
 assert.equal(duplicated[0].keys.includes("legacy:NURO"),false);
 assert.equal(duplicated[1].keys.includes("legacy:NURO"),false);
});
test("existing ranking UIs reused, not a new ranking screen or money blending",()=>{
 assert(html.includes('const originalRows=buildTeamRankingRows(teamMap,monthly,teamRankingMode)'));
 assert(html.includes('const partnerRows=teamRankingMode==="progress"'));
 assert(html.includes('const augmentedRows=[...monthly,...partnerRankingVirtualRecords()]'));
 assert(html.includes("const productsWithCounts=buildGroupedProductMemberRanking("));
 assert(html.includes("function renderIndividualRanking("));
 assert(html.includes("function renderTeamRanking("));
 assert(html.includes("function renderProductMemberRanking("));
 const start=html.indexOf("function refreshExistingPartnerRanking()");
 const end=html.indexOf("function partnerRankingVirtualRecords()",start);
 const scope=html.slice(start,end);
 assert(!["setDoc(","updateDoc(","addDoc(","deleteDoc("].some(k=>scope.includes(k)));
});
