const fs=require("node:fs");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const path=require("node:path");
const {test}=require("node:test");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");

function source(name){
  const start=html.indexOf("function "+name+"(");
  assert(start>=0,"Missing "+name);
  const end=html.indexOf("\n}",start);
  assert(end>start,"Missing end "+name);
  return html.slice(start,end+2);
}
function ctx(functions,extras={}){
  const c=vm.createContext(extras);
  vm.runInContext(functions.map(source).join("\n"),c);
  return c;
}
const catalog=[
  {id:"electric",name:"とくする電気",pricingOptions:[{cashback:0,revenuePerUnit:10000}]},
  {id:"zero",name:"無料商材",pricingOptions:[{cashback:0,revenuePerUnit:0}]}
];
const entry=(n,p,id="electric")=>({productId:id,productName:id==="electric"?"とくする電気":"無料商材",cashback:0,count:n,revenuePerUnit:p});
const record=(detail,totalRevenue,count=detail.count)=>({
  id:"r1",date:"2026-10-23",results:{electric:detail},totalCount:count,totalRevenue
});
const raw=rows=>JSON.stringify(rows);
function audit(){
  return ctx(["auditFinancialRecords","getRecordResults","getProductPricingOptions"],{
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false}),
    normalizeCashbackOptions:x=>[...new Set([0,...(x||[])])].sort((a,b)=>a-b),
    formatYen:n=>"¥"+Number(n).toLocaleString("en-US")
  });
}

test("5 deals saved at 2000 produce 10000; current 10000-unit master is flagged for owner review only",()=>{
  const v=audit(), rec=record(entry(5,2000),10000),before=raw(rec);
  const found=v.auditFinancialRecords([rec],catalog);
  assert.equal(found.length,1);
  assert.equal(found[0].type,"master_price_difference");
  assert(found[0].note.includes("保存単価 ¥2,000"));
  assert(found[0].note.includes("現在設定 ¥10,000"));
  assert.equal(raw(rec),before,"audit must not mutate any saved fields");
});
test("When master really is 2000 the arithmetic is correct, not silently rewritten to 50000",()=>{
  const v=audit(),rec=record(entry(5,2000),10000);
  const found=v.auditFinancialRecords([rec],[{id:"electric",pricingOptions:[{cashback:0,revenuePerUnit:2000}]}]);
  assert.equal(found.length,0);
  assert.equal(rec.totalRevenue,10000);
});
test("5 deals at 10000 make 50000 and have no reconciliation findings",()=>{
  const v=audit(),rec=record(entry(5,10000),50000);
  assert.equal(v.auditFinancialRecords([rec],catalog).length,0);
});
test("New entries automatically use selected NURO cashback-specific sales rate or refuse an outdated unit price",()=>{
  const v=ctx(["verifyNewRecordPricing","getProductPricingOptions"],{
    parseLegacyCashbackProductName:()=>({hasCashbackPlan:false})
  });
  const nuro={id:"nuro",name:"NURO光",pricingOptions:[
    {cashback:0,revenuePerUnit:25000},
    {cashback:20000,revenuePerUnit:22500}
  ]};
  const valid={base:{productId:"nuro",count:4,cashback:0,revenuePerUnit:25000},
    cashback:{productId:"nuro",count:5,cashback:20000,revenuePerUnit:22500}};
  assert.equal(v.verifyNewRecordPricing(valid,[nuro]),"");
  const corrupted={...valid,cashback:{...valid.cashback,revenuePerUnit:25000}};
  assert.match(v.verifyNewRecordPricing(corrupted,[nuro]),/単価/);
  const wrongCB={...valid,cashback:{...valid.cashback,cashback:30000}};
  assert.match(v.verifyNewRecordPricing(wrongCB,[nuro]),/CBプラン/);
});
test("New CB0 electricity entry with five deals rejects unit 2000 and accepts unit 10000",()=>{
  const v=ctx(["verifyNewRecordPricing","getProductPricingOptions"],{});
  const electric=catalog[0];
  const bad={electric:{...entry(5,2000)}};
  assert.match(v.verifyNewRecordPricing(bad,[electric]),/単価/);
  bad.electric.revenuePerUnit=10000;
  assert.equal(v.verifyNewRecordPricing(bad,[electric]),"");
  const free={free:{productId:"zero",count:3,cashback:0,revenuePerUnit:0}};
  assert.equal(v.verifyNewRecordPricing(free,[catalog[1]]),"");
});
test("Edit path only applies new price validation if no saved record exists",()=>{
  const marker="if (!existingDailyRecord && !zeroResultSubmission)";
  assert(html.includes(marker));
  assert(html.includes("verifyNewRecordPricing(results, products)"));
});
test("NURO光: same product with different CB plans uses each plan price, never nine times one flat rate",()=>{
  const nuro={
    id:"nuro",name:"NURO光",
    pricingOptions:[
      {cashback:0,revenuePerUnit:25000},
      {cashback:20000,revenuePerUnit:22500}
    ]
  };
  const v=ctx(["getProductPricingOptions","calculateResultsTotals","getRecordResults","validateFinancialRecordForSave","auditFinancialRecords"],{
    recordConflict:m=>Object.assign(new Error(m),{code:"record-conflict"}),
    formatYen:n=>"¥"+Number(n).toLocaleString("ja-JP")
  });
  const options=v.getProductPricingOptions(nuro);
  assert.equal(options.length,2);
  assert.equal(options[0].revenuePerUnit,25000);
  assert.equal(options[1].revenuePerUnit,22500);
  const results={
    "nuro__cb_0":{productId:"nuro",productName:"NURO光",cashback:0,count:4,revenuePerUnit:25000},
    "nuro__cb_20000":{productId:"nuro",productName:"NURO光",cashback:20000,count:5,revenuePerUnit:22500}
  };
  const totals=v.calculateResultsTotals(results);
  assert.equal(totals.count,9);
  assert.equal(totals.revenue,212500);
  const data={id:"mixed-nuro",date:"2026-10-23",results,totalCount:9,totalRevenue:212500};
  const original=raw(data);
  assert.equal(v.validateFinancialRecordForSave(data),true);
  assert.equal(v.getRecordResults(data).length,2);
  assert.equal(v.auditFinancialRecords([data],[nuro]).length,0);
  assert.equal(raw(data),original);
});

