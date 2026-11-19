import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {buildVerifiedCountDashboard} from "../functions-ranking-approvals/ranking/verified-dual-count-dashboards.mjs";
import {buildPartnerCountRankingSource} from "../functions-ranking-approvals/ranking/partner-workspace-count-source.mjs";
import {composeCanonicalMonthlyRankingInput} from "../functions-ranking-approvals/ranking/canonical-joint-count-sku-reader.mjs";
import {createPartnerMonthTransactionReader} from "../functions-ranking-approvals/ranking/partner-month-readonly-loader.mjs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createJointCountHttpAdapter}=require("../functions-ranking-approvals/joint-count-http-adapter.cjs");
import {createVerifiedJointMonthHttpBridge} from "../ranking/verified-joint-month-http-bridge.mjs";
import {PARTNER_RANK_SKUS} from "../functions-ranking-approvals/ranking/partner-workspace-count-source.mjs";
import {linkAllRegisteredCountsWithoutSetup} from "../functions-ranking-approvals/ranking/zero-setup-count-linker.mjs";
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
 own:{company:"協力店A",count:3,unidentifiedCount:0,people:[],products:[],
  teamDetails:[{name:"1班",count:3,reportStatus:"報告済",
   members:[{name:"Bさん",count:3,reportStatus:"報告済"}],
   products:[{name:"SB光・AIR（旧合算・未分類）",count:3}]}]},
 publicRanking:{
  members:[{rank:1,company:"直営",name:"Aさん",count:5},
   {rank:2,company:"協力店A",name:"Bさん",count:3}],
  products:[{rank:1,name:"NURO",count:5},
   {rank:2,name:"SB光・AIR（旧合算・未分類）",count:3}],
  companies:[{rank:1,name:"直営",count:5},
   {rank:2,name:"協力店A",count:3}],
  teams:[{rank:1,company:"直営",name:"1班",count:5,own:false},
   {rank:2,company:"協力店A",name:"1班",count:3,own:true}]
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
 assert.equal(view.teamDetails.find(x=>x.name==="直営・1班").members.length,0);
 assert.equal(view.teamDetails.find(x=>x.name==="直営・1班").products.length,0);
 assert.equal(view.teamDetails.find(x=>x.name==="協力店A・1班").members[0].count,3);
 assert.equal(view.teamDetails.find(x=>x.name==="協力店A・1班").products[0].count,3);
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
test("partner-own team details reject forged totals, extra finance, or false rank ownership",()=>{
 const wrong=partner();
 wrong.own.teamDetails[0].members[0].count=4;
 assert.throws(()=>project(wrong,{partner:true}));
 const missing=partner();
 delete missing.own.teamDetails;
 assert.throws(()=>project(missing,{partner:true}));
 const finance=partner();
 finance.own.teamDetails[0].products[0].unitPrice=90000;
 assert.throws(()=>project(finance,{partner:true}));
 const forged=partner();
 forged.publicRanking.teams[0].own=true;
 assert.throws(()=>project(forged,{partner:true}));
 const unreported=partner();
 unreported.own.teamDetails[0].reportStatus="未報告";
 assert.throws(()=>project(unreported,{partner:true}));
});
test("partner reported zero is distinct from an unreported own team",()=>{
 const p=partner();
 p.own.count=0;
 p.own.teamDetails=[{name:"1班",count:0,reportStatus:"確定0件",
  members:[{name:"Bさん",count:0,reportStatus:"確定0件"}],products:[]},
  {name:"2班",count:0,reportStatus:"未報告",members:[],products:[]}];
 p.publicRanking.members=[{rank:1,company:"直営",name:"Aさん",count:5},
  {rank:2,company:"協力店A",name:"Bさん",count:0}];
 p.publicRanking.products=[{rank:1,name:"NURO",count:5}];
 p.publicRanking.companies=[{rank:1,name:"直営",count:5},
  {rank:2,name:"協力店A",count:0}];
 p.publicRanking.teams=[{rank:1,company:"直営",name:"1班",count:5,own:false},
  {rank:2,company:"協力店A",name:"1班",count:0,own:true}];
 const view=project(p,{partner:true});
 assert.equal(view.teamDetails.find(t=>t.name==="協力店A・1班").reported,true);
 assert.equal(view.teamDetails.find(t=>t.name==="協力店A・2班").reported,false);
 assert.equal(view.teamDetails.find(t=>t.name==="直営・1班").members.length,0);
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
 assert(source.includes('const NICO_SAME_APP_JOINT_HTTP_ENABLED = false;'));
 assert(source.includes('if(NICO_SAME_APP_JOINT_HTTP_ENABLED!==true)'));
 assert(source.includes('throw Error("SAME_APP_JOINT_NOT_RELEASED");'));
 assert(source.includes('throw Error("SAME_APP_JOINT_AUTH_OR_DATA_UNVERIFIED");'));
 assert(source.includes('if(error?.message!=="SAME_APP_JOINT_NOT_RELEASED"){'));
 assert(!source.includes('httpStatus=reply?.status??null;'));
 assert(source.includes('date!==pInline(field).value'));
 assert(source.includes('if(!sharedDailyRankingIsCurrent(where,epoch,seq)||auth.currentUser?.uid!==uid)return;'));
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
 partnerAfter.own.teamDetails[0].count+=1;
 partnerAfter.own.teamDetails[0].members[0].count+=1;
 partnerAfter.own.teamDetails[0].products[0].count+=1;
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

const verifiedHttpResponse=body=>({
 status:200,headers:{get:key=>key==="Content-Type"?"application/json":null},
 text:async()=>JSON.stringify(body)
});
function verifiedFixture(body,{role="hub_owner",uid="owner1",workspace=""}={}){
 const user={uid,emailVerified:true,getIdToken:async()=>("A".repeat(50))};
 const auth={currentUser:user},requests=[],writes=[];
 const bridge=createVerifiedJointMonthHttpBridge({
  featureEnabled:true,auth,expectedRole:role,
  endpoint:"https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking",
  getWorkspaceCompanyId:()=>workspace,
  fetcher:async(url,options)=>{
   requests.push({url,method:options.method,cache:options.cache,
    authorization:options.headers?.Authorization});
   return verifiedHttpResponse(body);
  }
 });
 return {bridge,auth,user,requests,writes};
}
test("real read-only HTTP bridge → same owner UI counts, exactly one authenticated GET",async()=>{
 const f=verifiedFixture(owner());
 const payload=await f.bridge.load({period:{
  kind:"day",day:"2026-11-18",asOf:"2026-11-18"
 },filters:{}});
 const model=project(payload);
 assert.equal(model.ownCount,5);
 assert.equal(model.partnerCount,3);
 assert.equal(model.total,8);
 assert.equal(model.financeIncluded,false);
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].method,"GET");
 assert.equal(f.requests[0].cache,"no-store");
 assert.equal(f.requests[0].authorization,"Bearer "+"A".repeat(50));
 assert.match(f.requests[0].url,/getVerifiedJointCountRanking\?day=2026-11-18$/);
 assert.equal(f.writes.length,0);
});
test("partner workspace HTTP identity only receives public count envelope",async()=>{
 const f=verifiedFixture(partner(),{
  role:"partner_owner",uid:"partnerOwner1",workspace:"partner1"
 });
 const raw=await f.bridge.load({period:{
  kind:"day",day:"2026-11-18",asOf:"2026-11-18"
 },filters:{}});
 const projection=project(raw,{partner:true});
 assert.equal(projection.ownCount,3);
 assert.equal(projection.teamDetails.find(x=>x.name==="直営・1班").members.length,0);
 assert.equal(projection.teamDetails.find(x=>x.name==="協力店A・1班").members[0].count,3);
 assert.equal(projection.personRows.length,2);
 assert.match(f.requests[0].url,/workspaceCompanyId=partner1/);
 assert.equal("summary" in raw,false);
 assert.equal("revenue" in projection,false);
});
test("Auth switch or invalid verified contract never reaches the ranking renderer",async()=>{
 const f=verifiedFixture(owner());
 f.user.getIdToken=async()=>{
  f.auth.currentUser={uid:"different",emailVerified:true,getIdToken:async()=>("A".repeat(50))};
  return "A".repeat(50);
 };
 await assert.rejects(()=>f.bridge.load({
  period:{kind:"day",day:"2026-11-18",asOf:"2026-11-18"},filters:{}
 }));
 assert.equal(f.requests.length,0);
 const bad=verifiedFixture({...owner(),role:"partner_owner"});
 await assert.rejects(()=>bad.bridge.load({
  period:{kind:"day",day:"2026-11-18",asOf:"2026-11-18"},filters:{}
 }));
 assert.equal(bad.requests.length,1);
});
test("no ON OFF mapping joins exact self SKU, preserves legacy combined, never changes source",()=>{
 const hubSource={companyId:"hub1",kind:"own",consentVerified:true,isComplete:true,
  readTime:"2026-11-18T09:00:00.000Z",
  products:[{companyId:"hub1",sourceId:"nuro",name:"NURO光",active:true},
   {companyId:"hub1",sourceId:"light",name:"ソフトバンク光",active:true}]};
 const partnerSource={companyId:"partner1",kind:"partner",consentVerified:true,
  isComplete:true,readTime:hubSource.readTime,
  products:PARTNER_RANK_SKUS.map(s=>({
   companyId:"partner1",sourceId:s.id,name:s.name,active:true
  }))};
 const original=structuredClone({hubSource,partnerSource});
 const rows=linkAllRegisteredCountsWithoutSetup({
  hubCompanyId:"hub1",hubSource,partnerSources:[partnerSource]
 });
 const match=rows.find(s=>s.companyId==="partner1"&&s.productId==="partnerSku01");
 const combined=rows.find(s=>s.companyId==="partner1"&&s.productId==="partnerSku05");
 assert.equal(match.groupId,"nuro");
 assert.equal(combined.groupId,"partnerUnmatched:partnerSku05");
 assert.equal(rows.filter(s=>s.companyId==="partner1").length,9);
 assert.deepEqual({hubSource,partnerSource},original);
 assert.equal(JSON.stringify(rows).includes("unitPrice"),false);
});

test("default-OFF gate refuses joint HTTP before any fetch/Auth/import",async()=>{
 const source=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const begin=source.indexOf("async function tryLoadVerifiedSameAppJointCount(");
 const end=source.indexOf("async function loadSharedDailyStandings(",begin);
 assert(begin>=0&&end>begin);
 const method=source.slice(begin,end).trim();
 assert(method.indexOf('if(NICO_SAME_APP_JOINT_HTTP_ENABLED!==true)')<
        method.indexOf('import("./ranking/verified-joint-month-http-bridge.mjs")'));
 // Execute the actual inline function under an isolated OFF gate. Dynamic
 // imports, auth, and network must not be touched before the first refusal.
 const checked=new Function("NICO_SAME_APP_JOINT_HTTP_ENABLED",
  "return ("+method+");")(false);
 await assert.rejects(()=>checked({
  where:"partner",date:"2026-11-18",partner:true,detail:false,
  status:null,content:null,uid:"partner1",seq:1
 }),/SAME_APP_JOINT_NOT_RELEASED/);
});
test("a disabled joint bridge cannot read Auth or call the network",()=>{
 let network=0,token=0;
 assert.throws(()=>createVerifiedJointMonthHttpBridge({
  featureEnabled:false,
  auth:{currentUser:{uid:"u1",emailVerified:true,
   getIdToken:async()=>{token++;return "A".repeat(50);}}},
  fetcher:async()=>{network++;throw Error("unexpected");}
 }),/VERIFIED_JOINT_COUNT_MONTH_BRIDGE_BLOCKED/);
 assert.equal(network,0);
 assert.equal(token,0);
});

test("three independent server switches gate ranking GET before Auth/Firestore",()=>{
 const source=readFileSync(new URL("../functions-ranking-approvals/index.js",import.meta.url),"utf8");
 const matches=[...source.matchAll(
  /enabled:\(\)=>(process\.env\.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"&&\s*process\.env\.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled"&&\s*process\.env\.NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED==="enabled")/g
 )];
 assert.equal(matches.length,1,"Must have one exact triple-gated GET service");
 const read=(joint,zeroSetup,tab)=>runInNewContext(matches[0][1],{
  process:{env:{
   NICO_JOINT_COUNT_RANKING_ENABLED:joint,
   NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED:zeroSetup,
   NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED:tab
  }}
 });
 for(const [a,b,c] of [
  [undefined,undefined,undefined],["enabled",undefined,undefined],
  [undefined,"enabled","enabled"],["enabled","enabled",undefined],
  ["enabled",undefined,"enabled"],["disabled","enabled","enabled"],
  ["enabled","disabled","enabled"],["enabled","enabled","disabled"],
  ["Enabled","enabled","enabled"]
 ])assert.equal(read(a,b,c),false);
 assert.equal(read("enabled","enabled","enabled"),true);
});
test("a missing server-side publication gate never initializes count/Auth backend",async()=>{
 const source=readFileSync(new URL("../functions-ranking-approvals/index.js",import.meta.url),"utf8");
 const match=source.match(
  /enabled:\(\)=>(process\.env\.NICO_JOINT_COUNT_RANKING_ENABLED==="enabled"&&\s*process\.env\.NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED==="enabled"&&\s*process\.env\.NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED==="enabled")/
 );
 assert(match);
 const checks=[
  [undefined,undefined,undefined],["enabled",undefined,"enabled"],
  ["enabled","enabled",undefined],["enabled",undefined,undefined]
 ];
 for(const [a,b,c] of checks){
  const active=()=>runInNewContext(match[1],{
   process:{env:{NICO_JOINT_COUNT_RANKING_ENABLED:a,
    NICO_JOINT_ZERO_SETUP_COUNT_LINK_ENABLED:b,
    NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED:c}}
  });
  let calls=0,code=null,body=null;
  const call=createJointCountHttpAdapter({
   enabled:active,publishedOnly:true,
   loadHandler:async()=>{calls++;throw Error("BACKEND_MUST_REMAIN_OFF");}
  });
  await call({
   method:"GET",originalUrl:"/getVerifiedJointCountRanking?day=2026-11-18",
   headers:{origin:"https://nico-factory.web.app",authorization:"Bearer "+"A".repeat(50)}
  },{
   setHeader(){},status(x){code=x;return this;},
   send(s){body=JSON.parse(s);return this;}
  });
  assert.equal(code,503);
  assert.deepEqual(body,{error:"request_blocked"});
  assert.equal(calls,0);
 }
});

test("actual unpublished joint ranking panel does not call incompatible legacy API",async()=>{
 const source=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const start=source.indexOf("async function loadSharedDailyStandings(");
 const end=source.indexOf('pInline("partnerSharedRankingsRefresh").onclick=',start);
 assert(start>0&&end>start);
 const method=source.slice(start,end).trim();
 const off=source.indexOf('if(NICO_SAME_APP_JOINT_HTTP_ENABLED!==true){',start);
 const priorCall=source.indexOf('const payload={date,sharedRankings:true};',start);
 assert(off>start&&off<priorCall&&priorCall<end);
 let calls=0;
 const nodes={
  pInlineDate:{value:"2026-11-18"},
  partnerSharedRankingsStatus:{textContent:""},
  partnerSharedRankingContent:{replaceChildren(){calls++;}}
 };
 const run=new Function("NICO_SAME_APP_JOINT_HTTP_ENABLED",
  "pInline","auth","getTodayString","canReadSharedCountOnlyRanks",
  "tryLoadVerifiedSameAppJointCount","readPartnerWorkDay",
  "let sharedDailyRankingGeneration=0; const sharedDailyRankingViewNonce=new Map();"+
  "return ("+method+");"
 )(false,key=>nodes[key],{currentUser:{uid:"p1"}},
  ()=>"2026-11-18",()=>true,
  async()=>{throw Error("CANONICAL_MUST_STAY_OFF");},
  async()=>{throw Error("LEGACY_UNSUPPORTED_RANKING_API_CALLED");}
 );
 await run("partner",true);
 assert.equal(calls,1); // only clear the unopened joint slot
 assert.match(nodes.partnerSharedRankingsStatus.textContent,/公開前/);
 assert.match(nodes.partnerSharedRankingsStatus.textContent,/この協力店の保存済み件数/);
 assert.doesNotMatch(nodes.partnerSharedRankingsStatus.textContent,/照合できません/);
});

test("simultaneous individual/product/team requests do not cancel each other's verified counts",async()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const a=html.indexOf("let sharedDailyRankingGeneration=0;");
 const b=html.indexOf("const sharedDailyRankCache=new Map();",a);
 const start=html.indexOf("async function loadSharedDailyStandings(",b);
 const end=html.indexOf('pInline("partnerSharedRankingsRefresh").onclick=',start);
 assert(a>0&&b>a&&start>b&&end>start);
 const stateSource=html.slice(a,b);
 const method=html.slice(start,end);
 const statuses={},contents={},dates={};
 const names=["Individual","Product","Team"];
 for(const name of names){
  dates["ownerSharedDate"+name]={value:"2026-11-18"};
  statuses["ownerSharedStatus"+name]={textContent:""};
  contents["ownerSharedContent"+name]={replaceChildren(){}};
 }
 const pending=[];
 const make=new Function("pInline","auth","getTodayString","canReadSharedCountOnlyRanks",
  "NICO_SAME_APP_JOINT_HTTP_ENABLED","tryLoadVerifiedSameAppJointCount",
  "readPartnerWorkDay",stateSource+"\n"+method+"\nreturn {"+
  "load:loadSharedDailyStandings,valid:sharedDailyRankingIsCurrent,"+
  "invalidate:()=>{sharedDailyRankingGeneration++}};"
 );
 const scope=make(id=>dates[id]||statuses[id]||contents[id],
  {currentUser:{uid:"owner1"}},()=>"2026-11-18",()=>true,true,
  args=>new Promise(resolve=>pending.push({...args,resolve})),
  async()=>{throw Error("UNSUPPORTED_LEGACY_RANKING_CALLED");}
 );
 const first=scope.load("Individual"),second=scope.load("Product"),
  third=scope.load("Team");
 assert.equal(pending.length,3);
 assert(pending.every(x=>scope.valid(x.where,x.epoch,x.seq)));
 // Only requests for the same card supersede each other.
 const fourth=scope.load("Individual");
 assert.equal(pending.length,4);
 assert.equal(scope.valid(pending[0].where,pending[0].epoch,pending[0].seq),false);
 assert.equal(scope.valid(pending[1].where,pending[1].epoch,pending[1].seq),true);
 assert.equal(scope.valid(pending[2].where,pending[2].epoch,pending[2].seq),true);
 assert.equal(scope.valid(pending[3].where,pending[3].epoch,pending[3].seq),true);
 pending.forEach(x=>x.resolve(true));
 await Promise.all([first,second,third,fourth]);
 // A save/logout advances the global epoch and invalidates every card.
 scope.invalidate();
 assert(pending.every(x=>!scope.valid(x.where,x.epoch,x.seq)));
});

