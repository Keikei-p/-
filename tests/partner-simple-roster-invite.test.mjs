import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workspace=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const companyInvite=readFileSync(new URL("../partner-invite.html",import.meta.url),"utf8");
const service=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
test("one partner roster uses existing no-email managed staff service, not fake accounts",()=>{
 assert.match(workspace,/id="managedName"[^>]*メールなしで登録するスタッフ名/);
 assert.match(workspace,/id="managedTeam"/);
 assert.match(workspace,/action:"addManaged"/);
 assert.match(service,/if\(op==="addManaged"\)/);
 assert.match(service,/kind:"managed",role:"member",uid:null/);
 assert.match(service,/s\.role==="leader"&&staff\.teamId===s\.teamId/);
 assert.match(workspace,/件数の入力はリーダー/);
});
test("hub selects leader or companion without changing server role definitions",()=>{
 assert.match(companyInvite,/id="existingRole"/);
 assert.match(companyInvite,/<option value="leader">リーダー<\/option><option value="member">同行（メンバー権限）<\/option>/);
 assert.match(companyInvite,/action:"hubCreateInvite"/);
 assert.match(workspace,/id="hubInviteRoleSelect"/);
 assert.match(workspace,/<option value="leader">リーダー<\/option><option value="member">同行（メンバー権限）<\/option>/);
 assert.match(service,/\["leader","member"\]\.includes\(d\.role\)/);
});
test("company invite and existing entry/count/ranking paths remain intact",()=>{
 for(const marker of ["createPartnerCompanyInvitation","acceptPartnerCompanyInvitation","getPartnerWorkspace"])
  assert.ok(companyInvite.includes(marker),marker);
 for(const marker of ["getPartnerWorkspace","submitPartnerWorkspaceCounts","addManaged",
  "countProductRank","countStaffRank","hubCreateInvite","renderCompanyOverview"])
  assert.ok(workspace.includes(marker),marker);
 assert.doesNotMatch(workspace,/firebase-firestore\.js|\bgetFirestore\(|\bgetDoc\(|\bsetDoc\(|\bdeleteDoc\(/);
 assert.doesNotMatch(companyInvite,/firebase-firestore\.js|\bgetFirestore\(|\bgetDoc\(|\bsetDoc\(|\bdeleteDoc\(/);
});