test("NURO historical CB price is not retroactively replaced if the current product pricing differs",()=>{
  const v=audit();
  const saved={
    id:"old-nuro",date:"2026-10-01",
    results:{"nuro__cb_20000":{
      productId:"nuro",productName:"NURO光",cashback:20000,
      count:2,revenuePerUnit:22500
    }},totalCount:2,totalRevenue:45000
  };
  const before=raw(saved);
  const nuroNow={id:"nuro",name:"NURO光",pricingOptions:[
    {cashback:0,revenuePerUnit:25000},{cashback:20000,revenuePerUnit:23000}
  ]};
  const findings=v.auditFinancialRecords([saved],[nuroNow]);
  assert(findings.some(f=>f.type==="master_price_difference"));
  assert.equal(saved.totalRevenue,45000);
  assert.equal(raw(saved),before);
});

test("Old electric record without cashback field is compared against its only valid CB0 price",()=>{
  const v=audit();
  const old={id:"electric-legacy",date:"2026-10-22",
    results:{electric:{productId:"electric",productName:"とくする電気",
      count:5,revenuePerUnit:2000}},
    totalCount:5,totalRevenue:10000
  };
  const saved=raw(old);
  const findings=v.auditFinancialRecords([old],catalog);
  assert(findings.some(f=>f.type==="master_price_difference"));
  assert.equal(raw(old),saved);
});

test("Missing NURO cashback selection must be flagged, never default all deals to CB0 25000",()=>{
  const v=audit();
  const nuro={id:"nuro",name:"NURO光",pricingOptions:[
    {cashback:0,revenuePerUnit:25000},
    {cashback:20000,revenuePerUnit:22500}
  ]};
  const prior={id:"legacy-unknown",date:"2026-10-22",
    results:{"nuro_legacy":{productId:"nuro",productName:"NURO光",count:9,revenuePerUnit:20000}},
    totalCount:9,totalRevenue:180000};
  const stored=raw(prior);
  const findings=v.auditFinancialRecords([prior],[nuro]);
  assert(findings.some(f=>f.type==="missing_cb_plan"));
  assert(!findings.some(f=>f.type==="master_price_difference"));
  assert.equal(raw(prior),stored);
});