function authoritativeDashboardFixture(role="hub_owner",partnerCount=3){
 const time="2026-11-18T11:45:00.000Z",day="2026-11-18";
 const record=(companyId,sourceId,uid,n)=>({
  companyId,sourceId,uid,date:day,teamId:"t1",totalCount:n,
  reportStatus:n===0?"no_result":"submitted",
  memberNameSnapshot:uid==="p1"?"協力店A担当":"直営担当",
  teamNameSnapshot:"1班",workLocation:""
 });
 const line=(rec,productId,n)=>({
  companyId:rec.companyId,recordId:rec.sourceId,
  sourceId:rec.sourceId+"_line",date:day,uid:rec.uid,
  teamId:rec.teamId,productId,count:n
 });
 const direct=record("hub","direct1","h1",5);
 const partner=record("partner","partner1","p1",partnerCount);
 const zero=record("partner","partnerZero","p2",0);
 const source=(companyId,kind,records,lines,people,productId)=>({
  companyId,companyLabel:kind==="own"?"直営":"協力店A",kind,
  consentVerified:true,isComplete:true,readTime:time,
  completeWindows:{current:true,previous:true},
  teams:[{id:"t1",name:"1班",goalCount:null}],
  roster:people.map(([uid,name])=>({uid,name,teamId:"t1"})),
  records,lines,
  products:[{companyId,sourceId:productId,name:"NURO光",
   active:true,sortOrder:0}]
 });
 const context={serverVerified:true,userActive:true,memberActive:true,
  companyActive:true,activeCountSharingVerified:true,
  individualNamesApproved:true,completeSnapshotBudgetApproved:true,
  viewerUid:role==="hub_owner"?"owner":"partnerOwner",
  viewerCompanyId:role==="hub_owner"?"hub":"partner",
  hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],role};
 return {context,hubCompanyId:"hub",approvedCompanyIds:["hub","partner"],
  period:{kind:"day",day,asOf:day},
  sources:[
   source("hub","own",[direct],[line(direct,"nuro",5)],
    [["h1","直営担当"]],"nuro"),
   source("partner","partner",[partner,zero],[line(partner,"partnerSku01",partnerCount)],
    [["p1","協力店A担当"],["p2","0件報告者"],["p3","未報告者"]],"partnerSku01")
  ],
  productGroups:[
   {companyId:"hub",productId:"nuro",groupId:"nuro",groupName:"NURO光"},
   {companyId:"partner",productId:"partnerSku01",groupId:"nuro",groupName:"NURO光"}
  ]
 };
}
test("real verified server builder -> owner UI projection: 5+3 is 8 with exact team detail",()=>{
 const fixture=authoritativeDashboardFixture();
 const frozen=structuredClone(fixture);
 const raw=buildVerifiedCountDashboard(fixture);
 assert.equal(raw.summary.total,8);
 const view=project(raw);
 assert.equal(view.total,8);
 assert.equal(view.ownCount,5);
 assert.equal(view.partnerCount,3);
 assert.equal(view.productRows[0].count,8);
 assert.equal(view.teamDetails.find(x=>x.name==="協力店A・1班").count,3);
 assert.equal(view.personRows.length,3); // includes explicitly reported zero
 assert(!view.personRows.some(x=>x.name.includes("未報告者")));
 assert.deepEqual(fixture,frozen);
});
test("real verified server builder -> partner UI projection: public ranks only, finance absent",()=>{
 const fixture=authoritativeDashboardFixture("partner_owner");
 const raw=buildVerifiedCountDashboard(fixture);
 const view=project(raw,{partner:true});
 assert.equal(view.ownCount,3);
 assert.equal(view.productRows[0].count,8);
 assert.equal(view.companyRows.length,2);
 assert.equal(view.personRows.length,3);
 assert.equal(view.teamDetails.find(x=>x.name==="直営・1班").members.length,0);
 const own=view.teamDetails.find(x=>x.name==="協力店A・1班");
 assert.equal(own.count,3);
 assert.equal(own.members.find(x=>x.name==="協力店A担当").count,3);
 assert.equal(own.members.find(x=>x.name==="0件報告者").count,0);
 assert.equal(own.products[0].count,3);
 assert.equal(raw.own.teamDetails.length,1);
 assert(raw.own.teamDetails.every(x=>x.members.every(m=>m.name!=="直営担当")));
 assert(!("summary" in raw));
 assert.equal(view.financeIncluded,false);
});
test("real server correction replacement 3 to 4 is only +1 in owner and partner projections",()=>{
 const a=buildVerifiedCountDashboard(authoritativeDashboardFixture("hub_owner",3));
 const b=buildVerifiedCountDashboard(authoritativeDashboardFixture("hub_owner",4));
 const pa=buildVerifiedCountDashboard(authoritativeDashboardFixture("partner_owner",3));
 const pb=buildVerifiedCountDashboard(authoritativeDashboardFixture("partner_owner",4));
 assert.equal(project(b).total-project(a).total,1);
 assert.equal(project(b).partnerCount-project(a).partnerCount,1);
 assert.equal(project(pb,{partner:true}).ownCount-project(pa,{partner:true}).ownCount,1);
});

