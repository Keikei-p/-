import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const invite=readFileSync(new URL("../partner-invite.html",import.meta.url),"utf8");
const quick=readFileSync(new URL("../partner-counts.html",import.meta.url),"utf8");
test("new partner invitation guides to live count-only screen, not locked workspace",()=>{
 assert.match(invite,/id="workspaceGuide"[^>]*href="\/partner-counts\.html"/);
 assert.match(invite,/id="acceptedWorkspaceLink" href="\/partner-counts\.html"/);
 assert.match(invite,/if\(data\.secondaryMembership===false\)/);
 assert.match(invite,/\$\("acceptedWorkspaceLink"\)\.href="\/partner-counts\.html"/);
 assert.match(invite,/件数利用を承認/);
 assert.match(quick,/submitPartnerQuickCounts/);
 assert.match(quick,/getPartnerQuickCounts/);
});
test("previous internal employee account never masquerades as approved quick-count partner",()=>{
 assert.match(invite,/if\(data\.secondaryMembership===true\)/);
 assert.match(invite,/workspace\.searchParams\.set\("workspaceCompanyId",data\.partnerCompanyId\)/);
 assert.match(invite,/兼任の所属先を確認（件数入力は未確認）/);
 assert.match(invite,/元アカウントを削除せず/);
});
test("existing invitation, recovery and staff management remain intact",()=>{
 for(const x of ["createPartnerCompanyInvitation","acceptPartnerCompanyInvitation",
 "previewPartnerCompanyInvitation","managePartnerWorkspace",
 'action:"hubCreateInvite"',"既存","登録済み協力店にスタッフを招待",
 "パスワードを再設定","確認メールを再送"])assert.ok(invite.includes(x),x);
 assert.doesNotMatch(invite,/firebase-firestore\.js|\bgetFirestore\(|\bsetDoc\(|\bdeleteDoc\(/);
});
