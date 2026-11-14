"use strict";
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const {test}=require("node:test");

// Execute the real index functions/handler, using the sales-regressions loader
// convention. All records, rates and principals below are fictional; no SDK,
// credentials, network, production project or persisted test data is involved.
const html=fs.readFileSync(process.env.SALES_HTML||path.join(__dirname,"../index.html"),"utf8").replace(/\r\n/g,"\n");
function source(name){
 let start=html.indexOf("function "+name+"(");
 assert(start>=0,"Missing real index function "+name);
 if(html.slice(start-6,start)==="async ")start-=6;
 const end=html.indexOf("\n}",start);
 assert(end>start,"Missing real function end "+name);
 return html.slice(start,end+2);
}
function handler(){
 const start=html.indexOf("saveRecordButton.onclick ="),end=html.indexOf("\n  };",start);
 assert(start>=0&&end>start,"Missing real save button handler");
 return html.slice(start,end+5);
}
const pricingNames=["getProductPricingOptions","verifyNewRecordPricing","verifyChangedRecordPricing",
 "normalizeExistingResultMap","resultVariantKey","parseLegacyCashbackProductName",
 "normalizeCashbackOptions","toHalfWidthNumberText"];
function context(names=pricingNames,values={}){
 const ctx=vm.createContext(values);
 vm.runInContext(names.map(source).join("\n"),ctx);
 return ctx;
}
const clone=x=>structuredClone(x);
const rate=10000,day="2026-11-13",recordId="demoCompany_demoStaff_"+day;
const row=(count,price=rate)=>({productId:"sku",productName:"変更前の商材名",cashback:0,count,revenuePerUnit:price});
const results=count=>count>0?{sku__cb_0:row(count)}:{};
const catalogs={
 legacy:{id:"sku",name:"名称変更後の商材",revenue:rate,cashbackOptions:[0]},
 explicit:{id:"sku",name:"名称変更後の商材",pricingOptions:[{cashback:0,revenuePerUnit:rate}]},
 duplicate:{id:"sku",name:"名称変更後の商材",pricingOptions:[
  {cashback:0,revenuePerUnit:rate},{cashback:0,revenuePerUnit:rate}]}
};

test("real pricing allows unchanged legacy CB0 rates for 5→6, 5→4 and 0→1 without changing source snapshots",()=>{
 const ctx=context();
 for(const [before,after] of [[5,6],[5,4],[0,1]]){
  const old=results(before),next=results(after),catalog=clone(catalogs.legacy);
  next.sku__cb_0.productName=catalog.name;
  const originals=JSON.stringify({old,next,catalog});
  assert.equal(ctx.verifyChangedRecordPricing(next,old,[catalog]),"",before+"→"+after);
  assert.equal(JSON.stringify({old,next,catalog}),originals);
 }
});

test("real pricing resolves renamed products by exact product ID and accepts a unique numeric-string plan",()=>{
 const ctx=context();
 for(const catalog of [catalogs.explicit,{...catalogs.explicit,
  pricingOptions:[{cashback:"0",revenuePerUnit:String(rate)}]}]){
  for(const [before,after] of [[5,6],[5,4],[0,1]]){
   const old=results(before),next=results(after);next.sku__cb_0.productName=catalog.name;
   assert.equal(ctx.verifyChangedRecordPricing(next,old,[clone(catalog)]),"",before+"→"+after);
  }
 }
 assert.notEqual(ctx.verifyChangedRecordPricing(results(6),results(5),[
  {...catalogs.explicit,id:"aDifferentProduct"}]),"","same name cannot substitute a different product ID");
});

