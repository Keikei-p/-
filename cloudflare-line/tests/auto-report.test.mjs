import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {buildCountOnlyReport,reportTimeDue,previousDay,safeReportLabel} from "../src/auto-report.js";
const id="companyA";
const teams=[
 {companyId:id,id:"team1",name:"1班",active:true},
 {companyId:id,id:"team2",name:"2班",active:true},
 {companyId:"other",id:"foreign",name:"他社"}
];
const products=[
 {companyId:id,id:"nuro",name:"NURO光",revenuePerUnit:25000},
 {companyId:id,id:"ym",name:"YMMNP",revenuePerUnit:15000},
 {companyId:"other",id:"foreign",name:"社外"}
];
const goals=[
 {companyId:id,teamId:"team1",month:"2026-10",targets:{nuro:6,ym:4}},
 {companyId:id,teamId:"team2",month:"2026-10",targets:{nuro:12}},
 {companyId:"other",teamId:"foreign",month:"2026-10",targets:{foreign:999}}
];
const records=[
 {companyId:id,uid:"u1",date:"2026-10-27",teamId:"team1",totalCount:2,results:{
  nuro:{productId:"nuro",count:1,revenuePerUnit:999999,cashback:20000},
  ym:{productId:"ym",count:1,revenuePerUnit:999999}
 }},
 {companyId:id,uid:"u2",date:"2026-10-27",teamId:"team2",totalCount:3,results:{
  nuro:{productId:"nuro",count:3,revenuePerUnit:123456}
 }},
 {companyId:id,uid:"u1",date:"2026-10-26",teamId:"team1",totalCount:1,results:{
  nuro:{productId:"nuro",count:1,revenuePerUnit:98765}
 }},
 {companyId:"other",uid:"foreign",date:"2026-10-27",teamId:"foreign",totalCount:500,results:{
  foreign:{productId:"foreign",count:500}
 }}
];
function build(mode,date,data=records){
 return buildCountOnlyReport({companyId:id,mode,date,records:data,teams,products,goals});
}
test("Report times are exact 5-minute slots with Cron delay and never repeat hourly",()=>{
 assert.equal(reportTimeDue("09:00","09:00"),true);
 assert.equal(reportTimeDue("09:00","09:03"),true);
 assert.equal(reportTimeDue("09:00","09:05"),false);
 assert.equal(reportTimeDue("09:00","10:00"),false);
 assert.equal(reportTimeDue("20:30","20:31"),true);
 assert.equal(reportTimeDue("20:32","20:32"),false);
 assert.equal(reportTimeDue("oops","09:00"),false);
 assert.equal(previousDay("2026-11-01"),"2026-10-31");
 assert.equal(previousDay("2026-03-01"),"2026-02-28");
});
test("Night report uses recorded daily counts and monthly team goals, hides all money and partner sales",()=>{
 const original=JSON.stringify([records,teams,products,goals]);
 const m=build("evening","2026-10-27");
 assert.match(m,/🌸本日最終報告🌸/);
 assert.match(m,/⭐️1班/);
 assert.match(m,/⭐️2班/);
 assert.match(m,/NURO光:1件/);
 assert.match(m,/YMMNP:1件/);
 assert.match(m,/本日:2件/);
 assert.match(m,/月間:3件｜目標:10件｜残り:7件/);
 assert.match(m,/月間:3件｜目標:12件｜残り:9件/);
 assert.match(m,/本日:5件｜月間:6件/);
 assert.match(m,/月間目標:22件｜残り:16件/);
 assert.doesNotMatch(m,/999999|123456|98765|25000|15000|500件|売上|単価|¥|円/);
 assert.equal(JSON.stringify([records,teams,products,goals]),original);
});
test("Morning report references previous day's source date, not current-day results",()=>{
 const m=build("morning","2026-10-26");
 assert.match(m,/🌅朝礼共有🌅/);
 assert.match(m,/昨日:1件/);
 assert.doesNotMatch(m,/本日:/);
 assert.match(m,/月間:1件｜目標:10件/);
});
test("Invalid and ambiguous record counts fail closed, never silently misreport",()=>{
 const duplicate=[...records,{...records[0],id:"extra"}];
 assert.throws(()=>build("evening","2026-10-27",duplicate),/duplicate_day_record/);
 const mismatch=records.map(r=>r.uid==="u2"?{...r,totalCount:9}:r);
 assert.throws(()=>build("evening","2026-10-27",mismatch),/record_total_mismatch/);
 const missingTeam=records.map(r=>r.uid==="u2"?{...r,teamId:null}:r);
 assert.throws(()=>build("evening","2026-10-27",missingTeam),/missing_record_identity/);
 const unknown=records.map(r=>r.uid==="u2"?{...r,results:{bad:{productId:"unknown",count:1}},totalCount:1}:r);
 assert.throws(()=>build("evening","2026-10-27",unknown),/unknown_catalog_product/);
});
test("Money-laden catalog labels and team names are sanitized",()=>{
 assert.equal(safeReportLabel("NURO単価20000円","商材"),"商材");
 assert.equal(safeReportLabel("1班\n詐欺","班"),"班");
 const m=buildCountOnlyReport({
  companyId:id,mode:"evening",date:"2026-10-27",records,goals,
  teams:teams.map(t=>({...t,name:"売上3000円の班"})),
  products:products.map(p=>({...p,name:"利益20000円"}))
 });
 assert.doesNotMatch(m,/売上|利益|20000円/);
});
test("Owner notice tab has independent default-OFF switches; worker kill switch remains disabled",()=>{
 const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
 const rules=readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8");
 const toml=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 for(const id of ["notificationMorningAutoReportEnabled","notificationMorningAutoReportTime",
  "notificationEveningAutoReportEnabled","notificationEveningAutoReportTime",
  "notificationReportWeekdays"]){
  assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,new RegExp('const '+id+'\\s*='));
 }
 assert.doesNotMatch(html,/id="notificationMorningAutoReportEnabled"[^>]*checked/);
 assert.doesNotMatch(html,/id="notificationEveningAutoReportEnabled"[^>]*checked/);
 assert.match(html,/reportsEnabled && !lineGroupId/);
 assert.match(html,/isCurrentCompanyOwner\(\)/);
 assert.match(rules,/'morningAutoReportEnabled'/);
 assert.match(rules,/'eveningAutoReportEnabled'/);
 assert.match(toml,/AUTO_REPORTS_ENABLED = "disabled"/);
});