test("release blocker: existing private-only partner count remains saved but is absent from joint source",()=>{
 const names=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
  "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const counts=Object.fromEntries(names.map(k=>[k,0]));
 // This is an OFFLINE reproduction of the current production ledger format;
 // it must NOT be described as full historic parity until the backend
 // includes private product lines and canonical name matching safely.
 const entry={id:"2026-11-18__staff1",companyId:"partner1",hubCompanyId:"hub1",
  staffId:"staff1",teamIdSnapshot:"t1",date:"2026-11-18",version:1,
  counts,totalCount:0,privateCounts:{privateProduct1:2},privateTotalCount:2};
 const before=structuredClone(entry);
 const source=buildPartnerCountRankingSource({
  hubCompanyId:"hub1",partnerCompanyId:"partner1",companyLabel:"協力店A",
  period:"2026-11",readTime:"2026-11-18T11:45:00.000Z",
  relation:{hubCompanyId:"hub1",partnerCompanyId:"partner1",
   active:true,countSharingApproved:true},
  proof:{serverVerified:true,countSharingVerified:true,
   completeMonthEntriesRead:true,completeMonthSummariesRead:true,
   historicalTeamsVerified:true,snapshotConsistent:true},
  teams:[{id:"t1",name:"1班",goalCount:null}],
  entries:[entry],
  summaries:[{source:"staff-entries-v1",date:"2026-11-18",
   hubCompanyId:"hub1",partnerCompanyId:"partner1",counts,totalCount:0}]
 });
 assert.equal(entry.privateTotalCount,2);
 assert.equal(source.records[0].totalCount,0);
 assert.equal(source.lines.length,0);
 assert.equal(source.products.length,9);
 assert.deepEqual(entry,before,"private historic original remains untouched");
 // This explicitly DENIES production-ready full parity: source is missing
 // two private-product counts. A future full-scope patch must update this.
 console.log("RELEASE_BLOCKED_PRIVATE_PRODUCT_HISTORY_UNLINKED");
});

