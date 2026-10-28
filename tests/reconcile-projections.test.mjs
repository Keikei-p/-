import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {verifyPreparedCountProjections} from "../security/reconcile-projections.mjs";
import {
  projectPublicRecordHeader,projectPublicRecordLines,projectPublicProduct,
  projectPublicCorrectionFlat
} from "../security/public-projection.mjs";

const companyId="company-a";
const records=[
  {
    id:"private-r1",companyId,uid:"u1",date:"2026-10-27",teamId:"t1",
    teamNameSnapshot:"一班",memberNameSnapshot:"担当者A",totalCount:5,
    totalRevenue:100000,workLocation:"会場A",reportStatus:"submitted",
    results:{p1:{productId:"p1",productName:"商材A",count:3,revenuePerUnit:20000,cashback:10000},
             p2:{productId:"p2",productName:"商材B",count:2,revenuePerUnit:20000}}
  },
  {
    id:"private-r2",companyId,uid:"u2",date:"2026-10-28",teamId:"t2",
    memberNameSnapshot:"担当者B",totalCount:0,totalRevenue:0,
    results:{},reportStatus:"no_result"
  }
];
const products=[
  {id:"p1",companyId,name:"商材A",revenue:20000,cashbackOptions:[10000],active:true},
  {id:"p2",companyId,name:"商材B",revenue:20000,active:true}
];
const recordCorrections=[{
  id:"private-c1",companyId,recordId:"private-r1",recordDate:"2026-10-27",
  changedByUid:"owner",
  before:{teamId:"t1",totalCount:4,totalRevenue:80000},
  after:{teamId:"t1",totalCount:5,totalRevenue:100000}
}];
function make(){
  const source={records:structuredClone(records),products:structuredClone(products),
    recordCorrections:structuredClone(recordCorrections)};
  const publicView={
    publicRecords:source.records.map(projectPublicRecordHeader),
    publicRecordLines:source.records.flatMap(projectPublicRecordLines),
    publicProducts:source.products.map(projectPublicProduct),
    publicRecordCorrections:source.recordCorrections.map(projectPublicCorrectionFlat)
  };
  return {companyId,source,publicView};
}
const verify=state=>verifyPreparedCountProjections(state);
test("two source records retain 5 sales units, 2 safe lines, product and audit identities",()=>{
  const data=make(),before=JSON.stringify(data);
  const status=verify(data);
  assert.deepEqual(status,{
    companyVerified:true,recordDocuments:2,storedContractCount:5,
    productDocuments:2,correctionDocuments:1,publicRecordLines:2,
    exactParity:true,databaseChanged:false
  });
  assert.equal(JSON.stringify(data),before,"reconciliation must not change either copy");
  assert.equal(JSON.stringify(status).includes("100000"),false);
  assert.equal(JSON.stringify(status).includes("private-r1"),false);
});
test("document order is irrelevant, missing/extra/duplicate public records are rejected",()=>{
  const data=make();
  for(const key of Object.keys(data.publicView))data.publicView[key].reverse();
  assert.equal(verify(data).storedContractCount,5);
  const missing=make();missing.publicView.publicRecords.pop();
  assert.throws(()=>verify(missing),/parity mismatch/);
  const extra=make();extra.publicView.publicRecords.push({...extra.publicView.publicRecords[0],sourceId:"extra"});
  assert.throws(()=>verify(extra),/parity mismatch/);
  const duplicate=make();duplicate.publicView.publicRecords.push(duplicate.publicView.publicRecords[0]);
  assert.throws(()=>verify(duplicate),/parity mismatch/);
});
test("tampered counts, team, dates and product IDs prevent public cutover",()=>{
  for(const [coll,field,value] of [
    ["publicRecords","totalCount",3],
    ["publicRecords","teamId","t-other"],
    ["publicRecords","date","2026-10-26"],
    ["publicRecordLines","count",4],
    ["publicRecordLines","productId","other-product"],
    ["publicRecordCorrections","afterTotalCount",999],
    ["publicProducts","name","wrong product"]
  ]){
    const data=make();
    data.publicView[coll][0][field]=value;
    assert.throws(()=>verify(data),/parity mismatch/,"must detect "+coll+" "+field);
  }
});
test("financial field injection and cross-company output are blocked",()=>{
  const financial=make();
  financial.publicView.publicRecords[0].revenue=100000;
  assert.throws(()=>verify(financial),/schema mismatch/);
  const another=make();
  another.publicView.publicRecordLines[0].companyId="different-company";
  assert.throws(()=>verify(another),/parity mismatch/);
  const changed=make();
  changed.source.records[0].companyId="different-company";
  assert.throws(()=>verify(changed),/cross-company/);
});
test("missing saved record/correction totals and inconsistent sources fail closed",()=>{
  const absent=make();
  delete absent.source.records[0].totalCount;
  assert.throws(()=>verify(absent),/Saved total count missing/);
  const mismatch=make();
  mismatch.source.records[0].totalCount=7;
  assert.throws(()=>verify(mismatch),/Saved total count missing or mismatch/);
  const badCorrection=make();
  delete badCorrection.source.recordCorrections[0].before.totalCount;
  assert.throws(()=>verify(badCorrection),/Invalid count/);
  const orphan=make();
  orphan.source.recordCorrections[0].recordId="missing-original";
  assert.throws(()=>verify(orphan),/absent source record/);
  const duplicated=make();
  duplicated.source.records.push(duplicated.source.records[0]);
  assert.throws(()=>verify(duplicated),/Duplicate/);
});
test("all sensitive identifiers and prices are absent from error messages",()=>{
  const data=make();
  data.publicView.publicRecordLines[0].count=55;
  try{verify(data);assert.fail("expected mismatch");}
  catch(e){
    assert.match(e.message,/Projection parity mismatch/);
    for(const secret of ["private-r1","担当者A","100000","20000"])
      assert.equal(e.message.includes(secret),false,"sensitive data leaked");
  }
});


