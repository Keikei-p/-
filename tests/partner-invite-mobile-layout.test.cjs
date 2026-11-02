"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");

function invitePanel(){
 const a=html.indexOf('<div id="partnerInviteInline"');
 const b=html.indexOf('id="ownerTransferPanel"',a);
 assert(a>=0&&b>a,"existing invite panel and owner management preserved");
 return html.slice(a,b);
}
test("partner company name and invited email are distinct, labelled, vertically stacked and mobile full-width",()=>{
 const page=invitePanel();
 const form=page.match(/<div id="partnerInviteFormFields"[\s\S]*?<\/div>\s*<div id="partnerInviteResult"/);
 assert(form,"invitation fields must be a dedicated vertical stack");
 assert.match(form[0],/display:grid;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(form[0],/gap:14px;width:100%;min-width:0/);
 assert.match(form[0],/<label for="partnerInviteCompanyName"[^>]*>[\s\S]*?協力店会社名[\s\S]*?<\/label>/);
 assert.match(form[0],/<label for="partnerInviteEmail"[^>]*>[\s\S]*?招待メールアドレス[\s\S]*?<\/label>/);
 assert.match(form[0],/<select id="partnerInviteCompanyName"[^>]*required/);
 assert.match(form[0],/id="partnerInviteEmail"[^>]*type="email"[\s\S]*?autocomplete="email"/);
 assert.equal((form[0].match(/min-height:48px;box-sizing:border-box/g)||[]).length,2);
 assert.equal((form[0].match(/style="display:block;width:100%;max-width:100%;min-width:0;min-height:48px/g)||[]).length,3);
 assert(!form[0].includes('class="management-input-row"'),"horizontal invite fields must be gone");
 const company=form[0].indexOf('id="partnerInviteCompanyName"');
 const email=form[0].indexOf('id="partnerInviteEmail"');
 const button=form[0].indexOf('id="partnerInviteCreateButton"');
 assert(company>=0&&email>company&&button>email);
});
test("existing invitations, company owner access, sales reports, finance display and partner workspace links remain intact",()=>{
 const panel=invitePanel();
 for(const marker of [
   'id="inviteDestinationSelect"',
   '<option value="internal">',
   '<option value="partner">',
   'id="employeeInviteFields"',
   'id="createInviteButton"',
   'id="partnerInviteCompanyName"',
   'id="partnerInviteEmail"',
   'id="partnerInviteCreateButton"',
   'id="partnerInviteLinkOutput"',
   'id="partnerInviteCopyButton"',
   'href="/partner-workspace.html"',
   'id="ownerTransferPanel"'
 ])assert(html.includes(marker),marker);
 const source=html.slice(html.indexOf('const partnerInviteCreateButton ='),html.indexOf('document.getElementById("partnerInviteCopyButton")'));
 assert(source.includes('partnerInlineManage({action:"hubCreateInvite",'));
 assert(source.includes('...(isNew?{companyName}:{partnerCompanyId,teamId}),role,email}'));
 assert(source.includes('currentCompanyData?.ownerUid !== currentUser.uid'));
 assert(source.includes('const sent=await composePartnerInvitationEmail();'));
 assert(source.includes('if(sent)showSuccess("協力店の認証メールを送信しました。'));
 assert(source.includes('else showError("招待リンクを作成しましたが、認証メールは未送信です。'));
 assert(html.includes("function canCurrentUserViewRevenueForTeam("));
 assert(html.includes("function canCurrentUserViewUnitPrice(")||html.includes("function canCurrentUserViewUnitPrice"));
 assert(html.includes("mergedPartnerRankingDay"));
 assert(html.includes("partnerRankingVirtualRecords"));
 assert(!panel.includes("getFirestore("));
});
