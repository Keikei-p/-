import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCountDrift} from '../tools/readonly-backup/count-drift-diagnostic.mjs';
const row=n=>({mapValue:{fields:{count:{integerValue:String(n)},
 revenuePerUnit:{integerValue:'450000'},memberName:{stringValue:'SECRET-STAFF'}}}});
const doc=(id,saved,lines,shape='map')=>({
 path:'records/'+id,
 value:{fields:{
  uid:{stringValue:'secret-user-'+id},
  totalRevenue:{integerValue:'999999999'},
  totalCount:{integerValue:String(saved)},
  results:shape==='map'?
   {mapValue:{fields:Object.fromEntries(lines.map((n,i)=>['privateProductId'+i,row(n)]))}}:
   {arrayValue:{values:lines.map(row)}}
 }}
});
const snapshot=documents=>({projectId:'sales-management-cc116',
 format:'firestore-rest-typed-v1',documents});
test('redacts identity and revenue while explaining saved vs line count direction',()=>{
 const docs=[doc('secretA',5,[2,1]),doc('secretB',3,[1,2],'array'),doc('secretC',0,[0])];
 const data=snapshot(docs),before=JSON.stringify(data);
 const out=classifyCountDrift(data);
 assert.equal(out.mismatchedRecords,1);
 assert.equal(out.matchedRecords,2);
 assert.deepEqual(out.mismatchKinds.map(({correctionCountProof,...item})=>item),[{
  shape:'map',rowCount:2,zeroCountRows:0,
  direction:'saved_exceeds_lines',absoluteCountDifference:2,
  savedCountIsZero:false,linesCountIsZero:false,relatedCorrectionDocuments:0
 }]);
 assert.equal(JSON.stringify(data),before);
 for(const value of ['SECRET-STAFF','secret-user','secretA','450000','999999999','privateProductId','records/'])
  assert.ok(!JSON.stringify(out).includes(value),'privacy violation '+value);
});
test('returns an aggregate not names for array larger-than-saved and zero row cases',()=>{
 const out=classifyCountDrift(snapshot([doc('private',2,[0,4],'array')]));
 assert.deepEqual(out.mismatchKinds.map(({correctionCountProof,...item})=>item),[{shape:'array',rowCount:2,zeroCountRows:1,
  direction:'lines_exceed_saved',absoluteCountDifference:2,
  savedCountIsZero:false,linesCountIsZero:false,relatedCorrectionDocuments:0}]);
});
test('unverifiable rows are never treated as verified zero counts',()=>{
 const noResults={path:'records/privateX',value:{fields:{totalCount:{integerValue:'7'}}}};
 const invalid={path:'records/privateZ',value:{fields:{totalCount:{integerValue:'2'},
   results:{arrayValue:{values:[{mapValue:{fields:{count:{stringValue:'two'}}}}]}}}}};
 const out=classifyCountDrift(snapshot([noResults,invalid]));
 assert.equal(out.unverifiableRecords,2);
 assert.equal(out.mismatchedRecords,0);
});

test('verified correction after + exactly one leftover row matches 1-count drift, never proves causality',()=>{
 const wrapCount=n=>({mapValue:{fields:{count:{integerValue:String(n)},
  revenuePerUnit:{integerValue:'7777777'},customerName:{stringValue:'DO-NOT-LOG'}}}});
 const snap=rows=>({mapValue:{fields:{
  totalCount:{integerValue:String(Object.values(rows).reduce((a,n)=>a+n,0))},
  results:{mapValue:{fields:Object.fromEntries(
   Object.entries(rows).map(([key,n])=>[key,wrapCount(n)]))}}
 }}});
 const current={path:'records/person-private',value:{
  updateTime:'2026-11-02T00:00:00Z',
  fields:{
   uid:{stringValue:'SECRET-UID'},totalRevenue:{integerValue:'999999'},
   totalCount:{integerValue:'3'},
   results:{mapValue:{fields:{nuro:wrapCount(3),oldKey:wrapCount(1)}}}
  }
 }};
 const correction={path:'recordCorrections/c-private',value:{fields:{
  recordId:{stringValue:'person-private'},createdAt:{timestampValue:'2026-11-03T00:00:00Z'},
  before:snap({nuro:2}),after:snap({nuro:3}),
  privateRevenue:{integerValue:'777777'}
 }}};
 const input=snapshot([current,correction]),untouched=JSON.stringify(input);
 const out=classifyCountDrift(input);
 assert.equal(out.mismatchedRecords,1);
 const m=out.mismatchKinds[0];
 assert.equal(m.direction,'lines_exceed_saved');
 assert.equal(m.absoluteCountDifference,1);
 assert.equal(m.correctionCountProof.exactOneExtraRowMatchesDrift,true);
 assert.equal(m.correctionCountProof.historicalNestedMergeCauseProven,false);
 assert.equal(m.correctionCountProof.ownerDecisionRequired,true);
 assert.equal(m.correctionCountProof.currentVsSingleCorrection.currentRecordUpdatedAfterCorrection,false);
 assert.equal(JSON.stringify(input),untouched);
 for(const value of ['person-private','c-private','SECRET-UID','DO-NOT-LOG',
  '7777777','999999','oldKey','nuro','records/'])
  assert(!JSON.stringify(out).includes(value),'private data in report '+value);
});
test('changed quantities, extra correction, or corrupt snapshots never earn one-row evidence',()=>{
 const line=n=>({mapValue:{fields:{count:{integerValue:String(n)}}}});
 const results=rows=>({mapValue:{fields:Object.fromEntries(Object.entries(rows).map(([id,n])=>[id,line(n)]))}});
 const saved=rows=>({mapValue:{fields:{
  totalCount:{integerValue:String(Object.values(rows).reduce((a,b)=>a+b,0))},
  results:results(rows)
 }}});
 const record=()=>({path:'records/private',value:{fields:{
  totalCount:{integerValue:'3'},results:results({a:3,b:1})
 }}});
 const correction=()=>({path:'recordCorrections/private-correction',value:{fields:{
  recordId:{stringValue:'private'},before:saved({a:2}),after:saved({a:3})
 }}});
 const scenarios=[
  {record:{...record(),value:{fields:{
    totalCount:{integerValue:'3'},results:results({a:2,b:2})}}},corrections:[correction()]},
  {record:record(),corrections:[correction(),correction()]},
  {record:record(),corrections:[{...correction(),value:{fields:{
    ...correction().value.fields,after:saved({a:2})}}}]},
  {record:record(),corrections:[{...correction(),value:{fields:{
    ...correction().value.fields,before:{mapValue:{fields:{totalCount:{integerValue:'1'},results:results({a:2,b:5})}}}}}}]},
  {record:record(),corrections:[]}
 ];
 for(const example of scenarios){
  const out=classifyCountDrift(snapshot([example.record,...example.corrections]));
  assert.equal(out.mismatchedRecords,1);
  assert.equal(out.mismatchKinds[0].correctionCountProof.exactOneExtraRowMatchesDrift,false);
  assert.equal(out.mismatchKinds[0].correctionCountProof.ownerDecisionRequired,true);
 }
});
test('wrong scope or wrong project never accepts untrusted input',()=>{
 assert.throws(()=>classifyCountDrift(snapshot([]).documents),/INVALID_SNAPSHOT/);
 assert.throws(()=>classifyCountDrift({...snapshot([]),projectId:'other'}),/INVALID_SNAPSHOT/);
});
