"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

// Fictional data only. Never reads production Firestore, user identities or prices.
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
function source(name){
  let p=html.indexOf("function "+name+"(");
  assert(p>=0,"missing "+name);
  if(html.slice(p-6,p)==="async ")p-=6;
  const end=html.indexOf("\n}",p);
  assert(end>p,"unterminated "+name);
  return html.slice(p,end+2);
}
function context(names,values={}){
  const scope=vm.createContext(values);
  vm.runInContext(names.map(source).join("\n"),scope);
  return scope;
}
const catalog=[
  {id:"electric",name:"とくする電気",revenue:10000,
    pricingOptions:[{cashback:0,revenuePerUnit:10000}]},
  {id:"nuro",name:"NURO光",revenue:25000,
    pricingOptions:[{cashback:0,revenuePerUnit:25000},{cashback:20000,revenuePerUnit:22500}]},
  {id:"zero",name:"売上0円の商材",revenue:0,
    pricingOptions:[{cashback:0,revenuePerUnit:0}]}
];
const row=(productId,count,rate,cashback=0)=>({
  productId,productName:catalog.find(p=>p.id===productId).name,
  cashback,count,revenuePerUnit:rate
});
function fixtures(){
  return [
    {id:"r1",companyId:"c",uid:"member-a",memberNameSnapshot:"社員A",
      date:"2026-10-22",teamId:"team4",teamNameSnapshot:"4班",
      results:{electric:row("electric",5,10000),zero:row("zero",3,0)},
      totalCount:8,totalRevenue:50000},
    {id:"r2",companyId:"c",uid:"member-b",memberNameSnapshot:"社員B",
      date:"2026-10-21",teamId:"team1",teamNameSnapshot:"1班",
      results:{nuro0:row("nuro",4,25000,0),nuro20000:row("nuro",5,22500,20000)},
      totalCount:9,totalRevenue:212500},
    {id:"r3",companyId:"c",uid:"member-b",memberNameSnapshot:"社員B",
      date:"2026-10-23",teamId:"team1",teamNameSnapshot:"1班",
      results:{electric:row("electric",2,10000)},
      totalCount:2,totalRevenue:20000}
  ];
}
function arithmeticContext(records){
  const teams=[{id:"team1",name:"1班",active:true},{id:"team4",name:"4班",active:true}];
  return context([
    "getRecordResults","getDisplayRecordResults","calculateResultsTotals",
    "revenueFromRecord","addAnalysisValue","buildSalesAnalysis",
    "recordBelongsToTeam","buildTeamRevenueGoalProgress",
    "buildRevenueChartData","revenueChartScopeRevenue","buildRevenueChartSeries",
    "buildTeamRankingRows"
  ],{
    records,teams,products:catalog,dashboardMonth:{value:"2026-10"},
    currentCompanyData:{name:"架空会社"},revenueChartMode:"monthly",
    revenueChartValueMode:"cumulative",
    getCurrentMemberName:r=>r.memberNameSnapshot,
    getCurrentTeamName:r=>r.teamNameSnapshot,
    currentProductDisplayName:r=>catalog.find(p=>p.id===r.productId)?.name||r.productName,
    canCurrentUserViewRevenueForRecord:()=>true,
    canCurrentUserViewRevenueForTeam:()=>true,
    isCurrentCompanyMaster:()=>true,isCurrentCompanyOwner:()=>true,
    getTeamRevenueGoal:()=>({targetRevenue:1000000}),
    getTodayString:()=> "2026-10-23",
    revenueChartColor:()=>"#888888",
    buildTeamGoalProgress:()=>({totalTarget:0,totalActual:0,progress:0}),
  });
}
test("Every stored row and daily heading use count times its OWN saved unit price",()=>{
  const records=fixtures(),before=JSON.stringify(records),s=arithmeticContext(records);
  for(const record of records){
    const totals=s.calculateResultsTotals(record.results);
    assert.equal(totals.count,record.totalCount);
    assert.equal(totals.revenue,record.totalRevenue);
    assert.equal(s.revenueFromRecord(record),record.totalRevenue);
  }
  assert.equal(JSON.stringify(records),before,"read-only calculation must preserve history");
});
test("Monthly total equals product analysis, individual sum, team sum and chart cumulative total",()=>{
  const records=fixtures(),before=JSON.stringify(records),s=arithmeticContext(records);
  const analysis=s.buildSalesAnalysis(records),chart=s.buildRevenueChartData();
  assert.equal(analysis.revenue,282500);
  assert.equal(analysis.count,19);
  assert.equal(Object.values(analysis.products).reduce((n,p)=>n+p.revenue,0),analysis.revenue);
  assert.equal(Object.values(analysis.members).reduce((n,p)=>n+p.revenue,0),analysis.revenue);
  assert.equal(Object.values(analysis.teams).reduce((n,p)=>n+p.revenue,0),analysis.revenue);
  assert.equal(analysis.products.electric.revenue,70000);
  assert.equal(analysis.products.electric.count,7);
  assert.equal(analysis.products.nuro.revenue,212500);
  assert.equal(analysis.products.nuro.count,9);
  assert.equal(analysis.products.zero.revenue,0);
  assert.equal(chart.buckets.reduce((n,b)=>n+b.total,0),analysis.revenue);
  const company=chart.scopes.find(v=>v.isCompany);
  const series=s.buildRevenueChartSeries(chart,company);
  assert.equal(series.at(-1).cumulativeRevenue,analysis.revenue);
  assert.equal(series.reduce((n,v)=>n+v.periodRevenue,0),analysis.revenue);
  assert.equal(JSON.stringify(records),before);
});
test("Team goal revenue and ranking reuse the SAME team totals",()=>{
  const records=fixtures(),s=arithmeticContext(records),analysis=s.buildSalesAnalysis(records);
  const team1={id:"team1",name:"1班"};
  const team4={id:"team4",name:"4班"};
  const goal1=s.buildTeamRevenueGoalProgress(team1,records);
  const goal4=s.buildTeamRevenueGoalProgress(team4,records);
  assert.equal(goal1.actualRevenue,232500);
  assert.equal(goal4.actualRevenue,50000);
  assert.equal(goal1.actualRevenue,analysis.teams.team1.revenue);
  assert.equal(goal4.actualRevenue,analysis.teams.team4.revenue);
  assert.equal(goal1.remainingRevenue,767500);
  assert.equal(goal1.progress,23.3);
  const ranking=s.buildTeamRankingRows(analysis.teams,records,"revenue");
  assert.equal(ranking.find(x=>x.id==="team1").revenue,goal1.actualRevenue);
  assert.equal(ranking.find(x=>x.id==="team4").revenue,goal4.actualRevenue);
});
test("New count uses explicit product+CB rate, including mixed NURO tiers",()=>{
  const v=context(["getProductPricingOptions","verifyNewRecordPricing","calculateResultsTotals"],{
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false})
  });
  const valid={n0:row("nuro",4,25000,0),n20:row("nuro",5,22500,20000),
    electric:row("electric",5,10000),zero:row("zero",2,0)};
  assert.equal(v.verifyNewRecordPricing(valid,catalog),"");
  assert.equal(v.calculateResultsTotals(valid).revenue,262500);
  assert.match(v.verifyNewRecordPricing({e:row("electric",5,2000)},catalog),/単価/);
  assert.match(v.verifyNewRecordPricing({n:row("nuro",5,20000,20000)},catalog),/単価/);
  assert.match(v.verifyNewRecordPricing({n:row("nuro",5,22500,99999)},catalog),/CBプラン/);
  assert.match(v.verifyNewRecordPricing({n:row("nuro",1,1,20000)},
    [{id:"nuro",revenue:25000,cashbackOptions:[0,20000]}]),/旧形式/);
});
test("Existing same-count snapshots stay unchanged, increased counts with stale prices are blocked",()=>{
  const v=context(["resultVariantKey","normalizeExistingResultMap",
    "getProductPricingOptions","verifyNewRecordPricing","verifyChangedRecordPricing"],{
      parseLegacyCashbackProductName:()=>({hasCashbackPlan:false})
    });
  const old={e:row("electric",5,2000)};
  const snapshot=JSON.stringify(old);
  assert.equal(v.verifyChangedRecordPricing({e:row("electric",5,2000)},old,catalog),"");
  assert.match(v.verifyChangedRecordPricing({e:row("electric",6,2000)},old,catalog),/単価/);
  assert.equal(v.verifyChangedRecordPricing({e:row("electric",6,10000)},old,catalog),"");
  assert.equal(JSON.stringify(old),snapshot);
});
test("Archived zero unit price is never replaced by current product price",()=>{
  const v=context(["getResultProductPresentation"],{
    products:[{id:"zero",name:"架空商材",revenue:30000}],
    parseLegacyCashbackProductName:n=>({parentName:n,hasCashbackPlan:false}),
    productUsesCashbackPlans:()=>false
  });
  assert.equal(v.getResultProductPresentation({
    productId:"zero",count:3,revenuePerUnit:0}).revenuePerUnit,0);
});

test("Product editor rejects blank, fractional and unsafe amounts; preserves valid CB/yen values",()=>{
  const v=context(["readPricingOptions"]);
  const container=(rows)=>({querySelectorAll:()=>rows.map(([cb,rate])=>({
    querySelector:selector=>({value:selector.includes("pricing-cashback")?cb:rate})
  }))});
  const good=v.readPricingOptions(container([["20000","22500"],["0","25000"]]));
  assert.equal(good.error,"");
  assert.equal(JSON.stringify(good.options),JSON.stringify([
    {cashback:0,revenuePerUnit:25000},
    {cashback:20000,revenuePerUnit:22500}
  ]));
  assert.equal(v.readPricingOptions(container([["0","0"]])).error,"",
    "zero revenue can be intentional");
  for(const [cb,rate] of [["","10000"],["0",""],["1.5","10000"],
    ["0","10000.7"],["0","9007199254740992"],["NaN","10000"],["-1","10000"]]){
    assert.notEqual(v.readPricingOptions(container([[cb,rate]])).error,"");
  }
  assert.match(v.readPricingOptions(container([["0","10000"],["0","20000"]])).error,/重複/);
});