function linkedPrivateSourceFixture(){
 const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
  "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const counts=Object.fromEntries(keys.map(x=>[x,x==="NURO"?3:0]));
 const privateProducts=[
  {id:"privateMatch",companyId:"partner",name:"追加プラン",
   active:true,origin:"partner_custom",visibility:"private"},
  {id:"privateRetired",companyId:"partner",name:"販売終了の旧商材",
   active:false,origin:"partner_custom",visibility:"private"}
 ];
 const entry={id:"2026-11-18__p1",companyId:"partner",hubCompanyId:"hub",
  staffId:"p1",teamIdSnapshot:"t1",staffNameSnapshot:"協力店A担当",
  date:"2026-11-18",version:2,
  counts,totalCount:3,privateCounts:{privateMatch:2,privateRetired:1},
  privateTotalCount:3};
 const input={
  hubCompanyId:"hub",partnerCompanyId:"partner",companyLabel:"協力店A",
  period:"2026-11",readTime:"2026-11-18T11:45:00.000Z",
  relation:{hubCompanyId:"hub",partnerCompanyId:"partner",active:true,countSharingApproved:true},
  proof:{serverVerified:true,countSharingVerified:true,
   completeMonthEntriesRead:true,completeMonthSummariesRead:true,
   historicalTeamsVerified:true,snapshotConsistent:true,
   completePrivateProductCatalogueRead:true},
  teams:[{id:"t1",name:"1班",goalCount:null}],
  entries:[entry],privateProducts,includePrivateCounts:true,
  summaries:[{source:"staff-entries-v1",hubCompanyId:"hub",
   partnerCompanyId:"partner",date:"2026-11-18",counts,totalCount:3}]
 };
 return input;
}
test("full private-history projection is 3 standard + 3 private, with original daily report still 3",()=>{
 const input=linkedPrivateSourceFixture(),before=structuredClone(input);
 const source=buildPartnerCountRankingSource(input);
 assert.equal(source.records.length,1);
 assert.equal(source.records[0].totalCount,6);
 assert.equal(source.lines.reduce((sum,row)=>sum+row.count,0),6);
 assert.equal(source.products.length,11);
 assert.equal(source.lines.filter(x=>x.productId.startsWith("partnerPrivate:"))
  .reduce((sum,x)=>sum+x.count,0),3);
 assert.equal(source.lines.filter(x=>x.productId==="partnerSku01")[0].count,3);
 assert.equal(input.summaries[0].totalCount,3);
 assert.equal(source.records[0].reportStatus,"submitted");
 assert.deepEqual(input,before);
 assert(!JSON.stringify(source).includes("privateCounts"));
 assert(!JSON.stringify(source).includes("privateTotalCount"));
 assert(!JSON.stringify(source).includes("unitPrice"));
});
test("real canonical linker and dashboard include saved custom counts once, including inactive old SKU",()=>{
 const input=linkedPrivateSourceFixture(),partner=buildPartnerCountRankingSource(input);
 const direct=authoritativeDashboardFixture("hub_owner");
 const hub=structuredClone(direct.sources[0]);
 hub.products.push({companyId:"hub",sourceId:"directCustom",name:"追加プラン",
  active:true,sortOrder:0});
 const sourceBefore=structuredClone({hub,partner});
 const joined=composeCanonicalMonthlyRankingInput({
  context:direct.context,hubSource:hub,partnerSources:[partner],
  hubOwnerUid:"owner",month:"2026-11",serverAsOf:"2026-11-18",
  zeroSetupLink:true
 });
 const match=joined.productGroups.find(x=>x.companyId==="partner"&&
  x.productId==="partnerPrivate:privateMatch");
 const old=joined.productGroups.find(x=>x.companyId==="partner"&&
  x.productId==="partnerPrivate:privateRetired");
 assert.equal(match.groupId,"directCustom");
 assert(old.groupId.startsWith("partnerPrivateUnmatched:"));
 assert.equal(old.groupName,"販売終了の旧商材");
 const response=buildVerifiedCountDashboard({
  ...joined,context:direct.context,
  period:{kind:"day",day:"2026-11-18",asOf:"2026-11-18"}
 });
 const view=project(response);
 assert.equal(view.ownCount,5);
 assert.equal(view.partnerCount,6);
 assert.equal(view.total,11);
 assert.equal(view.productRows.reduce((n,row)=>n+row.count,0),11);
 assert.equal(view.productRows.find(x=>x.name==="追加プラン").count,2);
 assert.equal(view.teamDetails.find(x=>x.name==="協力店A・1班").count,6);
 assert.deepEqual({hub,partner},sourceBefore,"ranking never rewrites source");
 const partnerCtx={...direct.context,role:"partner_owner",
  viewerUid:"partnerOwner",viewerCompanyId:"partner"};
 const partnerResponse=buildVerifiedCountDashboard({
  ...joined,context:partnerCtx,
  period:{kind:"day",day:"2026-11-18",asOf:"2026-11-18"}
 });
 const partnerView=project(partnerResponse,{partner:true});
 assert.equal(partnerView.ownCount,6);
 assert.equal(partnerView.productRows.reduce((n,row)=>n+row.count,0),11);
 assert.equal(partnerView.financeIncluded,false);
});
test("private-count mode rejects missing/unknown catalog, altered sum, financial name, duplicate and incomplete proof",()=>{
 const scenarios=[
  x=>{x.privateProducts.pop();},
  x=>{x.entries[0].privateTotalCount=9;},
  x=>{x.privateProducts[0].name="売上100万円プラン";},
  x=>{x.privateProducts.push({...x.privateProducts[0]});},
  x=>{delete x.proof.completePrivateProductCatalogueRead;},
  x=>{x.entries[0].privateCounts.unverifiedId=1;},
  x=>{x.entries[0].privateCounts.privateMatch=-1;},
  x=>{x.entries[0].privateCounts.privateMatch=10000;}
 ];
 for(const mutate of scenarios){
  const input=linkedPrivateSourceFixture(),baseline=structuredClone(input);
  mutate(input);
  assert.throws(()=>buildPartnerCountRankingSource(input),
   undefined,"unsafe private read must stop");
  assert.deepEqual(baseline.entries[0].counts,input.entries[0].counts);
 }
});