test("genuine price changes, unknown rates and duplicate CB options block every changed count without mutation",()=>{
 const ctx=context();
 const invalidCatalogs=[
  {...catalogs.explicit,pricingOptions:[{cashback:0,revenuePerUnit:rate+1}]},
  {...catalogs.legacy,revenue:rate+1},
  {...catalogs.explicit,pricingOptions:[{cashback:0,revenuePerUnit:null}]},
  {...catalogs.legacy,revenue:null},
  catalogs.duplicate,
  {...catalogs.explicit,pricingOptions:[{cashback:0,revenuePerUnit:rate},{cashback:0,revenuePerUnit:rate+1}]},
  {...catalogs.explicit,pricingOptions:[{cashback:0,revenuePerUnit:rate+1},{cashback:0,revenuePerUnit:rate}]}
 ];
 for(const catalog of invalidCatalogs)for(const [before,after] of [[5,6],[5,4],[0,1],[5,0]]){
  const old=results(before),next=results(after),original=JSON.stringify({old,next,catalog});
  assert.notEqual(ctx.verifyChangedRecordPricing(next,old,[catalog]),"",before+"→"+after+" must stop");
  assert.equal(JSON.stringify({old,next,catalog}),original);
 }
 // An unchanged historical count may stay saved at its original rate, but a
 // caller cannot replace that rate to match today's catalog without an audit.
 assert.equal(ctx.verifyChangedRecordPricing(results(5),results(5),[invalidCatalogs[0]]),"");
 assert.notEqual(ctx.verifyChangedRecordPricing({sku__cb_0:row(5,rate+1)},results(5),[invalidCatalogs[0]]),"");
});

test("real input groups retain unknown historical rates and unchanged counts cannot turn null or blank prices into zero",()=>{
 const ctx=context([...pricingNames,"buildProductInputGroups"],{
  products:[clone(catalogs.explicit)],formatCashbackPlanLabel:()=>"サンプルプラン"
 });
 for(const unknown of [null,"",undefined]){
  const old={sku__cb_0:{...row(5),revenuePerUnit:unknown}},before=JSON.stringify(old);
  const groups=ctx.buildProductInputGroups(old);
  assert.equal(groups[0].plans[0].revenuePerUnit,null,"unknown snapshot must stay unknown in its input");
  assert.notEqual(ctx.verifyChangedRecordPricing({sku__cb_0:row(5,0)},old,[catalogs.explicit]),"",
   "same count cannot silently replace unknown history with zero");
  assert.notEqual(ctx.verifyChangedRecordPricing(clone(old),old,[catalogs.explicit]),"",
   "unknown saved rate requires review even if count is unchanged");
  assert.equal(JSON.stringify(old),before);
 }
});

const node=value=>({value:value||"",textContent:"",style:{},disabled:false,inert:false,
 setAttribute(k,v){this[k]=v;}});
