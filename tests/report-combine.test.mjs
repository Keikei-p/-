import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCombinedReportPlan,buildCombinedReportData,
  formatCombinedCountsReport,formatCombinedMissingReminder
} from "../reports/combine.mjs";

const hubSettings={
 enabled:true,lineEnabled:true,lineGroupId:"G_line_group",
 aggregatePartnerReports:true,linkedCompanyIds:["partner-one","partner-two"],
 partnerTeamIds:["own-partner-team"]
};
const source=(id,settings,name=id)=>({id,name,active:true,settings});
const hub=source("main-company",hubSettings,"自社");
const child=(id)=>source(id,{
 enabled:true,lineEnabled:true,linkedHubCompanyId:"main-company",
 countsShareApproved:true,countsShareLineGroupId:"G_line_group"
},id);
const companies=[hub,child("partner-one"),child("partner-two")];
const rows=[
 {id:"own-team",name:"自社1班",goalCount:10,currentCount:5,reported:true,
  totalRevenue:999999,pricingOptions:[{unitPrice:15000}]},
 {id:"own-partner-team",name:"協力店2班",goalCount:8,currentCount:3,reported:false,
  cashback:30000}
];
function combined({hubConfig=hub,all=companies,own=rows,
  partners=[
    {companyId:"partner-one",companyName:"協力店A",
      teams:[{id:"p1-team",name:"1班",goalCount:12,currentCount:7,reported:true,revenuePerUnit:20000}]},
    {companyId:"partner-two",companyName:"協力店B",
      teams:[{id:"p2-team",name:"2班",goalCount:15,currentCount:2,reported:false,price:15000}]}
  ]}={}){
 const plan=buildCombinedReportPlan({hub:hubConfig,companies:all});
 return {plan,report:buildCombinedReportData({plan,hubTeams:own,partnerSources:partners})};
}
test("own and cross-company partner counts become one morning/final message",()=>{
 const original=JSON.stringify({companies,rows});
 const {plan,report}=combined();
 assert.deepEqual(plan.partnerCompanyIds,["partner-one","partner-two"]);
 assert.equal(report.ownTeams.length,1);
 assert.equal(report.partners.length,3);
 assert.equal(report.totalGoalCount,45);
 assert.equal(report.totalCurrentCount,17);
 for(const period of ["morning","final"]){
  const body=formatCombinedCountsReport({date:"2026-10-29",period,report});
  assert.match(body,/🏢自社/);
  assert.match(body,/🤝協力店/);
  assert.match(body,/協力店2班/);
  assert.match(body,/協力店A/);
  assert.match(body,/協力店B/);
  assert.match(body,/合計目標：45件/);
  assert.match(body,/合計実績：17件/);
  assert.doesNotMatch(body,/999999|30000|20000|15000|unitPrice|revenuePerUnit|cashback|totalRevenue/);
 }
 assert.equal(JSON.stringify({companies,rows}),original,"source state must never mutate");
});
test("missing reminder includes unreported own partner team and linked company team",()=>{
 const {report}=combined();
 const body=formatCombinedMissingReminder({date:"2026-10-29",report});
 assert.match(body,/自社登録の協力店：協力店2班：未報告/);
 assert.match(body,/協力店B：2班：未報告/);
 assert.doesNotMatch(body,/協力店A：1班：未報告/);
 assert.doesNotMatch(body,/円|単価/);
});
test("no missing teams creates no unnecessary LINE reminder",()=>{
 const {report}=combined();
 for(const t of report.ownTeams)t.reported=true;
 for(const p of report.partners)for(const t of p.teams)t.reported=true;
 assert.equal(formatCombinedMissingReminder({date:"2026-10-29",report}),"");
});
test("cross-company sharing without explicit reciprocal consent refuses to combine",()=>{
 const changes=[
   {...child("partner-one"),settings:{...child("partner-one").settings,countsShareApproved:false}},
   {...child("partner-one"),settings:{...child("partner-one").settings,linkedHubCompanyId:"other-hub"}},
   {...child("partner-one"),settings:{...child("partner-one").settings,countsShareLineGroupId:"other-group"}},
   {...child("partner-one"),settings:{...child("partner-one").settings,enabled:false}},
   {...child("partner-one"),active:false}
 ];
 for(const changed of changes){
  assert.throws(()=>buildCombinedReportPlan({
   hub,companies:[hub,changed,child("partner-two")]
  }),/reciprocal consent|inactive/);
 }
 assert.throws(()=>buildCombinedReportPlan({
  hub,companies:[hub,child("partner-one")]
 }),/Missing or inactive/);
});
test("hub must opt in and cannot select its own company or duplicate linked company",()=>{
 const config=(overrides)=>source("main-company",{...hubSettings,...overrides});
 assert.deepEqual(buildCombinedReportPlan({hub:config({aggregatePartnerReports:false}),companies}).partnerCompanyIds,[]);
 assert.throws(()=>buildCombinedReportPlan({
  hub:config({linkedCompanyIds:["main-company"]}),companies
 }),/itself/);
 assert.throws(()=>buildCombinedReportPlan({
  hub:config({linkedCompanyIds:["partner-one","partner-one"]}),companies
 }),/allowlist/);
 assert.throws(()=>buildCombinedReportPlan({
  hub:config({enabled:false}),companies
 }),/not enabled/);
});
test("missing partner report or extra company blocks the whole message",()=>{
 const {plan}=combined();
 assert.throws(()=>buildCombinedReportData({
  plan,hubTeams:rows,partnerSources:[]
 }),/incomplete/);
 assert.throws(()=>buildCombinedReportData({
  plan,hubTeams:rows,
  partnerSources:[{companyId:"unexpected",companyName:"Other",teams:[]}]
 }),/incomplete/);
});
test("duplicate team in a company, absent configured team and unsafe counts fail closed",()=>{
 const {plan}=combined();
 const linked=[
  {companyId:"partner-one",companyName:"A",teams:[{
    id:"duplicate",name:"A",goalCount:1,currentCount:0
  },{id:"duplicate",name:"B",goalCount:1,currentCount:0}]},
  {companyId:"partner-two",companyName:"B",teams:[]}
 ];
 assert.throws(()=>buildCombinedReportData({
   plan,hubTeams:rows,partnerSources:linked
 }),/Duplicate report team/);
 assert.throws(()=>buildCombinedReportData({
   plan,hubTeams:[rows[0]],partnerSources:[]
 }),/Configured partner team not found/);
 assert.throws(()=>combined({
   own:[{...rows[0],currentCount:-1},rows[1]]
 }),/Invalid count/);
});
test("company label with cashback figures or newlines is sanitized",()=>{
 const a=combined({partners:[
  {companyId:"partner-one",companyName:"協力店 CB20000",teams:[{id:"p1",name:"1班",goalCount:1,currentCount:1,reported:true}]},
  {companyId:"partner-two",companyName:"協力店 ￥3000",teams:[{id:"p2",name:"2班",goalCount:1,currentCount:0,reported:true}]}
 ]});
 const body=formatCombinedCountsReport({date:"2026-10-29",period:"final",report:a.report});
 assert.doesNotMatch(body,/20000|3000|CB|￥/);
 assert.match(body,/名称は管理者確認中/);
});
