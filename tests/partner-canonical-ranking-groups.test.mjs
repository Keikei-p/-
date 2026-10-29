import test from "node:test";
import assert from "node:assert/strict";
import {buildSharedCanonicalRankingGroups} from "../partner/canonical-ranking-groups.mjs";
const products=[
 {companyId:"hub",sourceId:"nuro",name:"NURO光",active:true,sortOrder:0},
 {companyId:"hub",sourceId:"energy",name:"電気",active:true,sortOrder:1}
];
const relation=(id)=>({hubCompanyId:"hub",partnerCompanyId:id,
 serverVerified:true,active:true,catalogAccessApproved:true,countSharingApproved:true});
const data=()=>({hubCompanyId:"hub",hubPublicProducts:products,
 partnerRelations:[relation("p1"),relation("p2")]});
test("central hub IDs map automatically to two partners without name matching",()=>{
 const original=data(),before=JSON.stringify(original);
 const groups=buildSharedCanonicalRankingGroups(original);
 assert.equal(groups.length,6);
 assert.deepEqual(groups.filter(x=>x.groupId==="canon:hub:nuro").map(x=>x.productId).sort(),
  ["nuro","shared:hub:nuro","shared:hub:nuro"].sort());
 assert.deepEqual(groups.filter(x=>x.groupId==="canon:hub:energy").map(x=>x.companyId).sort(),
  ["hub","p1","p2"]);
 assert.equal(JSON.stringify(original),before);
});
test("private custom product is never exported to company-wide mapping",()=>{
 const d=data();
 d.partnerPublicCustomProducts=[{companyId:"p1",productId:"local",name:"非公開",visibility:"private"}];
 assert.throws(()=>buildSharedCanonicalRankingGroups(d),/Invalid or unapproved/);
 const approved=data();
 approved.partnerPublicCustomProducts=[{companyId:"p1",productId:"publicLocal",name:"共有独自",visibility:"shared_counts"}];
 const groups=buildSharedCanonicalRankingGroups(approved);
 assert(groups.some(x=>x.groupId==="partner:p1:publicLocal"));
 assert.equal(groups.filter(x=>x.groupId==="partner:p1:publicLocal").length,1);
});
test("unapproved or duplicated external partner breaks mapping",()=>{
 for(const edit of [
  d=>{d.partnerRelations[1].active=false;},
  d=>{d.partnerRelations[1].countSharingApproved=false;},
  d=>{d.partnerRelations[1].catalogAccessApproved=false;},
  d=>{d.partnerRelations[1].serverVerified=false;},
  d=>{d.partnerRelations[1].partnerCompanyId="p1";},
  d=>{d.hubPublicProducts[0].companyId="wrong";},
  d=>{d.hubPublicProducts.push(d.hubPublicProducts[0]);},
  d=>{d.hubPublicProducts[0].revenue=20000;}
 ]){
  const d=data();d.hubPublicProducts=structuredClone(products);d.partnerRelations=d.partnerRelations.map(x=>({...x}));
  edit(d);assert.throws(()=>buildSharedCanonicalRankingGroups(d),/Invalid or unapproved|schema mismatch/);
 }
});