function storeFixture(before=5){
 const original={companyId:"demoCompany",uid:"demoStaff",date:day,teamId:"demoTeam",
  memberNameSnapshot:"匿名担当者",teamNameSnapshot:"匿名班",workLocation:"匿名現場",
  results:results(before),totalCount:before,totalRevenue:before*rate,
  reportStatus:before?"submitted":"no_result",updatedAt:{seconds:1},
  createdAt:{seconds:0},createdByUid:"originalCreator",keepOriginalMetadata:{kept:true}};
 const priorAudit={recordId,before:{totalCount:before},after:{totalCount:before},marker:"old-audit-unchanged"};
 const docs=new Map([["records/"+recordId,clone(original)],["recordCorrections/original",priorAudit]]);
 let serial=0,stamp=2,queue=Promise.resolve(),pause=null,auditFailure=false,commits=0;
 const snapshot=ref=>({id:ref.id,exists:()=>docs.has(ref.path),data:()=>clone(docs.get(ref.path))});
 return {docs,original,priorAudit,snapshot,get commits(){return commits;},
  timestamp:()=>({seconds:stamp++}),setPause:value=>{pause=value;},failAudit:()=>{auditFailure=true;},
  doc:(...args)=>args.length===1?{id:"audit"+(++serial),path:"recordCorrections/audit"+serial}:
   {id:args[2],path:args[1]+"/"+args[2]},
  getDocs:async()=>{const found=[...docs].filter(([key,x])=>key.startsWith("records/")&&x.uid==="demoStaff"&&x.date===day);
   return {size:found.length,docs:found.map(([key])=>({id:key.split("/")[1]}))};},
  runTransaction:(_db,callback)=>{
   const run=async()=>{
    if(pause)await pause;
    const staged=[];
    await callback({get:async ref=>snapshot(ref),set:(ref,data,options)=>{
     if(auditFailure&&ref.path.startsWith("recordCorrections/"))throw Error("DEMO_AUDIT_WRITE_DENIED");
     staged.push({ref,data:clone(data),options});
    }});
    for(const {ref,data,options} of staged){
     const saved=options?.mergeFields?{...docs.get(ref.path),...Object.fromEntries(options.mergeFields.map(k=>[k,data[k]]))}:data;
     docs.set(ref.path,saved);
    }
    commits++;return true;
   };
   const pending=queue.then(run);queue=pending.catch(()=>{});return pending;
  }
 };
}
function saveHost({before=5,after=6,catalog=catalogs.explicit,store=storeFixture(before)}={}){
 const errors=[],success=[];
 const input={value:String(after),dataset:{productId:"sku",productName:catalog.name,
  cashback:"0",revenuePerUnit:String(rate),resultKey:"sku__cb_0"}};
 const ctx=context([...pricingNames,"getCurrentInputResults","validateProductInputRows","calculateResultsTotals",
  "recordRevision","recordConflict","persistDailyRecord","validateFinancialRecordForSave","findDailyRecord","setRecordSaveInProgress"],{
  db:{projectId:"demo-nico-pricing-hotfix"},saveRecordButton:node(),recordSaveInProgress:false,
  recordSaveStatus:node(),recordManagement:node(),zeroResultRequested:false,
  recordDate:node(day),recordMember:node("demoStaff"),recordLocation:node("匿名現場"),
  recordCorrectionTeam:node("demoTeam"),productInputList:{querySelectorAll:()=>[input]},
  records:[{id:recordId,...clone(store.original)}],products:[clone(catalog)],
  currentUser:{uid:"demoOwner"},currentUserData:{uid:"demoOwner",companyId:"demoCompany",name:"匿名Owner"},
  members:[{id:"demoStaff",uid:"demoStaff",name:"匿名担当者",teamId:"demoTeam",active:true}],
  teams:[{id:"demoTeam",name:"匿名班",active:true}],editingRecordId:recordId,editingRecordRevision:null,
  dashboardMonth:node(day.slice(0,7)),recordsSubscribedMonth:day.slice(0,7),
  isCurrentCompanyOwner:()=>true,isCurrentTeamLeader:()=>false,canCurrentUserCorrectRecord:()=>true,
  clearMessages:()=>{},showError:x=>errors.push(x),showSuccess:x=>success.push(x),
  doc:store.doc,collection:()=>({path:"recordCorrections"}),getDoc:async ref=>store.snapshot(ref),
  serverTimestamp:store.timestamp,getDocsFromServer:store.getDocs,runTransaction:store.runTransaction,
  query:()=>({}),where:()=>({}),recordsCollectionQuery:()=>({}),
  createMonthOptions:()=>{},renderDashboard:()=>{},subscribeSelectedMonthRecords:()=>{},
  formatYen:()=>"匿名金額",firebaseErrorMessage:()=>"DEMO_SAVE_ERROR",console:{error:()=>{}}
 });
 ctx.editingRecordRevision=ctx.recordRevision(ctx.records[0]);
 vm.runInContext(handler(),ctx);
 return {ctx,store,errors,success,input,save:()=>ctx.saveRecordButton.onclick()};
}