test("other partner never receives another company's private SKU name, but still sees its verified count",()=>{
 const one=linkedPrivateSourceFixture(),sourceA=buildPartnerCountRankingSource(one);
 const two=linkedPrivateSourceFixture();
 two.partnerCompanyId="partnerB";
 two.companyLabel="協力店B";
 two.relation.partnerCompanyId="partnerB";
 two.entries=[];two.summaries=[];two.privateProducts=[];
 const sourceB=buildPartnerCountRankingSource(two);
 const raw=authoritativeDashboardFixture();
 const hub=structuredClone(raw.sources[0]);
 hub.products.push({companyId:"hub",sourceId:"ownExtra",name:"追加プラン",
  active:true,sortOrder:0});
 const context={...raw.context,role:"partner_owner",
  viewerUid:"partnerBOwner",viewerCompanyId:"partnerB",
  approvedCompanyIds:["hub","partner","partnerB"]};
 const joined=composeCanonicalMonthlyRankingInput({
  context,hubSource:hub,partnerSources:[sourceA,sourceB],
  hubOwnerUid:"owner",month:"2026-11",serverAsOf:"2026-11-18",
  zeroSetupLink:true
 });
 const privateGroup=joined.productGroups.find(x=>x.companyId==="partner"&&
  x.productId==="partnerPrivate:privateRetired").groupId;
 const product=buildVerifiedCountDashboard({
  ...joined,context,
  period:{kind:"day",day:"2026-11-18",asOf:"2026-11-18"}
 });
 const pub=product.publicRanking.products;
 assert(!pub.some(p=>p.name.includes("販売終了の旧商材")));
 assert(pub.some(p=>p.name==="他社の追加商材（名称非公開）"&&p.count===1));
 assert.equal(pub.reduce((n,p)=>n+p.count,0),11);
 assert.equal(project(product,{partner:true}).productRows
  .reduce((n,p)=>n+p.count,0),11);
 assert(privateGroup.startsWith("partnerPrivateUnmatched:"));
 const ownContext={...context,viewerCompanyId:"partner",viewerUid:"partnerAOwner"};
 const ownView=buildVerifiedCountDashboard({
  ...joined,context:ownContext,
  period:{kind:"day",day:"2026-11-18",asOf:"2026-11-18"}
 });
 assert(ownView.publicRanking.products.some(p=>p.name.includes("販売終了の旧商材")));
});

