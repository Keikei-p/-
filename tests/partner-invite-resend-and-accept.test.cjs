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

test("partner email composer and resend are visible but never claim automatic delivery",()=>{
 for(const id of ["partnerInviteSendEmailButton","partnerInviteResendEmailButton","partnerInviteEmailStatus"])
  assert.ok(html.includes('id="'+id+'"'),"Missing email control: "+id);
 assert.match(html,/window\.location\.href=partnerInviteMailUrl\(latest\)/);
 assert.match(html,/mailto:/);
 assert.match(html,/自動送信はされません/);
 assert.match(html,/宛先を確認して「送信」を押してください/);
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
