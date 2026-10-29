import {test} from "node:test";
import assert from "node:assert/strict";
import {partnerActivationWrites} from "../src/partner-provision.mjs";
const companyId="c1",uid="external",version="2026-10-27T00:00:00Z";
const policy={uid:"owner",companyId,isOwner:true,isPartner:false};
const account={uid,companyId,companyRole:"member",role:"leader",teamId:"team1",
  active:true,recordVersion:version};
const member={...account},team={id:"team1",companyId,active:true};
const props={policy,targetUid:uid,user:account,member,team};

test("Owner can atomically stamp only accessKind of an existing verified leader with matching team",()=>{
 const writes=partnerActivationWrites(props);
 assert.equal(writes.length,2);
 assert.deepEqual(writes.map(w=>w.update.name),[
  "projects/sales-management-cc116/databases/(default)/documents/users/external",
  "projects/sales-management-cc116/databases/(default)/documents/companies/c1/members/external"
 ]);
 for(const write of writes){
  assert.deepEqual(write.updateMask.fieldPaths,["accessKind"]);
  assert.deepEqual(write.update.fields,{accessKind:{stringValue:"partner"}});
  assert.deepEqual(write.currentDocument,{updateTime:version});
 }
 assert.equal(account.accessKind,undefined);
 assert.equal(member.accessKind,undefined);
});
test("Activation rejects nonowners, cross-company, owner/master target and mismatched team",()=>{
 for(const v of [
  {...props,policy:{...policy,isOwner:false}},
  {...props,policy:{...policy,isPartner:true}},
  {...props,targetUid:"owner",user:{...account,uid:"owner"},member:{...member,uid:"owner"}},
  {...props,user:{...account,companyId:"other"}},
  {...props,member:{...member,companyRole:"owner"}},
  {...props,user:{...account,role:"member"}},
  {...props,user:{...account,teamId:"team2"}},
  {...props,team:{...team,active:false}},
  {...props,member:{...member,recordVersion:null}}
 ])assert.throws(()=>partnerActivationWrites(v));
});
test("Repeated activation is idempotent and partially stamped account can be completed",()=>{
 assert.deepEqual(partnerActivationWrites({
  ...props,user:{...account,accessKind:"partner"},member:{...member,accessKind:"partner"}
 }),[]);
 const one=partnerActivationWrites({...props,user:{...account,accessKind:"partner"}});
 assert.equal(one.length,1);
 assert.match(one[0].update.name,/members\/external$/);
});
