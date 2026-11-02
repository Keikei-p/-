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
 assert.match(html,/メールアプリで送信してください。送信前は相手に届きません/);
 assert.match(html,/document\.getElementById\("partnerInviteResendEmailButton"\)\.onclick=composePartnerInvitationEmail/);
 assert.match(html,/document\.getElementById\("partnerInviteSendEmailButton"\)\.onclick=composePartnerInvitationEmail/);
});
test("resend never silently claims delivery, uses current role email and team, refreshes only after expiry",()=>{
 assert.match(html,/Date\.now\(\)>=invite\.expiresAt/);
 assert.match(html,/action:"hubCreateInvite",\s*partnerCompanyId:invite\.partnerCompanyId,teamId:invite\.teamId/);
 assert.match(html,/email:invite\.email,role:invite\.role/);
 assert.match(html,/window\.location\.href=partnerInviteMailUrl\(latest\)/);
 assert.match(html,/mailto:/);
 assert.doesNotMatch(html,/招待メールを自動送信しました|メールを送信しました/);
});
test("join is previewed only by verified signed-in email before mutation",()=>{
 assert.match(html,/partnerInlineAccept\(\{token:invite\.token,previewOnly:true\}\)/);
 assert.match(html,/別のメールでログイン/);
 assert.match(html,/pMainChangeInviteAccount"\)\.onclick=async/);
 assert.match(server,/if\(i\.emailLower!==a\.email\)fail\("permission-denied"\)/);
 assert.match(server,/if\(d\.previewOnly===true\)/);
 assert.match(server,/return \{valid:true,companyName:/);
 assert.match(server,/m\.companyId!=null&&m\.companyId!==cid/);
 assert.match(server,/pm\.email!=null&&clean\(pm\.email\)/);
 assert.match(html,/transferCurrentCompany:false/);
});
test("only the original finance-protected source remains and no new financial permissions are granted",()=>{
 for(const text of ["canViewRevenue:false","canViewUnitPrice:false","partnerWorkspaceContexts"]){
  assert.ok(server.includes(text));
 }
 assert.ok(html.includes("canViewRevenue"));
 assert.doesNotMatch(server,/\btx\.delete\s*\(|recursiveDelete/);
});