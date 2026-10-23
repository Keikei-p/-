"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {executeConfirmedCorrection,calculateOnePriceCorrection}=
  require("../finance-correction");
class Fail extends Error {
  constructor(code,message){super(message);this.code=code;}
}
const now="SERVER_TIMESTAMP";
const FieldValue={serverTimestamp:()=>now};
function makeFixture(overrides={}){
  const company="c",uid="owner";
  const original={
    companyId:company,uid:"worker",date:"2026-10-23",teamId:"team4",
    teamNameSnapshot:"4班",memberNameSnapshot:"現場社員",
    workLocation:"現場",createdByUid:"worker",createdAt:100,
    updatedAt:{toMillis:()=>12345},totalCount:5,totalRevenue:10000,
    reportStatus:"submitted",
    results:{electric:{productId:"electric",cashback:0,count:5,revenuePerUnit:2000}}
  };
  const store={
    "companies/c":{ownerUid:"owner",active:true},
    "users/owner":{companyId:"c",companyRole:"owner",name:"オーナー"},
    "companies/c/members/owner":{companyId:"c",companyRole:"owner",active:true},
    "records/r1":original,
    "products/electric":{companyId:"c",name:"とくする電気",
      pricingOptions:[{cashback:0,revenuePerUnit:10000}]}
  };
  Object.assign(store,overrides);
  let created=0;
  const db={
    collection(name){return {
      doc(id){return {path:name+"/"+(id||"auto-"+(++created))};}
    }},
    async runTransaction(cb){
      const writes=[];
      const result=await cb({
        get:async ref=>({
          exists:Object.hasOwn(store,ref.path),id:ref.path.split("/").at(-1),
          data:()=>store[ref.path]
        }),
        update:(ref,fields)=>writes.push({type:"update",ref,fields}),
        create:(ref,fields)=>writes.push({type:"create",ref,fields})
      });
      for(const w of writes){
        if(w.type==="update")store[w.ref.path]={...store[w.ref.path],...w.fields};
        if(w.type==="create")store[w.ref.path]=w.fields;
      }
      return result;
    }
  };
  // Implement nested collection refs exactly like Firestore Admin API.
  db.collection=name=>({
    doc:id=>{
      const ref={path:name+"/"+(id||"auto-"+(++created))};
      ref.collection=sub=>({
        doc:child=>({path:ref.path+"/"+sub+"/"+child})
      });
      return ref;
    }
  });
  const input={
    recordId:"r1",productId:"electric",cashback:0,
    expectedOldUnit:2000,expectedSelectedCount:5,expectedTotalCount:5,
    expectedTotalRevenue:10000,expectedUpdatedAtMillis:12345,
    reason:"会社承認単価10,000円への修正"
  };
  return {db,store,input,company,uid,original,
    run:()=>executeConfirmedCorrection({
      db,FieldValue,HttpsError:Fail,uid,companyId:company,input
    })};
}
test("5 electric deals: correct 10000 to 50000 in same record and append atomic immutable audit",async()=>{
  const f=makeFixture(),before=JSON.stringify(f.original);
  const res=await f.run();
  assert.deepEqual(res,{recordId:"r1",totalCount:5,totalRevenue:50000});
  const updated=f.store["records/r1"];
  assert.equal(updated.results.electric.revenuePerUnit,10000);
  assert.equal(updated.results.electric.count,5);
  assert.equal(updated.uid,"worker");
  assert.equal(updated.teamId,"team4");
  assert.equal(updated.createdAt,100);
  assert.equal(updated.createdByUid,"worker");
  const audits=Object.keys(f.store).filter(p=>p.startsWith("privateRevenueCorrectionAudits/"));
  assert.equal(audits.length,1);
  const a=f.store[audits[0]];
  assert.equal(a.before.totalRevenue,10000);
  assert.equal(a.after.totalRevenue,50000);
  assert.equal(a.before.results.electric.revenuePerUnit,2000);
  assert.equal(a.after.results.electric.revenuePerUnit,10000);
  assert.equal(a.after.financialCorrectionReason,f.input.reason);
  assert.equal(a.originalRecordSnapshot.totalRevenue,10000);
  assert.equal(a.originalRecordSnapshot.teamId,"team4");
  assert.equal(a.originalRecordSnapshot.results.electric.count,5);
  assert.equal(JSON.stringify(f.original),before);
  await assert.rejects(f.run(),{code:"aborted"});
  assert.equal(Object.keys(f.store).filter(p=>p.startsWith("privateRevenueCorrectionAudits/")).length,1);
});
test("NURO mixed cashback tiers retain their own prices; only chosen tier is modified",async()=>{
  const f=makeFixture();
  f.store["records/r1"]={
    ...f.original,results:{
      a:{productId:"nuro",cashback:0,count:4,revenuePerUnit:25000},
      b:{productId:"nuro",cashback:20000,count:5,revenuePerUnit:20000}
    },totalCount:9,totalRevenue:200000
  };
  f.store["products/nuro"]={companyId:"c",name:"NURO光",pricingOptions:[
    {cashback:0,revenuePerUnit:25000},
    {cashback:20000,revenuePerUnit:22500}
  ]};
  Object.assign(f.input,{
    productId:"nuro",cashback:20000,expectedOldUnit:20000,
    expectedSelectedCount:5,expectedTotalCount:9,expectedTotalRevenue:200000
  });
  const result=await f.run();
  assert.equal(result.totalRevenue,212500);
  assert.equal(f.store["records/r1"].results.a.revenuePerUnit,25000);
  assert.equal(f.store["records/r1"].results.b.revenuePerUnit,22500);
});
test("Refuse unauthorized owner impersonation, foreign company, stale edit, and unconfigured CB",async()=>{
  for(const mutation of [
    f=>f.store["companies/c"].ownerUid="attacker",
    f=>f.store["users/owner"].companyRole="member",
    f=>f.store["companies/c/members/owner"].companyRole="member",
    f=>f.store["records/r1"].companyId="foreign",
    f=>f.store["products/electric"].companyId="foreign"
  ]){
    const f=makeFixture();mutation(f);
    await assert.rejects(f.run());
    assert.equal(f.store["records/r1"].totalRevenue,10000);
  }
  const stale=makeFixture();stale.input.expectedUpdatedAtMillis=999;
  await assert.rejects(stale.run(),{code:"aborted"});
  const noPrice=makeFixture();
  noPrice.store["products/electric"].pricingOptions=[];
  await assert.rejects(noPrice.run(),{code:"failed-precondition"});
  const wrongCB=makeFixture();wrongCB.input.cashback=20000;
  await assert.rejects(wrongCB.run(),{code:"failed-precondition"});
  const reason=makeFixture();reason.input.reason="短";
  await assert.rejects(reason.run(),{code:"invalid-argument"});
});
test("Pricing helpers never reprice zero-price products or guess missing multi-CB history",()=>{
  const original={results:{a:{productId:"p",count:3,revenuePerUnit:0}},
    totalCount:3,totalRevenue:0};
  assert.throws(()=>calculateOnePriceCorrection(original,{
    pricingOptions:[{cashback:0,revenuePerUnit:0}]
  },{productId:"p",cashback:0,expectedOldUnit:0,expectedSelectedCount:3,
    expectedTotalCount:3,expectedTotalRevenue:0},Fail),{code:"failed-precondition"});
  const ambiguous={results:{a:{productId:"p",count:2,revenuePerUnit:10000}},
    totalCount:2,totalRevenue:20000};
  assert.throws(()=>calculateOnePriceCorrection(ambiguous,{
    pricingOptions:[{cashback:0,revenuePerUnit:25000},{cashback:20000,revenuePerUnit:22500}]
  },{productId:"p",cashback:0,expectedOldUnit:10000,expectedSelectedCount:2,
    expectedTotalCount:2,expectedTotalRevenue:20000},Fail),{code:"failed-precondition"});
});


