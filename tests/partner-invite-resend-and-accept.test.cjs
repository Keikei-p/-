"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const server=fs.readFileSync(path.join(__dirname,"../functions-partner-workspace/service.cjs"),"utf8");

test("existing sales and internal invitation UI remain present",()=>{
 for(const id of ["inviteDestinationSelect","employeeInviteFields","inviteEmailInput",
  "inviteRoleSelect","createInviteButton","companyNameDisplay",
  "partnerInviteCompanyName","partnerInviteRole","partnerInviteTeam",
  "partnerInviteCreateButton","partnerInviteCopyButton","partnerInviteResult"]){
  assert.ok(html.includes('id="'+id+'"'),"Missing existing UI: "+id);
 }
});

test("existing Firebase email resend is visible and confirms delivery only after the awaited SDK result",()=>{
 for(const id of ["partnerInviteSendEmailButton","partnerInviteResendEmailButton","partnerInviteEmailStatus"])
  assert.ok(html.includes('id="'+id+'"'),"Missing email control: "+id);
 assert.match(html,/await sendSignInLinkToEmail\(auth,latest\.email,partnerInviteAuthSettings\(latest\)\)/);
 assert.match(html,/Firebaseから認証メールを送信しました/);
 assert.match(html,/メールは送信されていません/);
 assert.match(html,/if\(Date\.now\(\)>=invite\.expiresAt\)/);
 assert.match(html,/partnerInlineManage\(\{action:"hubCreateInvite"/);
 assert.match(html,/partnerCompanyId:invite\.partnerCompanyId,teamId:invite\.teamId/);
 assert.match(html,/document\.getElementById\("partnerInviteEmail"\)\.addEventListener/);
 assert.match(html,/addEventListener\("input",clearDirectPartnerEmailResult\)/);
 assert.match(html,/directPartnerLastInvitation=null/);
 assert.doesNotMatch(html,/送信が完了しました/);
});

test("invite recipient is verified and may change account before acceptance",()=>{
 assert.match(html,/partnerInlineAccept\(\{token:invite\.token,previewOnly:true\}\)/);
 assert.match(html,/pMainChangeInviteAccount/);
 assert.match(html,/await signOut\(auth\)/);
 assert.match(html,/code==="functions\/permission-denied"/);
 assert.match(html,/code==="functions\/failed-precondition"/);
 assert.match(html,/pMainInviteName/);
 assert.match(html,/transferCurrentCompany:false/);
});

test("server invite preview is authenticated, scoped, read-only and expires",()=>{
 assert.match(server,/if\(d\.previewOnly===true\)/);
 assert.match(server,/i\.emailLower!==a\.email/);
 assert.match(server,/i\.expiresAt\.toMillis\(\)<=now\(\)/);
 assert.match(server,/company\.data\(\)\?\.companyKind!=="partner"/);
 assert.match(server,/relation\.data\(\)\?\.countSharingApproved!==true/);
 assert.match(server,/return \{valid:true,companyName/);
 const preview=server.slice(server.indexOf("if(d.previewOnly===true)"),server.indexOf("const joined=await db.runTransaction"));
 assert.doesNotMatch(preview,/\.set\(|\.update\(|\.create\(|\.delete\(|runTransaction/);
});

test("existing-member email fallback is fail-closed for explicit wrong email",()=>{
 assert.match(server,/original\.uid!==a\.uid/);
 assert.match(server,/clean\(original\.email\)\.toLowerCase\(\)!==a\.email/);
 assert.match(server,/clean\(pm\.email\)\.toLowerCase\(\)!==a\.email/);
 assert.match(server,/pc\.ownerUid===a\.uid/);
 assert.match(server,/canViewRevenue:false,canViewUnitPrice:false/);
 assert.match(server,/const transfer=d\.transferCurrentCompany===true/);
});
