import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeArchiveCoverage,checkArchiveCoverage,NOT_INCLUDED_IN_HISTORY_EXPORT} from "../archive-coverage.mjs";

const payload=()=>({
  original:{
   records:[{id:"r1",companyId:"co"}],
   products:[{id:"p1",companyId:"co"}],
   recordCorrections:[],
   teams:[{id:"t1",companyId:"co"}]
  }
});
test("four-collection sales archive explicitly cannot claim complete-company backup",()=>{
 const p=payload(),scope=makeArchiveCoverage(p);
 assert.equal(scope.scope,"sales_history_4_collections_not_full_company");
 assert.equal(scope.completeCompanyBackup,false);
 assert.equal(scope.productionDeletionEligible,false);
 assert.equal(scope.sameTimestampAcrossCollections,false);
 assert.deepEqual(scope.capturedDocumentCounts,{
   records:1,products:1,recordCorrections:0,teams:1
 });
 assert(NOT_INCLUDED_IN_HISTORY_EXPORT.includes("users/{uid}"));
 assert(NOT_INCLUDED_IN_HISTORY_EXPORT.includes("revenueGoals"));
 assert(NOT_INCLUDED_IN_HISTORY_EXPORT.includes("companies/{companyId}/members/{uid}"));
 assert.deepEqual(checkArchiveCoverage({...p,coverage:scope}),scope);
});
test("legacy archive without coverage is accepted for partial verification ONLY",()=>{
 const scope=checkArchiveCoverage(payload());
 assert.equal(scope.completeCompanyBackup,false);
 assert.equal(scope.productionDeletionEligible,false);
});
test("false full-backup or deletion-allowed manifest is refused",()=>{
 const p=payload(),scope=makeArchiveCoverage(p);
 for(const edit of [
  {completeCompanyBackup:true},
  {productionDeletionEligible:true},
  {capturedDocumentCounts:{records:99}},
  {excludedOrUnverifiedPaths:[]},
  {sameTimestampAcrossCollections:true}
 ]){
  assert.throws(()=>checkArchiveCoverage({...p,coverage:{...scope,...edit}}),
   /Incomplete sales history export/);
 }
});
test("empty/partial/unrecognized collection maps cannot be marketed as complete",()=>{
 for(const bad of [
  {},{records:[],products:[],teams:[]},
  {...payload().original,users:[]},
  {...payload().original,records:"not a snapshot"}
 ]) assert.throws(()=>makeArchiveCoverage({original:bad}),/Incomplete sales history export/);
});
const js=readFileSync(new URL("../sales-archive.js",import.meta.url),"utf8");
function ownerEvaluator(){
 const a=js.indexOf("async function companyForOwner("),
       b=js.indexOf("function period(",a);
 assert(a>=0&&b>a);
 // Inject fake server responses; never connect to Firebase.
 return new Function("getDocFromServer","doc","db",js.slice(a,b)+"\nreturn companyForOwner;")(
  async ref=>ref.kind==="user"?{exists:()=>true,data:()=>structuredClone(ref.user)}:
    ref.kind==="company"?{exists:()=>true,data:()=>structuredClone(ref.company)}:
    {exists:()=>true,data:()=>structuredClone(ref.member)},
  (_db,...parts)=>parts[0]==="users"?{kind:"user",user:globalFixture.user}:
   parts.length===2?{kind:"company",company:globalFixture.company}:
   {kind:"member",member:globalFixture.member},
  {}
 );
}
let globalFixture;
function fixture(){
 return {
  user:{uid:"u1",active:true,companyId:"c1",companyRole:"owner",accessKind:"internal"},
  company:{ownerUid:"u1",masterUid:"u1",active:true,companyKind:"internal",name:"内製会社"},
  member:{companyId:"c1",companyRole:"owner",active:true,accessKind:"internal"}
 };
}
test("staged archive owner check excludes partner-company owner even with finance flags",async()=>{
 const owner=ownerEvaluator();
 for(const mutation of [
  x=>{x.company.companyKind="partner";},
  x=>{x.company.companyKind="external";},
  x=>{x.user.accessKind="unknown";},
  x=>{x.member.memberType="vendor";},
  x=>{x.user.accessKind="partner";},
  x=>{x.member.accessKind="partner";},
  x=>{x.user.memberType="cooperator";},
  x=>{x.company.active=false;}
 ]){
  globalFixture=fixture();mutation(globalFixture);
  assert.equal(await owner({uid:"u1",emailVerified:true}),null);
 }
 globalFixture=fixture();
 assert.deepEqual(await owner({uid:"u1",emailVerified:true}),
   {id:"c1",name:"内製会社"});
});