test("real save button updates legacy/unique-plan 5→6, 5→4 and 0→1 with the same record ID, metadata and append-only audit",async()=>{
 for(const catalog of [catalogs.legacy,catalogs.explicit])for(const [before,after] of [[5,6],[5,4],[0,1]]){
  const host=saveHost({before,after,catalog});await host.save();
  assert.deepEqual(host.errors,[],before+"→"+after+" must save");
  assert.equal(host.success.length,1);
  const saved=host.store.docs.get("records/"+recordId);
  assert.equal(saved.totalCount,after);assert.equal(saved.totalRevenue,after*rate);
  assert.equal(saved.results.sku__cb_0.revenuePerUnit,rate);
  assert.equal(saved.createdAt.seconds,0);assert.equal(saved.createdByUid,"originalCreator");
  assert.deepEqual(saved.keepOriginalMetadata,{kept:true});
  assert.equal([...host.store.docs.keys()].filter(k=>k.startsWith("records/")).length,1);
  assert.deepEqual(host.store.docs.get("recordCorrections/original"),host.store.priorAudit);
  const audits=[...host.store.docs].filter(([k])=>k.startsWith("recordCorrections/audit"));
  assert.equal(audits.length,1);assert.equal(audits[0][1].before.totalCount,before);
  assert.equal(audits[0][1].after.totalCount,after);
  assert.equal(host.ctx.recordSaveInProgress,false);assert.equal(host.ctx.recordManagement.inert,false);
 }
});

test("real save button refuses genuine price differences and rolls back an audit failure",async()=>{
 for(const catalog of [
  {...catalogs.explicit,pricingOptions:[{cashback:0,revenuePerUnit:rate+1}]},
  catalogs.duplicate,
  {...catalogs.explicit,pricingOptions:[{cashback:0,revenuePerUnit:rate},{cashback:0,revenuePerUnit:rate+1}]}
 ]){
  const host=saveHost({catalog}),before=clone([...host.store.docs]);await host.save();
  assert.equal(host.errors.length,1);assert.equal(host.success.length,0);
  assert.deepEqual([...host.store.docs],before);assert.equal(host.store.commits,0);
 }
 const failed=saveHost(),before=clone([...failed.store.docs]);failed.store.failAudit();await failed.save();
 assert.equal(failed.errors.length,1);assert.equal(failed.success.length,0);
 assert.deepEqual([...failed.store.docs],before,"audit rejection cannot partly update the sale");
 assert.equal(failed.ctx.recordSaveInProgress,false);
});

test("real save button cannot overwrite an unknown historical unit price with an unchanged-count zero",async()=>{
 for(const unknown of [null,"",undefined]){
  const store=storeFixture(5);
  store.original.results.sku__cb_0.revenuePerUnit=unknown;
  store.original.totalRevenue=0;
  store.docs.set("records/"+recordId,clone(store.original));
  const host=saveHost({store,after:5});host.input.dataset.revenuePerUnit="0";
  const original=clone([...store.docs]);await host.save();
  assert.equal(host.errors.length,1);assert.equal(host.success.length,0);
  assert.deepEqual([...store.docs],original);assert.equal(store.commits,0);
 }
});

test("real save lock blocks a second click, while stale concurrent editors cannot overwrite the saved record or add an audit",async()=>{
 const first=saveHost();let release;first.store.setPause(new Promise(resolve=>{release=resolve;}));
 const saving=first.save();await first.save();
 assert.equal(first.ctx.recordSaveInProgress,true);release();await saving;
 assert.equal(first.store.commits,1);assert.equal(first.success.length,1);
 assert.equal([...first.store.docs.keys()].filter(k=>k.startsWith("recordCorrections/audit")).length,1);
 const store=storeFixture(5),a=saveHost({store,after:6}),b=saveHost({store,after:4});
 await Promise.all([a.save(),b.save()]);
 assert.equal(a.success.length,1);assert.equal(b.success.length,0);assert.equal(b.errors.length,1);
 assert.equal(store.docs.get("records/"+recordId).totalCount,6);
 assert.deepEqual(store.docs.get("recordCorrections/original"),store.priorAudit);
 assert.equal(store.commits,1);assert.equal(b.ctx.recordSaveInProgress,false);
});

