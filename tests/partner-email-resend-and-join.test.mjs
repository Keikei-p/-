import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const pick=id=>(html.match(new RegExp('id="'+id+'"',"g"))||[]).length;
test("every invite button and feedback surface appears once inside the canonical same-app screen",()=>{
 for(const id of ["partnerInviteSendEmailButton","partnerInviteResendEmailButton",
  "partnerInviteEmailStatus","pMainChangeInviteAccount","pMainInviteStatus"]){
  assert.equal(pick(id),1,id);
 }
 assert.match(html,/招待後に認証メールを自動送信します。未送信の場合は理由を表示します/);
 assert.match(html,/document\.getElementById\("partnerInviteResendEmailButton"\)\.onclick=composePartnerInvitationEmail/);
 assert.match(html,/document\.getElementById\("partnerInviteSendEmailButton"\)\.onclick=composePartnerInvitationEmail/);
});
test("resend never silently claims delivery, uses current role email and team, refreshes only after expiry",()=>{
 assert.match(html,/Date\.now\(\)>=invite\.expiresAt/);
 assert.match(html,/action:"hubCreateInvite",\s*partnerCompanyId:invite\.partnerCompanyId,teamId:invite\.teamId/);
 assert.match(html,/email:invite\.email,role:invite\.role/);
 assert.match(html,/sendSignInLinkToEmail\(auth,latest.email,partnerInviteAuthSettings\(latest\)\)/);
 assert.match(html,/handleCodeInApp:true/);
 assert.doesNotMatch(html,/partnerInviteMailUrl\(latest\)/);
 assert.doesNotMatch(html,/招待メールを自動送信しました/);
});
test("join is previewed only by verified signed-in email before mutation",()=>{
 assert.match(html,/partnerInlineAccept\(\{token:invite\.token,previewOnly:true\}\)/);
 assert.match(html,/別のメールでログイン/);
 assert.match(html,/pMainChangeInviteAccount"\)\.onclick=async/);
 assert.match(server,/if\(i\.emailLower!==a\.email\)fail\("permission-denied"\)/);
 assert.match(server,/if\(d\.previewOnly===true\)/);
 assert.match(server,/return \{valid:true,companyName:/);
 assert.match(server,/m\.companyId!=null&&m\.companyId!==cid/);
 assert.match(server,/clean\(pm\.email\)&&clean\(pm\.email\)/);
 assert.match(html,/transferCurrentCompany:false/);
});
test("only the original finance-protected source remains and no new financial permissions are granted",()=>{
 for(const text of ["canViewRevenue:false","canViewUnitPrice:false","partnerWorkspaceContexts"]){
  assert.ok(server.includes(text));
 }
 assert.ok(html.includes("canViewRevenue"));
 assert.doesNotMatch(server,/\btx\.delete\s*\(|recursiveDelete/);
});
test("invite mail is automatically sent by Firebase and never faked by link creation",()=>{
 assert.match(html,/const sent=await composePartnerInvitationEmail\(\)/);
 assert.match(html,/if\(sent\)showSuccess\("協力店の認証メールを送信しました/);
 assert.match(html,/else showError\("招待リンクを作成しましたが、認証メールは未送信です/);
 assert.match(html,/auth\/operation-not-allowed/);
 assert.match(html,/partnerInviteAuthSettings\(\{url:url.href\}\)/);
 assert.doesNotMatch(html,/window\.location\.href=partnerInviteMailUrl/);
});
test("recipient verifies invitation mailbox first, sets first password, and then accepts count-only invite",()=>{
 for(const id of ["partnerEmailLinkVerifyPanel","partnerEmailLinkPasswordPanel","partnerEmailLinkAddress",
  "partnerEmailLinkName","partnerEmailLinkPassword","partnerEmailLinkPasswordConfirm",
  "partnerEmailLinkVerifyButton","partnerEmailLinkPasswordButton"]){
  assert.equal(pick(id),1,id);
 }
 assert.match(html,/isSignInWithEmailLink\(auth,location.href\)/);
 assert.match(html,/await signInWithEmailLink\(auth,email,location.href\)/);
 assert.match(html,/await updatePassword\(user,pass\)/);
 assert.match(html,/await createUserDocument\(user,name\)/);
 assert.match(html,/await showPartnerInviteAtMain\(user,\{kind:"staff",token:pending.token\}\)/);
 assert.match(html,/if\(partnerEmailLinkPending\|\|partnerEmailLinkBusy\|\|partnerEmailLinkPasswordState\)/);
 assert.match(html,/await signInWithEmailAndPassword\(/); // original employee login stays
 assert.match(html,/transferCurrentCompany:false/); // historical internal sales unchanged
});
