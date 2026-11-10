import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const canonical=readFileSync(new URL(
 "../ranking/ranking-owner-consent-status.mjs",import.meta.url),"utf8");
const deployed=readFileSync(new URL(
 "../functions-ranking-approvals/vendor/ranking-owner-consent-status.mjs",import.meta.url),"utf8");
test("reviewed server consent status and vendored production callable stay byte-for-byte identical",()=>{
 assert.equal(deployed,canonical);
 assert.match(deployed,/const ownerClaimed=id\(partner.ownerUid\)/);
 assert.match(deployed,/partner.active===true&&ownerClaimed/);
 assert.match(deployed,/partnerApprovalSnap.exists/);
 assert.match(deployed,/rel.combinedRankingApprovedByPartner===true/);
 assert.match(deployed,/rel.individualNamesApprovedByPartner===true/);
 assert.match(deployed,/partnerViewer&&!ownerClaimed/);
 assert.doesNotMatch(deployed,/setDoc\(|updateDoc\(|\.set\(|\.update\(|\.delete\(|firebase deploy/);
});
test("no real partner identity is ever synthesized by status view",()=>{
 assert(!deployed.includes('partner.ownerUid=auth.uid'));
 assert(!deployed.includes('ownerUid=hub.ownerUid'));
 assert(!deployed.includes('approved:true,version:0'));
});