test("offline prepare command builds exactly matched finance-free files without modifying original input",()=>{
  const temp=mkdtempSync(join(tmpdir(),"sales-partner-preview-"));
  try{
    const {source}=make(),payload={company:{id:companyId},original:source,
      period:"2026-10",summary:{dailyRecords:source.records.length}};
    const checksum=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const archive=join(temp,"owner-archive.json"),destination=join(temp,"preview");
    const snapshot=JSON.stringify({kind:"sales-archive",version:1,payload,checksum});
    writeFileSync(archive,snapshot);
    const command=new URL("../security/prepare-projection.mjs",import.meta.url).pathname;
    const run=spawnSync(process.execPath,[command,archive,destination],{encoding:"utf8"});
    assert.equal(run.status,0,run.stderr);
    const recordsOutput=JSON.parse(readFileSync(join(destination,"publicRecords.json"),"utf8"));
    assert.equal(recordsOutput.items.length,2);
    assert.equal(recordsOutput.items[0].totalCount,5);
    assert.equal(readFileSync(archive,"utf8"),snapshot,"archive source cannot change");
    const serialized=JSON.stringify(recordsOutput);
    for(const secret of ['"totalRevenue"','"revenuePerUnit"','"cashback"'])
      assert(!serialized.includes(secret),"financial metadata leaked");
    const manifest=JSON.parse(readFileSync(join(destination,"manifest.json"),"utf8"));
    assert.equal(manifest.containsFinancialData,false);
    assert.equal(manifest.counts.publicRecordLines,2);
  }finally{rmSync(temp,{force:true,recursive:true});}
});

test("offline prepare command refuses to create preview if original stored counts are missing",()=>{
  const temp=mkdtempSync(join(tmpdir(),"sales-partner-guard-"));
  try{
    const {source}=make();
    delete source.records[0].totalCount;
    const payload={company:{id:companyId},original:source,
      summary:{dailyRecords:source.records.length}};
    const checksum=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const archive=join(temp,"owner-archive.json"),destination=join(temp,"not-created");
    writeFileSync(archive,JSON.stringify({kind:"sales-archive",version:1,payload,checksum}));
    const command=new URL("../security/prepare-projection.mjs",import.meta.url).pathname;
    const run=spawnSync(process.execPath,[command,archive,destination],{encoding:"utf8"});
    assert.notEqual(run.status,0);
    assert.equal(existsSync(destination),false,"bad count must stop before writing");
  }finally{rmSync(temp,{force:true,recursive:true});}
});