test("true one-snapshot read-only transaction reads private SKU originals and adds them once",async()=>{
 const src=linkedPrivateSourceFixture(),iso=src.readTime;
 const ts={seconds:Math.floor(Date.parse(iso)/1000),nanoseconds:0,
  toDate:()=>new Date(iso)};
 const docs=new Map([
  ["companies/hub",{name:"直営",active:true,companyKind:"internal"}],
  ["companies/partner",{name:"協力店A",active:true,companyKind:"partner",
   hubCompanyId:"hub"}],
  ["partnerRelations/partner",src.relation],
  ["companies/partner/partnerWorkTeams/t1",{
   companyId:"partner",name:"1班",active:true}],
  ["companies/partner/partnerWorkEntries/"+src.entries[0].id,src.entries[0]],
  ...src.privateProducts.map(x=>["companies/partner/partnerPrivateProducts/"+x.id,x]),
  ["companies/hub/partnerWorkCountDays/2026-11-18/reports/partner",src.summaries[0]]
 ]);
 class Ref{
  constructor(path){this.path=path;}
  collection(n){return new Q(this.path+"/"+n);}
 }
 class Q{
  constructor(path,filters=[],max=Infinity){
   this.path=path;this.filters=filters;this.max=max;
  }
  doc(id){return new Ref(this.path+"/"+id);}
  collection(n){return new Q(this.path+"/"+n);}
  where(k,op,v){return new Q(this.path,[...this.filters,[k,op,v]],this.max);}
  limit(n){return new Q(this.path,this.filters,n);}
 }
 const events=[];
 const snap=(path,data)=>({
  id:path.split("/").at(-1),exists:data!==undefined,
  readTime:ts,data:()=>data===undefined?undefined:structuredClone(data)
 });
 const tx={async get(ref){
  events.push({op:"get",path:ref.path});
  if(ref instanceof Ref)return snap(ref.path,docs.get(ref.path));
  const rows=[...docs.entries()].filter(([key,data])=>
   key.startsWith(ref.path+"/")&&!key.slice(ref.path.length+1).includes("/")&&
   ref.filters.every(([field,op,value])=>
    op===">="?data[field]>=value:op==="<="?data[field]<=value:false));
  return {readTime:ts,docs:rows.slice(0,ref.max).map(([path,data])=>snap(path,data))};
 }};
 const db={collection:path=>new Q(path),
  runTransaction(){throw Error("NESTED_TRANSACTION_FORBIDDEN");}};
 const context={serverVerified:true,userActive:true,memberActive:true,
  companyActive:true,activeCountSharingVerified:true,
  completeSnapshotBudgetApproved:true,hubCompanyId:"hub",
  approvedCompanyIds:["hub","partner"]};
 const before=structuredClone([...docs]);
 const reader=createPartnerMonthTransactionReader({
  db,clock:()=>new Date(iso),includePrivateCounts:true
 });
 const out=await reader({
  tx,hubCompanyId:"hub",partnerCompanyId:"partner",
  month:"2026-11",context
 });
 assert.equal(out.records[0].totalCount,6);
 assert.equal(out.lines.reduce((n,line)=>n+line.count,0),6);
 assert.equal(out.products.length,11);
 assert(events.some(x=>x.path==="companies/partner/partnerPrivateProducts"));
 assert.deepEqual([...docs],before,"No original counts, prices or categories changed");

 const deleted=docs.get("companies/partner/partnerPrivateProducts/privateRetired");
 docs.delete("companies/partner/partnerPrivateProducts/privateRetired");
 await assert.rejects(()=>reader({
  tx,hubCompanyId:"hub",partnerCompanyId:"partner",
  month:"2026-11",context
 }),/INCOMPLETE|UNVERIFIED/,"Missing historical private catalog blocks publication");
 docs.set("companies/partner/partnerPrivateProducts/privateRetired",deleted);
 const byKey=entries=>entries.slice().sort((a,b)=>a[0].localeCompare(b[0]));
 assert.deepEqual(byKey([...docs]),byKey(before),
  "Reinsertion order in the test Map cannot be mistaken for a source change");
});


