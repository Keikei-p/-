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
 assert(html.includes('action:"hubCreateInvite"'));
 assert(!html.includes('"createPartnerCompanyInvitation"'));
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
 assert.equal(JSON.stringify([...mapped[2].keys]),JSON.stringify(["id:unknown","legacy:つばさ・HTB"]));
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


test("visible invitation destination selector preserves employee invite and switches to partner company",()=>{
 const start=html.indexOf('id="companyInviteControls"');
 const end=html.indexOf('id="ownerTransferPanel"',start);
 const content=html.slice(start,end);
 assert.ok(content.includes('id="inviteDestinationSelect"'));
 assert.ok(content.includes('<option value="internal">'));
 assert.ok(content.includes('<option value="partner">'));
 assert.ok(content.includes('id="employeeInviteFields"'));
 assert.ok(content.includes('id="inviteEmailInput"'));
 assert.ok(content.includes('id="inviteRoleSelect"'));
 assert.ok(content.includes('id="createInviteButton"'));
 for(const id of ["partnerInviteCompanyName","partnerInviteEmail","partnerInviteCreateButton","partnerInviteLinkOutput"])
  assert.ok(content.includes('id="'+id+'"'));
 assert.ok(html.includes('document.getElementById("inviteDestinationSelect").addEventListener('));
 const sync=fn("syncInviteDestinationPanel");
 assert.match(sync,/internalPanel.hidden = partnerSelected/);
 assert.match(sync,/partnerPanel.hidden = !partnerSelected/);
 assert.match(sync,/currentCompanyData\?\.ownerUid === currentUser.uid/);
 assert.match(sync,/partnerButton.disabled = !owner/);
 assert.ok(html.includes('if (mode === "invite") syncInviteDestinationPanel()'));
 assert.ok(html.includes('partnerInlineManage({action:"hubCreateInvite",partnerCompanyId,teamId,role,email})'));
 assert.ok(html.includes("currentCompanyData?.companyKind === \"partner\""));
});

test("actual quick + staff count API merge prioritizes staff ledger without doubling a company",async()=>{
 const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
 const row=(id,name,changes)=>{
  const counts={...zero(),...changes};
  return {partnerCompanyId:id,name,counts,totalCount:Object.values(counts).reduce((a,b)=>a+b,0)};
 };
 const calls=[];
 const ctx=make(["validatedPartnerRankingDay","mergedPartnerRankingDay","readPartnerRankingMonth",
  "normalizedPartnerRankingLabel","partnerCategoriesForExistingGroup",
  "existingGroupsWithPartnerCounts","partnerRankingVirtualRecords",
  "productRankingRecordMatchesTeam","getRecordResults","buildProductMemberRanking",
  "rankProductMemberCounts","buildGroupedProductMemberRanking"],{
   PARTNER_QUICK_RANK_KEYS:KEYS,getTodayString:()=>"2026-10-31",
   currentPartnerRankingKey:m=>"test|hub|"+m,partnerRankingDailyCache:new Map(),
   readPartnerQuickDay:async({date})=>{
    calls.push(["quick",date]);
    return {data:{role:"hub",date,partners:date==="2026-10-31"?
     [row("partnerA","協力店A",{NURO:9}),row("partnerB","協力店B",{SBMNP:2})]:[]}};
   },
   readPartnerWorkDay:async({date})=>{
    calls.push(["staff",date]);
    return {data:{role:"hub",date,partners:date==="2026-10-31"?
     [row("partnerA","協力店A",{NURO:2,"つばさ・HTB":3})]:[]}};
   },
   dashboardMonth:{value:"2026-10"},
   currentPartnerRankingRows:()=>ctx.monthRows,
   monthRows:[],
   products:[{id:"nuro",name:"NURO光"},{id:"evergreen",name:"エバーグリーン"},
     {id:"sbmnp",name:"SBMNP"}],
   teams:[],recordBelongsToTeam:()=>false,
   getCurrentMemberName:rec=>rec.memberNameSnapshot,
   getCurrentTeamName:rec=>rec.teamNameSnapshot,
   currentProductDisplayName:res=>res.productName,
   rankingGroups:[]
 });
 const merged=await ctx.mergedPartnerRankingDay("2026-10-31");
 assert.equal(merged.length,2,"new staff-ledger replaces only the same company's quick report");
 assert.equal(merged.find(x=>x.id==="partnerA").totalCount,5);
 assert.equal(merged.find(x=>x.id==="partnerB").totalCount,2);
 assert.equal(merged.reduce((n,x)=>n+x.totalCount,0),7,
  "legacy 9 NURO must not be added again to staff-ledger 5");
 const month=await ctx.readPartnerRankingMonth("2026-10");
 assert.equal(month.complete,true);
 assert.equal(month.rows.reduce((n,x)=>n+x.totalCount,0),7);
 assert.equal(calls.length,64,"daywise reads both services for each of 31 days, plus first direct check");
 ctx.monthRows=month.rows;
 const virtual=ctx.partnerRankingVirtualRecords();
 assert.equal(virtual.length,2);
 assert.ok(virtual.every(x=>x.results.every(y=>y.revenuePerUnit===0)));
 const internal=[{uid:"direct",id:"existing",teamId:"direct-team",date:"2026-10-31",
  memberNameSnapshot:"直営A",teamNameSnapshot:"直営",
  results:[{productId:"nuro",productName:"NURO光",count:4,revenuePerUnit:0}]}];
 const groups=[
  {id:"nuro",name:"NURO光",keys:["id:nuro"]},
  {id:"electric",name:"新電力",keys:["id:evergreen"]},
  {id:"mnp",name:"乗り換え丸件",keys:["id:sbmnp"]}
 ];
 const joined=ctx.existingGroupsWithPartnerCounts(groups);
 const ranked=ctx.buildGroupedProductMemberRanking([...internal,...virtual],"",joined);
 assert.equal(ranked.find(x=>x.name==="NURO光").count,6,
  "direct NURO 4 plus partner staff NURO 2");
 assert.equal(ranked.find(x=>x.name==="新電力").count,3,
  "partner combined electricity entries counted in existing new-electricity group");
 assert.equal(ranked.find(x=>x.name==="乗り換え丸件").count,2,
  "legacy-only partner retains its two SBMNP counts");
 const own=ctx.buildGroupedProductMemberRanking([...internal,...virtual],
  "quick-partner:partnerA",joined);
 assert.equal(own.find(x=>x.name==="NURO光").count,2);
 assert.equal(own.find(x=>x.name==="新電力").count,3);
});
