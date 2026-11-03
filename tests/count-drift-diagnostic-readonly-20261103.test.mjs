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
 assert.deepEqual(out.mismatchKinds,[{
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
 assert.deepEqual(out.mismatchKinds,[{shape:'array',rowCount:2,zeroCountRows:1,
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
test('wrong scope or wrong project never accepts untrusted input',()=>{
 assert.throws(()=>classifyCountDrift(snapshot([]).documents),/INVALID_SNAPSHOT/);
 assert.throws(()=>classifyCountDrift({...snapshot([]),projectId:'other'}),/INVALID_SNAPSHOT/);
});