test("same-app release never shows stale partner-only rank cards and opens verified own-team detail",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const start=html.indexOf("function renderPartnerRankingOnlyPanel(){");
 const end=html.indexOf("\nlet partnerSameAppSelectedPanel=",start);
 assert(start>=0&&end>start,"Canonical partner ranking source must exist");
 const source=html.slice(start,end);
 const run=enabled=>{
  const events={cleared:0,rows:[],legacyMessage:0};
  const ranking={
   replaceChildren(){events.cleared++},
   classList:{add(){}},dataset:{}
  };
  const snap={role:"partner",categories:["NURO"],staff:[],teams:[],
   records:[{totalCount:3,counts:{NURO:3}}],companyName:"協力店A"};
  const context={
   NICO_SAME_APP_JOINT_HTTP_ENABLED:enabled,
   partnerInlineData:snap,partnerSameAppSelectedPanel:"product",
   pInline:id=>{assert.equal(id,"pInlineRanking");return ranking;},
   appendVerifiedCountRankRow:(_root,row)=>events.rows.push(row),
   partnerMainAppendRow:()=>{events.legacyMessage++}
  };
  runInNewContext(source+"\nrenderPartnerRankingOnlyPanel();",context);
  return events;
 };
 const old=run(false);
 assert.equal(old.cleared,1);
 assert.equal(old.rows.length,1);
 assert.equal(old.rows[0].count,3);
 const published=run(true);
 assert.equal(published.cleared,1);
 assert.equal(published.rows.length,0,"Release must never show stale local partner-only rank");
 assert.equal(published.legacyMessage,0);
 const selectStart=html.indexOf("function partnerSameAppSelectPanel(name){");
 const selectEnd=html.indexOf("function partnerSameAppTogglePanel(name){",selectStart);
 assert(selectStart>=0&&selectEnd>selectStart);
 const selected=html.slice(selectStart,selectEnd);
 assert(selected.includes('if(NICO_SAME_APP_JOINT_HTTP_ENABLED===true){'));
 assert(selected.includes('oldDetail.closest(".p-inline-card")'));
 assert(selected.includes('oldCard.hidden=true'));
 assert(selected.includes('oldDetail.hidden=true'));
 assert(selected.includes('void loadSharedDailyStandings("partnerDetail",true);'));
 assert(selected.includes('}else oldDetail.hidden=false;'),
  "Unreleased original detail screen must be unchanged");
 assert(html.includes("const NICO_SAME_APP_JOINT_HTTP_ENABLED = false;"));
 assert(html.includes("const NICO_PARTNER_TAB_SERVER_GUARD_VERIFIED = false;"));
});
