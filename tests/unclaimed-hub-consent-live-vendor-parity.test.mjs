import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=name=>readFileSync(new URL("../ranking/"+name,import.meta.url),"utf8");
const vendored=name=>readFileSync(new URL("../functions-ranking-approvals/vendor/"+name,import.meta.url),"utf8");
for(const name of ["ranking-owner-consent-status.mjs","ranking-owner-consent-service.mjs"]){
 test(name+" is exactly same reviewed source as deployable vendor",()=>{
  assert.equal(vendored(name),load(name));
 });
}
test("no one may grant Partner consent from Hub or fabricate consent",()=>{
 const s=load("ranking-owner-consent-service.mjs");
 assert.match(s,/partnerViewer&&partnerOwnerUnclaimed/);
 assert.match(s,/partnerConsentSnap\?\.exists===true/);
 assert.match(s,/rel\.combinedRankingApprovedByPartner===true/);
 assert.match(s,/rel\.individualNamesApprovedByPartner===true/);
 assert.match(s,/const side=partnerViewer\?"Partner":"Hub"/);
 assert.match(s,/approvedByUid:auth.uid/);
 assert.match(s,/tx\.create\(audit,/);
 assert.doesNotMatch(s,/records[/]|unitPrice|totalRevenue|cashbackOptions|\.delete\(/);
 const status=load("ranking-owner-consent-status.mjs");
 assert.match(status,/partner\.active===true&&\(!partnerViewer\|\|ownerClaimed\)/);
 assert.match(status,/if\(partnerViewer&&!ownerClaimed\)STOP\(\)/);
 assert.match(status,/if\(partnerApprovalSnap\.exists\|\|/);
});
