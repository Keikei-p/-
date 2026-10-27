import test from "node:test";
import assert from "node:assert/strict";
import {rankingAccess,validateViewerChange,buildPrivateRevenueRanking} from "../src/individual-ranking.mjs";
const cid="ownCompany",month="2026-10";
const members=[
 {uid:"one",companyId:cid,name:"Aさん",active:true,companyRole:"member"},
 {uid:"two",companyId:cid,name:"Bさん",active:true,companyRole:"member"},
 {uid:"three",companyId:cid,name:"Cさん",active:true,companyRole:"member"},
 {uid:"partner",companyId:cid,name:"外部パートナー",active:true,accessKind:"partner"},
 {uid:"other",companyId:"otherCompany",name:"他社",active:true}
];
const products=[
 {id:"tok",companyId:cid,pricingOptions:[{cashback:0,revenuePerUnit:10000}]},
 {id:"ever",companyId:cid,pricingOptions:[{cashback:0,revenuePerUnit:20000}]},
 {id:"nuro",companyId:cid,pricingOptions:[
  {cashback:0,revenuePerUnit:25000},{cashback:20000,revenuePerUnit:22500}
 ]}
];
function rec(uid,date,results,companyId=cid){
 return {companyId,uid,date,results,totalCount:Object.values(results).reduce((s,v)=>s+v.count,0)};
}
test("Company sales-ranked list has NO price or revenue fields, incl. CB and repricing",()=>{
 const records=[
  rec("one","2026-10-25",{a:{productId:"tok",count:5,cashback:0,revenuePerUnit:1000}}),
  rec("two","2026-10-25",{a:{productId:"ever",count:5,cashback:0,revenuePerUnit:1500}}),
  rec("three","2026-10-25",{a:{productId:"nuro",count:2,cashback:0,revenuePerUnit:1},
                               b:{productId:"nuro",count:3,cashback:20000,revenuePerUnit:1}}),
  rec("partner","2026-10-25",{a:{productId:"tok",count:999,cashback:0,revenuePerUnit:2}}),
  rec("other","2026-10-25",{a:{productId:"tok",count:999,cashback:0,revenuePerUnit:2}},"otherCompany"),
  rec("one","2026-09-23",{a:{productId:"tok",count:999,cashback:0,revenuePerUnit:2}})
 ];
 const before=JSON.stringify([records,products,members]);
 const ranks=buildPrivateRevenueRanking(records,products,members,cid,month);
 assert.deepEqual(ranks.map(x=>[x.uid,x.rank]),[
  ["three",1],["two",2],["one",3]
 ]);
 assert.equal(JSON.stringify([records,products,members]),before);
 assert.deepEqual(Object.keys(ranks[0]).sort(),["name","rank","uid"]);
 assert.equal("count" in ranks[0],false);
 assert.equal("revenue" in ranks[0],false);
 assert.doesNotMatch(JSON.stringify(ranks),/totalRevenue|revenue|price|unit|count|22500|20000|10000|267500/i);
});
test("Rank access is independent of canViewRevenue, owner override, partner deny",()=>{
 const p={companyId:cid,uid:"one",isOwner:false,isPartner:false,canViewRevenue:false};
 assert.equal(rankingAccess(p,{companyId:cid,uid:"one",allowed:true}),true);
 assert.equal(rankingAccess({...p,canViewRevenue:true},{companyId:cid,uid:"one",allowed:false}),false);
 assert.equal(rankingAccess(p,{companyId:"otherCompany",uid:"one",allowed:true}),false);
 assert.equal(rankingAccess(p,{companyId:cid,uid:"other",allowed:true}),false);
 assert.equal(rankingAccess({...p,isPartner:true},{companyId:cid,uid:"one",allowed:true}),false);
 assert.equal(rankingAccess({...p,isOwner:true},null),true);
});
test("Only owner can toggle same-company nonpartner real account",()=>{
 const p={companyId:cid,uid:"owner",isOwner:true,isPartner:false};
 const valid=members[0];
 assert.deepEqual(validateViewerChange(p,valid,"one",true),{companyId:cid,uid:"one",allowed:true});
 for(const args of [
  [{...p,isOwner:false},valid,"one",true],
  [{...p,isPartner:true},valid,"one",true],
  [p,valid,"two",true],[p,{...valid,companyId:"otherCompany"},"one",true],
  [p,{...valid,accessKind:"partner"},"one",true],
  [p,{...valid,memberType:"managed",hasAccount:false},"one",true],
  [p,valid,"one","true"]
 ])assert.throws(()=>validateViewerChange(...args),/forbidden/);
});
test("Identical sales rank ties; invalid, duplicate and unknown count fail closed",()=>{
 const recs=[rec("one","2026-10-25",{a:{productId:"tok",count:2,cashback:0,revenuePerUnit:1}}),
 rec("two","2026-10-26",{a:{productId:"tok",count:2,cashback:0,revenuePerUnit:1}}),
 rec("three","2026-10-26",{a:{productId:"tok",count:1,cashback:0,revenuePerUnit:1}})];
 const ranks=buildPrivateRevenueRanking(recs,products,members,cid,month);
 assert.deepEqual(ranks.map(x=>x.rank),[1,1,3]);
 assert.throws(()=>buildPrivateRevenueRanking([...recs,recs[0]],products,members,cid,month),/duplicate_daily/);
 assert.throws(()=>buildPrivateRevenueRanking([
  rec("one","2026-10-25",{a:{productId:"tok",count:-1,cashback:0,revenuePerUnit:1}})
 ],products,members,cid,month),/invalid_record_count/);
 assert.throws(()=>buildPrivateRevenueRanking([
  rec("one","2026-10-25",{a:{productId:"missing",count:2,cashback:0,revenuePerUnit:null}})
 ],products,members,cid,month),/price_unverified/);
});