test("Block correction when saved total does not reconcile with its own lines",async()=>{
  const f=makeFixture();
  f.store["records/r1"].totalRevenue=9999;
  f.input.expectedTotalRevenue=9999;
  await assert.rejects(f.run(),{code:"failed-precondition"});
  assert.equal(f.store["records/r1"].totalRevenue,9999);
  assert.equal(Object.keys(f.store).filter(k=>k.startsWith("privateRevenueCorrectionAudits/")).length,0);
});

test("Block correction if previous revision did not provide updatedAt matching token",async()=>{
  const f=makeFixture();
  delete f.input.expectedUpdatedAtMillis;
  await assert.rejects(f.run(),{code:"aborted"});
  assert.equal(f.store["records/r1"].totalRevenue,10000);
});

test("Reject null and missing original unit prices without writing a guessed zero",async()=>{
  for(const bad of [null,undefined,""]){
    const f=makeFixture();
    f.store["records/r1"].results.electric.revenuePerUnit=bad;
    f.input.expectedOldUnit=0;
    await assert.rejects(f.run(),{code:"failed-precondition"});
    assert.equal(Object.keys(f.store).filter(k=>k.startsWith("privateRevenueCorrectionAudits/")).length,0);
  }
});


test("Legacy ordinary electric product without CB tiers can correct its stored five deals safely",async()=>{
  const f=makeFixture();
  f.store["products/electric"]={
    companyId:"c",name:"とくする電気",revenue:10000
  };
  const before=structuredClone({count:f.store["records/r1"].results.electric.count,
    teamId:f.store["records/r1"].teamId,uid:f.store["records/r1"].uid,
    date:f.store["records/r1"].date});
  const result=await f.run();
  assert.equal(result.totalRevenue,50000);
  assert.equal(f.store["records/r1"].results.electric.revenuePerUnit,10000);
  assert.equal(f.store["records/r1"].results.electric.count,before.count);
  assert.equal(f.store["records/r1"].teamId,before.teamId);
  assert.equal(f.store["records/r1"].uid,before.uid);
  assert.equal(f.store["records/r1"].date,before.date);
  assert.equal(Object.keys(f.store).filter(x=>x.startsWith("privateRevenueCorrectionAudits/")).length,1);
});

test("Legacy CB-separated products are not automatically repriced from product.revenue",async()=>{
  for(const value of [
    {companyId:"c",name:"NURO光",revenue:10000,cashbackOptions:[0,20000]},
    {companyId:"c",name:"NURO光 CB20000",revenue:10000},
    {companyId:"c",name:"NURO光",revenue:null}
  ]){
    const f=makeFixture();
    f.store["products/electric"]=value;
    await assert.rejects(f.run(),{code:"failed-precondition"});
    assert.equal(f.store["records/r1"].totalRevenue,10000);
    assert.equal(Object.keys(f.store).filter(x=>x.startsWith("privateRevenueCorrectionAudits/")).length,0);
  }
});
