import test from "node:test";
import assert from "node:assert/strict";
import {normalizeInternalCountMembership} from "../src/internal-count-membership.mjs";
import {projectLegacyCountDay} from "../../security/legacy-internal-count-bridge.mjs";
import {approvedPolicy} from "../src/index.js";

const uid="owner001",companyId="direct001";
const legacy={
 uid,companyId,
 user:{id:uid,companyId,companyRole:"owner",role:"owner"},
 member:{id:uid,companyRole:"owner",role:"owner"},
 company:{id:companyId,ownerUid:uid},
};
test("legacy direct owner missing redundant user/member UID and active markers still gets count-only data",()=>{
 const p=normalizeInternalCountMembership(legacy);
 assert.equal(p.user.uid,uid);
 assert.equal(p.member.uid,uid);
 assert.equal(p.member.companyId,companyId);
 assert.equal(p.user.active,true);
 assert.equal(p.member.active,true);
 const record={id:"r1",companyId,uid,date:"2026-10-31",teamId:"t1",
  results:{NURO:{productId:"NURO",count:3,revenuePerUnit:18000,cashback:10000}},
  totalCount:3,totalRevenue:54000};
 const before=JSON.stringify(record);
 const x=projectLegacyCountDay({principal:p,day:"2026-10-31",
  readTime:"2026-10-31T06:30:00Z",records:[record],products:[]});
 assert.equal(x.records[0].totalCount,3);
 assert.equal(x.lines[0].count,3);
 assert.equal(JSON.stringify(x).includes("54000"),false);
 assert.equal(JSON.stringify(x).includes("18000"),false);
 assert.equal(JSON.stringify(record),before);
});
test("existing internal owner finance grants remain independent of count-only normalization",()=>{
 const original=approvedPolicy({...legacy.user,uid,active:true},
  {...legacy.member,uid,companyId,active:true},
  {...legacy.company,active:true},uid,"2026-10-31");
 assert.equal(original.isOwner,true);
 assert.equal(original.canViewRevenue,true);
 assert.equal(original.canViewUnitPrice,true);
 const normalized=normalizeInternalCountMembership(legacy);
 assert.equal(normalized.member.canViewRevenue,undefined);
 assert.equal(normalized.member.canViewUnitPrice,undefined);
});
test("explicit disabled, conflicting UID/roles, wrong company, or partner markers are denied",()=>{
 const bad=[
  {...legacy,user:{...legacy.user,uid:"foreign"}},
  {...legacy,member:{...legacy.member,uid:"foreign"}},
  {...legacy,member:{...legacy.member,id:"foreign"}},
  {...legacy,user:{...legacy.user,id:"foreign"}},
  {...legacy,company:{...legacy.company,id:"foreign"}},
  {...legacy,member:{...legacy.member,companyId:"foreign"}},
  {...legacy,user:{...legacy.user,companyId:"foreign"}},
  {...legacy,user:{...legacy.user,active:false}},
  {...legacy,member:{...legacy.member,active:false}},
  {...legacy,company:{...legacy.company,active:false}},
  {...legacy,member:{...legacy.member,companyRole:"member"}},
  {...legacy,company:{...legacy.company,companyKind:"partner"}},
  {...legacy,user:{...legacy.user,accessKind:"partner"}},
  {...legacy,member:{...legacy.member,memberType:"cooperator"}},
  {...legacy,company:{...legacy.company,companyKind:"unclassified"}},
  {...legacy,uid:"foreign"},
 ];
 for(const candidate of bad){
  assert.throws(()=>normalizeInternalCountMembership(candidate),
   /legacy_count_membership_denied/);
 }
});
test("normalizer cannot mutate Firestore snapshots or add price access flags",()=>{
 const before=JSON.stringify(legacy);
 const result=normalizeInternalCountMembership(legacy);
 assert.equal(JSON.stringify(legacy),before);
 assert.equal(Object.hasOwn(result.user,"canViewRevenue"),false);
 assert.equal(Object.hasOwn(result.member,"canViewUnitPrice"),false);
 assert.equal(result.serverMembershipVerified,true);
 assert.notEqual(result.user,legacy.user);
 assert.notEqual(result.member,legacy.member);
});