test("Legacy CB2000 revenue fallback is flagged for review without assuming an automatic 50000 correction",()=>{
  const v=audit();
  const oldProduct={id:"electric",name:"とくする電気",revenue:10000,cashbackOptions:[0,2000]};
  const legacy=entry(5,2000);
  legacy.cashback=2000;
  const rec=record(legacy,10000);
  const before=raw(rec);
  const findings=v.auditFinancialRecords([rec],[oldProduct]);
  assert(findings.some(item=>item.type==="legacy_cb_rate"));
  assert(findings.some(item=>item.note.includes("旧CBプラン")));
  assert.equal(rec.totalRevenue,10000);
  assert.equal(raw(rec),before);
});
test("Saved record header and line-item calculation mismatches are reported without data modification",()=>{
  const v=audit(),rec=record(entry(5,10000),10000,4),before=raw(rec);
  const types=v.auditFinancialRecords([rec],catalog).map(x=>x.type);
  assert.deepEqual([...types],["count_mismatch","revenue_mismatch"]);
  assert.equal(raw(rec),before);
});
test("Zero-priced legitimate products and missing historical products are not auto-repriced",()=>{
  const v=audit();
  const old={id:"r2",date:"2026-10-23",results:{
    zero:entry(3,0,"zero"),deleted:{productId:"deleted",productName:"廃止商材",count:2,revenuePerUnit:3000}
  },totalCount:5,totalRevenue:6000};
  const before=raw(old);
  assert.equal(v.auditFinancialRecords([old],catalog).length,0);
  assert.equal(raw(old),before);
});
test("Counts and rates must be safe nonnegative integers; line sums MUST match record headers",()=>{
  const v=ctx(["validateFinancialRecordForSave"],{
    recordConflict:message=>Object.assign(new Error(message),{code:"record-conflict"})
  });
  assert.equal(v.validateFinancialRecordForSave({results:{electric:entry(5,10000)},totalCount:5,totalRevenue:50000}),true);
  assert.equal(v.validateFinancialRecordForSave({results:{electric:entry(5,2000)},totalCount:5,totalRevenue:10000}),true);
  for(const data of [
    {results:{electric:entry(5,2000)},totalCount:5,totalRevenue:50000},
    {results:{electric:entry(5,10000)},totalCount:4,totalRevenue:50000},
    {results:{electric:entry(5,NaN)},totalCount:5,totalRevenue:0},
    {results:{electric:entry(5,-2000)},totalCount:5,totalRevenue:-10000},
    {results:{electric:entry(1.5,10000)},totalCount:1.5,totalRevenue:15000},
    {results:{electric:entry(5,Infinity)},totalCount:5,totalRevenue:Infinity},
    {results:{electric:entry(500000000,9999999999)},totalCount:500000000,totalRevenue:1}
  ])assert.throws(()=>v.validateFinancialRecordForSave(data),{code:"record-conflict"});
});

test("Average saved revenue is shown ONLY to Owner; ordinary users cannot see revenue or unit prices",()=>{
  const v=ctx(["renderAnalysisProductCards"],{
    sortedAnalysisValues:p=>Object.values(p),
    canCurrentUserViewProductRevenue:()=>true,
    isCurrentCompanyOwner:()=>true,
    escapeHtml:s=>s,
    formatYen:n=>"¥"+Number(n).toLocaleString("en-US")
  });
  const values={electric:{name:"とくする電気",count:5,revenue:10000}};
  const full=v.renderAnalysisProductCards(values);
  assert(full.includes("¥10,000"));
  assert(full.includes("保存額の平均：¥2,000/件"));
  v.isCurrentCompanyOwner=()=>false;
  const limited=v.renderAnalysisProductCards(values);
  assert(!limited.includes("保存額の平均"));
  v.canCurrentUserViewProductRevenue=()=>false;
  const hidden=v.renderAnalysisProductCards(values);
  assert(!/¥|保存額|revenuePerUnit/.test(hidden));
});

test("Audit panel is Owner-only and shows no sensitive error details to ordinary members",()=>{
  const make=()=>({children:[],style:{},textContent:"",className:"",
    _html:"",set innerHTML(x){this._html=x;this.children=[];},
    get innerHTML(){return this._html},
    appendChild(x){this.children.push(x);}
  });
  const productSummaryList=make();
  const summaryCount=make();
  const v=ctx(["renderProductSummary"],{
    productSummaryList,productSummaryCount:summaryCount,document:{createElement:make},
    isCurrentCompanyOwner:()=>false,
    auditFinancialRecords:()=>{throw Error("must not access sensitive audit while not owner")},
    canCurrentUserViewProductRevenue:()=>false,products:catalog,escapeHtml:s=>s,
    formatYen:n=>"¥"+n
  });
  const summary={electric:{name:"とくする電気",count:5,revenue:10000}};
  v.renderProductSummary(summary,[]);
  assert.equal(productSummaryList.children.length,1);
  assert.equal(productSummaryList.children[0].className,"summary-row");
  v.isCurrentCompanyOwner=()=>true;
  v.auditFinancialRecords=()=>[{date:"2026-10-23",note:"保存単価 ¥2,000 / 現在設定 ¥10,000"}];
  v.renderProductSummary(summary,[]);
  assert.equal(productSummaryList.children.length,2);
  const panel=productSummaryList.children[0];
  assert(panel.children[0].textContent.includes("金額要確認：1項目"));
  assert(panel.children[2].textContent.includes("¥2,000"));
});