test("Notification settings load actual selected times; default OFF survives reload",()=>{
 const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
 const start=html.indexOf("function normalizeNotificationSettings(");
 const end=html.indexOf("async function loadNotificationSettings(",start);
 assert.ok(start>0&&end>start,"source extractor found exact normalization boundaries");
 const code=html.slice(start,end);
 const actual=vm.runInNewContext(code+"; normalizeNotificationSettings({morningAutoReportEnabled:true,morningAutoReportTime:'09:15',eveningAutoReportTime:'20:45',reportAutoWeekdays:[0,6]});");
 assert.equal(actual.morningAutoReportEnabled,true);
 assert.equal(actual.eveningAutoReportEnabled,false);
 assert.equal(actual.morningAutoReportTime,"09:15");
 assert.equal(actual.eveningAutoReportTime,"20:45");
 assert.deepEqual(Array.from(actual.reportAutoWeekdays),[0,6]);
 const defaults=vm.runInNewContext(code+";normalizeNotificationSettings(null);");
 assert.equal(defaults.morningAutoReportEnabled,false);
 assert.equal(defaults.eveningAutoReportEnabled,false);
 assert.equal(defaults.morningAutoReportTime,"09:00");
 assert.equal(defaults.eveningAutoReportTime,"20:00");
});
test("Cashback codes inside catalog labels cannot leak through automatic LINE report",()=>{
 assert.equal(safeReportLabel("NURO CB20000","商材"),"商材");
 assert.equal(safeReportLabel("キャッシュバック5000","商材"),"商材");
});
