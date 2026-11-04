"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,".."),html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const api=fs.readFileSync(path.join(root,"functions-account-erasure/service.cjs"),"utf8");
const index=fs.readFileSync(path.join(root,"functions-account-erasure/index.js"),"utf8");
test("owner and partner leader have separate manager-only hard erasure action",()=>{
 assert.match(html,/const accountErasurePreview = httpsCallable\(partnerCountFunctions,"previewManagedAccountErasure"\)/);
 assert.match(html,/const accountErasureConfirm = httpsCallable\(partnerCountFunctions,"confirmManagedAccountErasure"\)/);
 assert.match(html,/async function eraseManagedAccount\(targetUid,targetName,refresh\)/);
 assert.match(html,/!isManagedMember\(member\) && \(member\.id \|\| member\.uid\)/);
 assert.match(html,/snap\.role==="leader"&&person\.role==="member"&&person\.teamId===snap\.teamId/);
 assert.match(html,/managedAccountErasureConfirmation\(targetName\)/);
 assert.match(html,/reauthenticateWithCredential\(operator,cred\)/);
 assert.match(html,/confirmation:"DELETE_ACCOUNT_ONLY",confirmName:targetName/);
 assert.match(html,/result\.authDeleted!==true\|\|result\.personalProfileDeleted!==true/);
});
test("user is shown irreversible confirmation with preserved team and business history warning",()=>{
 assert.match(html,/nameInput\.value\.trim\(\)!==targetName/);
 assert.match(html,/password\.type="password"/);
 assert.match(html,/Auth.*現役プロフィール/);
 assert.match(html,/過去の実績件数・売上・当時単価・班・訂正記録/);
 assert.match(html,/過去の実績に保存された名前も残る場合/);
});
test("account erasure is isolated from old suspend and Firebase sales collections",()=>{
 const original=fs.readFileSync(path.join(root,"functions/index.js"),"utf8");
 assert.match(original,/exports\.deleteCompanyMemberAccount = onCall/);
 assert.match(original,/getAuth\(\)\.updateUser\(targetUid, \{ disabled: true \}\)/);
 assert.doesNotMatch(original,/getAuth\(\)\.deleteUser/);
 assert.doesNotMatch(api,/collection\("(?:records|products|recordCorrections|revenueGoals|partnerWorkEntries|partnerWorkCountDays)"\)/);
 assert.match(api,/async function preview\(request\)/);
 assert.match(api,/async function confirm\(request\)/);
 assert.match(api,/await getAuth\(\)\.deleteUser\(d\.targetUid\)/);
 assert.match(api,/ref\("partnerWorkspaceContexts",targetUid\)/);
 assert.match(api,/ref\("partnerHistoricalTransfers",targetUid\)/);
 assert.match(index,/NICO_ACCOUNT_ERASURE_ENABLED==="enabled"/);
});
test("isolated deployment file excludes Hosting and Firestore Rules",()=>{
 const json=JSON.parse(fs.readFileSync(path.join(root,"firebase.account-erasure.json"),"utf8"));
 assert.deepEqual(Object.keys(json),["functions"]);
 assert.equal(json.functions.source,"functions-account-erasure");
 assert.equal(json.functions.codebase,"account-erasure");
});
