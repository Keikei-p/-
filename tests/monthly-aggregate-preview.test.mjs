import test from 'node:test';
import assert from 'node:assert/strict';
import {previewMonthlyAggregates} from '../security/monthly-aggregate-preview.mjs';
const row=(id='r1',overrides={})=>({
 id,companyId:'nico',date:'2026-10-20',uid:'user1',teamId:'team1',
 results:{'p1__plan0':{productId:'p1',count:2,revenuePerUnit:10000,cashback:5000}},
 totalCount:2,totalRevenue:20000,...overrides
});
const go=records=>previewMonthlyAggregates({companyId:'nico',month:'2026-10',records});
test('count and finance projections are physically separable and never marked publish-ready',()=>{
 const x=go([row(),row('r2',{uid:'user2',teamId:'team2'})]);
 assert.equal(x.verifiedComplete,false);
 assert.equal(x.status,'PREVIEW_ONLY_NOT_PUBLISHABLE');
 assert.equal(x.countOnly.totalCount,4);
 assert.equal(x.privateFinance.totalRevenue,40000);
 assert.deepEqual(x.countOnly.byTeam,[{teamId:'team1',totalCount:2},{teamId:'team2',totalCount:2}]);
 const publicJson=JSON.stringify(x.countOnly).toLowerCase();
 for(const forbidden of ['revenue','cashback','amount','price','user1','20000','plan0'])
   assert(!publicJson.includes(forbidden),forbidden);
});
test('25,001 synthetic records aggregate without a 2,000 record cutoff',()=>{
 const records=Array.from({length:25001},(_,i)=>row('id'+i,{uid:'u'+i}));
 const x=go(records);
 assert.equal(x.countOnly.recordCount,25001);
 assert.equal(x.countOnly.totalCount,50002);
 assert.equal(x.privateFinance.totalRevenue,500020000);
 assert.equal(x.privateFinance.byMember.length,25001);
});
test('foreign companies, duplicate IDs and dates outside the month fail closed',()=>{
 assert.throws(()=>go([row('r1',{companyId:'other'})]),/foreign_company/);
 assert.throws(()=>go([row(),row()]),/record_id/);
 for(const date of ['2026-09-30','2026-10-32','2026-02-31'])
   assert.throws(()=>go([row('r1',{date})]),/date/);
});
test('never repair historic prices or mismatched totals without owner review',()=>{
 assert.throws(()=>go([row('r1',{totalRevenue:30000})]),/revenue_mismatch/);
 assert.throws(()=>go([row('r1',{totalCount:3})]),/count_mismatch/);
 assert.throws(()=>go([row('r1',{results:{'p1__plan0':{productId:'p1',count:2}}})]),/unverified_unit_price/);
});
test('invalid identities, negative counts and integer overflow are rejected',()=>{
 assert.throws(()=>go([row('r1',{teamId:'NURO_20,000円'})]),/identity/);
 assert.throws(()=>go([row('r1',{uid:''})]),/identity/);
 assert.throws(()=>go([row('r1',{results:{'p1__plan0':{productId:'p1',count:-1,revenuePerUnit:10000}}})]),/line_count/);
 assert.throws(()=>go([row('r1',{results:{'p1__plan0':{productId:'p1',count:2,revenuePerUnit:Number.MAX_SAFE_INTEGER}}})]),/amount_overflow/);
});
test('a zero report remains recorded, not treated as a missing document',()=>{
 const x=go([row('zero',{results:{},totalCount:0,totalRevenue:0})]);
 assert.equal(x.countOnly.recordCount,1);
 assert.equal(x.countOnly.totalCount,0);
 assert.equal(x.privateFinance.totalRevenue,0);
});
