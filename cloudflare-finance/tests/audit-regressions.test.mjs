import {test} from 'node:test';
import assert from 'node:assert/strict';
import {securePricing,buildRecordFromCounts} from '../src/write-plan.js';
import {approvedPolicy,visibleMoney} from '../src/index.js';
import {submitCounts} from '../src/count-service.js';

const policy={uid:'staff',companyId:'demo',teamId:'A',role:'member'};
const target={uid:'staff',companyId:'demo',name:'Fixture',active:true};
const team={id:'A',companyId:'demo',name:'Fixture',active:true};
const product={id:'sim',companyId:'demo',name:'SIM',revenue:12000,cashbackOptions:[0,2000]};
const intent={uid:'staff',teamId:'A',date:'2026-10-22',workLocation:'Fixture',reportStatus:'submitted',entries:[{productId:'sim',planId:'plan_1',count:2}]};

test('unknown legacy CB unit price is never synthesized from cashback',()=>{
  assert.equal(securePricing(product)[1].revenuePerUnit,null);
  assert.throws(()=>buildRecordFromCounts(intent,policy,[product],target,team),/unit price/i);
});
test('explicit null or blank unit price is not converted to zero revenue',()=>{
  for(const price of [null,undefined,'']){
    const p={...product,pricingOptions:[{cashback:2000,revenuePerUnit:price}]};
    assert.equal(securePricing(p)[0].revenuePerUnit,null);
    assert.throws(()=>buildRecordFromCounts({...intent,entries:[{productId:'sim',planId:'plan_0',count:2}]},policy,[p],target,team),/unit price/i);
  }
});
test('a verified saved unit price remains usable when current legacy pricing is unknown',()=>{
  const old={id:'legacy',companyId:'demo',uid:'staff',teamId:'A',date:intent.date,updatedAt:'2026-10-22T00:00:00Z',totalRevenue:9000,results:{sim__cb_2000:{productId:'sim',cashback:2000,count:1,revenuePerUnit:9000}}};
  const result=buildRecordFromCounts({...intent,recordId:'legacy',expectedRecordUpdateTime:old.updatedAt},policy,[product],target,team,old);
  assert.equal(result.document.totalRevenue,18000);
  assert.equal(result.document.results.sim__cb_2000.revenuePerUnit,9000);
});
test('count correction preserves historical member name snapshot',()=>{
  const old={id:'legacy',companyId:'demo',uid:'staff',teamId:'A',date:intent.date,memberNameSnapshot:'Old name',updatedAt:'2026-10-22T00:00:00Z',totalRevenue:9000,results:{sim__cb_2000:{productId:'sim',cashback:2000,count:1,revenuePerUnit:9000}}};
  const result=buildRecordFromCounts({...intent,recordId:'legacy',expectedRecordUpdateTime:old.updatedAt},policy,[product],target,team,old);
  assert.equal(result.document.memberNameSnapshot,'Old name');
});
test('POST response obeys the same historical revenue scope as GET',async()=>{
  const account={...policy,companyRole:'member',active:true,canViewRevenue:true,canViewUnitPrice:false,teamHistory:[{effectiveDate:'2020-01-01',fromTeamId:null,toTeamId:'B'},{effectiveDate:'2026-10-27',fromTeamId:'B',toTeamId:'A'}]};
  const company={ownerUid:'owner'};
  const resolved=approvedPolicy(account,account,company,'staff','2026-10-27');
  assert.equal(visibleMoney(resolved,{teamId:'A',date:intent.date}),false);
  const docs={'users/staff':account,'companies/demo/members/staff':account,'companies/demo':company,'teams/A':team};
  const store={runTransaction:async job=>job({get:async key=>docs[key],queryDaily:async()=>[],queryProducts:async()=>[{...product,pricingOptions:[{cashback:2000,revenuePerUnit:9000}]}],saveRecord(){},addSyncSignal(){}})};
  const result=await submitCounts(store,{uid:'staff'},{...intent,entries:[{productId:'sim',planId:'plan_0',count:1}]},{policyResolver:()=>resolved});
  assert.equal(Object.hasOwn(result,'totalRevenue'),false);
});
test('omitting an unmappable historical line cannot erase it through the API',()=>{
  const old={id:'legacy',companyId:'demo',uid:'staff',teamId:'A',date:intent.date,updatedAt:'2026-10-22T00:00:00Z',totalRevenue:9000,results:{deleted__cb_0:{productId:'deleted',cashback:0,count:1,revenuePerUnit:9000}}};
  assert.throws(()=>buildRecordFromCounts({...intent,recordId:'legacy',expectedRecordUpdateTime:old.updatedAt,reportStatus:'no_result',entries:[]},policy,[product],target,team,old),/historical.*plan/i);
});
