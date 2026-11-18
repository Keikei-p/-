import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
 buildVerifiedPartnerCountBriefing,prepareCountOnlyAiModelInput,
 createCountAutoReportPlan
} from "../reports/verified-count-ai-briefing.mjs";
const require=createRequire(import.meta.url);
const {buildApprovedPartnerCountStandings,KEYS}=require(
 "../functions-partner-workspace/shared-count-standings.cjs");
const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const day="2026-11-18";
const totals=(v)=>Object.values(v).reduce((n,x)=>n+x,0);
function partner({legacy=false,missing=false}={}){
 const old=legacy?{date:"2026-11-17",data:{
   source:"quick-counts-v1",hubCompanyId:"hub",partnerCompanyId:"partner",
   date:"2026-11-17",counts:{...zero(),"SB光・AIR":4},totalCount:4}}:null;
 const now={...zero(),NURO:2,"SB光・AIR":3};
 const entry={
   companyId:"partner",hubCompanyId:"hub",date:day,staffId:"staffA",
   version:1,teamIdSnapshot:"team1",staffNameSnapshot:"担当者A",
   counts:now,totalCount:totals(now)
 };
 const report={date:day,data:{
   hubCompanyId:"hub",partnerCompanyId:"partner",date:day,
   source:"staff-entries-v1",counts:now,totalCount:5}};
 const source={
   cid:"partner",name:"協力店A",approved:true,
   allowedCategories:["NURO","SB光・AIR"],
   teams:[{id:"team1",name:"1班"}],
   entries:[{id:day+"__staffA",data:entry}],
   reports:old?[old,report]:[report]
 };
 const sources=[source];
 if(missing)sources.push({
  cid:"partnerB",name:"協力店B",approved:true,
  allowedCategories:["NURO"],teams:[{id:"teamB",name:"2班"}],
  entries:[],reports:[{date:day,data:null}]
 });
 return buildApprovedPartnerCountStandings({
  hubId:"hub",start:legacy?"2026-11-17":day,end:day,sources
 });
}
const invalid=fn=>assert.throws(fn,/NICO_COUNT_AI_REPORT_SOURCE_UNVERIFIED/);
test("real verified partner source: 2 NURO + 3 SB光AIR counted once; nothing read or written",()=>{
 const snapshot=partner();
 assert.equal(snapshot.totalCount,5);
 assert.equal(snapshot.products.reduce((n,p)=>n+p.totalCount,0),5);
 const before=structuredClone(snapshot);
 const output=buildVerifiedPartnerCountBriefing(snapshot);
 assert.equal(output.totalCount,5);
 assert.equal(output.reportStatus,"verified");
 assert.match(output.content,/NURO 2件/);
 assert.match(output.content,/SB光・AIR 3件/);
 assert.match(output.content,/班別（上位）/);
 assert.equal(output.rawSourceWrites,0);
 assert.equal(output.aiModelInvoked,false);
 assert.equal(output.deliveryEnabled,false);
 assert.deepEqual(snapshot,before);
});
test("legacy company-only count remains in report, never assigned to fictional team or individual",()=>{
 const snapshot=partner({legacy:true});
 assert.equal(snapshot.totalCount,9);
 assert.equal(snapshot.historicalCompanyOnlyCount,4);
 assert.equal(snapshot.teams[0].totalCount,5);
 const out=buildVerifiedPartnerCountBriefing(snapshot);
 assert.equal(out.totalCount,9);
 assert.equal(out.historicalCompanyOnlyCount,4);
 assert.equal(out.reportStatus,"incomplete");
 assert.match(out.content,/過去の会社単位実績：4件/);
 assert.doesNotMatch(out.content,/班別（上位）/);
 assert.doesNotMatch(out.content,/個人別（上位）/);
});
test("missing partner is not 0件報告; reports remain incomplete",()=>{
 const s=partner({missing:true});
 const result=buildVerifiedPartnerCountBriefing(s);
 assert.equal(result.totalCount,5);
 assert.equal(result.unreportedCompanyCount,1);
 assert.equal(result.reportStatus,"incomplete");
 assert.match(result.content,/未報告の会社：協力店B/);
});
test("zero submitted and zero unreported do not become invented activity",()=>{
 const source={
  cid:"partner",name:"協力店A",approved:true,
  allowedCategories:["NURO"],teams:[{id:"team1",name:"1班"}],
  entries:[{id:day+"__staffA",data:{
   companyId:"partner",hubCompanyId:"hub",date:day,staffId:"staffA",
   version:1,teamIdSnapshot:"team1",staffNameSnapshot:"担当者A",
   counts:zero(),totalCount:0}}],
  reports:[{date:day,data:{hubCompanyId:"hub",partnerCompanyId:"partner",
   date:day,source:"staff-entries-v1",counts:zero(),totalCount:0}}]
 };
 const verified=buildApprovedPartnerCountStandings({hubId:"hub",start:day,end:day,sources:[source]});
 const result=buildVerifiedPartnerCountBriefing(verified);
 assert.equal(result.reportCount,1);
 assert.equal(result.totalCount,0);
 assert.match(result.content,/報告済み日報：1件/);
 assert.doesNotMatch(result.content,/報告済みデータがありません/);
});
test("only exact canonical verified count source accepted, not client arbitrary partial data",()=>{
 const s=partner();
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,scope:"unverified_company_totals"}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,fullyJoint:true}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,includesDirect:true}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,schema:"random"}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,totalCount:6}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,reportCount:-1}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,unreportedCompanies:undefined}));
});
test("reject raw financial fields, personal identifiers, contacts, price-laden names",()=>{
 const s=partner();
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,revenue:125000}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,companies:[{...s.companies[0],email:"x@example.test"}]}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,people:[{...s.people[0],uid:"secret"}]}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,products:[{...s.products[0],name:"商品 CB10000円"}]}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,teams:[{...s.teams[0],counts:{...s.teams[0].counts,revenue:7000}}]}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,records:[{uid:"secret"}]}));
});
test("approved model input contains no names, staff IDs, original documents or financial fields",()=>{
 const s=partner({legacy:true,missing:true});
 const input=prepareCountOnlyAiModelInput(s);
 const serialized=JSON.stringify(input);
 assert.equal(input.totalCount,9);
 assert.equal(input.historicalUnassignedCount,4);
 assert.equal(input.missingCompanyCount,1);
 assert.deepEqual(input.categoryTotals.reduce((n,v)=>n+v.count,0),9);
 for(const secret of ["協力店A","協力店B","担当者A","staffA","team1",
  "uid","person","teamName","revenue","unitPrice","cashback","万円","¥","￥"])
  assert.equal(serialized.includes(secret),false,secret);
 assert.equal(JSON.stringify(input).includes("9"),true);
});
test("report plan default is OFF and blocks accidental scheduled sending or paid AI",()=>{
 const p=createCountAutoReportPlan();
 assert.equal(p.timeZone,"Asia/Tokyo");
 assert.equal(p.sendEnabled,false);
 assert.equal(p.firestoreWrites,0);
 assert.equal(p.modelCalls,0);
 assert.equal(p.paidServicesEnabled,false);
 assert.ok(p.notifications.some(v=>v.kind==="weekly"));
 invalid(()=>createCountAutoReportPlan({enabled:true}));
 invalid(()=>createCountAutoReportPlan({channels:["LINE"]}));
});
test("invalid dates and rank drift fail closed before any report",()=>{
 const s=partner();
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,start:"2026-11-31"}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,end:"2026-11-17"}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,products:[
  {...s.products[0],rank:3},...s.products.slice(1)]}));
 invalid(()=>buildVerifiedPartnerCountBriefing({...s,products:[
  {...s.products[0],totalCount:5},...s.products.slice(1)]}));
});
