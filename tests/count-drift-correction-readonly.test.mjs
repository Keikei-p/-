import test from "node:test";
import assert from "node:assert/strict";
import {classifyCountDrift} from "../tools/readonly-backup/count-drift-diagnostic.mjs";
const meta={projectId:"sales-management-cc116",format:"firestore-rest-typed-v1"};
test("empty legacy results map verifies saved zero rather than becoming missing",()=>{
 const result=classifyCountDrift({...meta,documents:[{
  path:"records/sample",value:{fields:{totalCount:{integerValue:"0"},results:{mapValue:{}}}}
 }]});
 assert.equal(result.matchedRecords,1);
 assert.equal(result.unverifiableRecords,0);
});
test("historical correction links to mismatched record without revealing record path",()=>{
 const original={path:"records/example",value:{fields:{
  totalCount:{integerValue:"1"},
  results:{mapValue:{fields:{a:{mapValue:{fields:{count:{integerValue:"2"}}}}}}}
 }}};
 const correctionSnapshot=(lineCount)=>({mapValue:{fields:{
  totalCount:{integerValue:"1"},
  results:{mapValue:{fields:{a:{mapValue:{fields:{count:{integerValue:String(lineCount)}}}}}}}
 }}});
 const correction={path:"recordCorrections/correction1",value:{fields:{
  recordId:{stringValue:"example"},
  before:correctionSnapshot(1),after:correctionSnapshot(1)
 }}};
 original.value.updateTime="2026-11-02T00:00:00Z";
 correction.value.fields.createdAt={timestampValue:"2026-11-01T00:00:00Z"};
 const result=classifyCountDrift({...meta,documents:[original,correction]});
 assert.equal(result.mismatchedRecords,1);
 assert.equal(result.mismatchKinds[0].relatedCorrectionDocuments,1);
 assert.deepEqual(result.mismatchKinds[0].correctionCountProof,{
  beforeConsistent:1,beforeMismatched:0,
  afterConsistent:1,afterMismatched:0,
  verifiedAfterSnapshots:1,afterSavedMatchesCurrent:1,
  afterLinesMatchCurrent:0,afterBothMatchCurrent:0,
  unverifiedSnapshots:0,
  currentVsSingleCorrection:{addedProductRows:0,removedProductRows:0,quantityChangedProductRows:1,currentRecordUpdatedAfterCorrection:true}
 });
 assert.ok(!JSON.stringify(result).includes("example"));
 assert.ok(!JSON.stringify(result).includes("correction1"));
});