const unknownRateCases=[
 ["null",null],["undefined",undefined],["empty string",""],["whitespace"," \t　 "],
 ["false",false],["true",true],["empty array",[]],["numeric array",[0]],
 ["object",{}],["NaN",NaN],["infinity",Infinity],["negative",-1],["fractional",0.5]
];
function zeroRateCatalog(shape,value){
 return shape==="explicit"
  ? {...catalogs.explicit,pricingOptions:[{cashback:0,revenuePerUnit:value}]}
  : {...catalogs.legacy,revenue:value};
}

test("raw catalog rates cannot become approved zero after normalization: explicit and scalar matrix",()=>{
 const ctx=context(),old={sku__cb_0:row(5,0)},next={sku__cb_0:row(6,0)};
 for(const shape of ["explicit","scalar"])for(const [label,value] of unknownRateCases){
  const catalog=zeroRateCatalog(shape,value),original=clone({catalog,old,next});
  assert.notEqual(ctx.verifyNewRecordPricing(next,[catalog]),"",shape+" "+label+" new sale must stop");
  assert.notEqual(ctx.verifyChangedRecordPricing(next,old,[catalog]),"",shape+" "+label+" count change must stop");
  assert.notEqual(ctx.verifyChangedRecordPricing({},old,[catalog]),"",shape+" "+label+" deleted line must still be checked");
  assert.notEqual(ctx.verifyChangedRecordPricing({sku__cb_0:row(1,0)},{},[catalog]),"",
   shape+" "+label+" new line on an existing day must stop");
  assert.deepEqual({catalog,old,next},original,"raw catalog and saved snapshots must remain unchanged");
 }
});

test("unknown raw row, saved rate and unchanged next rate cannot masquerade as a valid catalog zero",()=>{
 const ctx=context();
 for(const shape of ["explicit","scalar"])for(const [label,value] of unknownRateCases){
  const catalog=zeroRateCatalog(shape,0),old={sku__cb_0:row(5,0)},
   badNext={sku__cb_0:row(6,value)},sameCountBadNext={sku__cb_0:row(5,value)},
   badOld={sku__cb_0:row(5,value)},original=clone({catalog,old,badNext,sameCountBadNext,badOld});
  assert.notEqual(ctx.verifyNewRecordPricing(badNext,[catalog]),"",shape+" "+label+" new input must stop");
  assert.notEqual(ctx.verifyChangedRecordPricing(badNext,old,[catalog]),"",shape+" "+label+" changed input must stop");
  assert.notEqual(ctx.verifyChangedRecordPricing(sameCountBadNext,old,[catalog]),"",
   shape+" "+label+" unchanged-count input cannot change or erase its saved rate");
  assert.notEqual(ctx.verifyChangedRecordPricing({sku__cb_0:row(6,0)},badOld,[catalog]),"",
   shape+" "+label+" count change cannot repair unknown history");
  assert.notEqual(ctx.verifyChangedRecordPricing({sku__cb_0:row(5,0)},badOld,[catalog]),"",
   shape+" "+label+" unchanged count cannot repair unknown history");
  assert.deepEqual({catalog,old,badNext,sameCountBadNext,badOld},original);
 }
});

test("explicit numeric zero and numeric-string zero remain valid for new, changed, unchanged and removed lines",()=>{
 const ctx=context();
 for(const shape of ["explicit","scalar"])for(const catalogRate of [0,"0"])
  for(const savedRate of [0,"0"])for(const nextRate of [0,"0"]){
   const catalog=zeroRateCatalog(shape,catalogRate),old={sku__cb_0:row(5,savedRate)};
   for(const after of [1,4,5,6]){
    const next={sku__cb_0:row(after,nextRate)},original=clone({catalog,old,next});
    assert.equal(ctx.verifyNewRecordPricing(next,[catalog]),"",shape+" explicit zero must remain valid");
    assert.equal(ctx.verifyChangedRecordPricing(next,old,[catalog]),"",shape+" known zero count update must remain valid");
    assert.deepEqual({catalog,old,next},original);
   }
   assert.equal(ctx.verifyChangedRecordPricing({},old,[catalog]),"","removal retains the same known zero-price checks");
  }
});
