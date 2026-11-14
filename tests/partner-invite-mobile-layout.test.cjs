"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
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
 assert.match(source,/const sent=await composePartnerInvitationEmail\(\);\s*if\(sent\)showSuccess\("協力店の認証メールを送信しました。/);
 assert.match(source,/else showError\("招待リンクを作成しましたが、認証メールは未送信です。/);
 assert(html.includes("function canCurrentUserViewRevenueForTeam("));
 assert(html.includes("function canCurrentUserViewUnitPrice(")||html.includes("function canCurrentUserViewUnitPrice"));
 assert(html.includes("mergedPartnerRankingDay"));
 assert(html.includes("partnerRankingVirtualRecords"));
 assert(!panel.includes("getFirestore("));
});

test("invite creation reports success only after Firebase mail sends, and keeps failed mail retryable",async()=>{
 const helperStart=html.indexOf("function partnerInviteAuthSettings(invite){");
 const helperEnd=html.indexOf('document.getElementById("partnerInviteSendEmailButton").onclick=',helperStart);
 const start=html.indexOf("const partnerInviteCreateButton =");
 const end=html.indexOf('document.getElementById("partnerInviteCopyButton")',start);
 assert(helperStart>0&&helperEnd>helperStart&&start>0&&end>start);
 for(const scenario of ["sent","mail_disabled","network_failure","owner_changed","invalid_token"]){
  const messages={success:[],error:[]},calls=[],controls={};
  for(const id of ["partnerInviteCreateButton","partnerInviteSendEmailButton","partnerInviteResendEmailButton",
   "partnerInviteEmailStatus","partnerInviteLinkOutput","partnerInviteResult"])
   controls[id]={value:"",textContent:"",disabled:false,hidden:true};
  for(const [id,value]of Object.entries({partnerInviteCompanyName:"partner",partnerInviteTeam:"team",
   partnerInviteRole:"member",partnerInviteEmail:"Worker@example.test",partnerInviteNewCompanyName:""}))
   controls[id]={value};
  const context=vm.createContext({URL,Date,location:{origin:"https://example.test"},auth:{},
   document:{getElementById:id=>controls[id]},console:{error:()=>{}},
   currentUser:{uid:"owner",emailVerified:true},currentCompanyData:{ownerUid:"owner",companyKind:"internal"},
   currentUserData:{accessKind:"internal"},directPartnerLastInvitation:null,
   directPartnerInviteCompanies:[{partnerCompanyId:"partner",active:true,teams:[{id:"team"}]}],
   partnerMainValidId:x=>/^[A-Za-z0-9_-]+$/.test(x),
   partnerInlineManage:async input=>{
    calls.push("create");assert.deepEqual({...input},{action:"hubCreateInvite",partnerCompanyId:"partner",teamId:"team",role:"member",email:"worker@example.test"});
    if(scenario==="owner_changed")context.currentUser={uid:"other",emailVerified:true};
    return {data:{token:scenario==="invalid_token"?"bad":"A".repeat(43),
     partnerCompanyId:"partner",teamId:"team",expiresAt:Date.now()+60000}};
   },
   sendSignInLinkToEmail:async(auth,email,settings)=>{
    calls.push("mail");assert.equal(email,"worker@example.test");
    assert.equal(settings.handleCodeInApp,true);assert.equal(new URL(settings.url).origin,"https://example.test");
    assert(!settings.url.includes("worker@example.test"));
    if(scenario==="mail_disabled")throw Object.assign(Error("disabled"),{code:"auth/operation-not-allowed"});
    if(scenario==="network_failure")throw Object.assign(Error("offline"),{code:"auth/network-request-failed"});
   },
   showSuccess:message=>messages.success.push(message),showError:message=>messages.error.push(message)
  });
  vm.runInContext(html.slice(helperStart,helperEnd)+html.slice(start,end),context);
  await controls.partnerInviteCreateButton.onclick();
  if(scenario==="sent"){
   assert.equal(messages.success.length,1);assert.match(messages.success[0],/認証メールを送信しました/);
   assert.equal(messages.error.length,0);
  }else{
   assert.deepEqual(messages.success,[]);assert.equal(messages.error.length,1);
   if(scenario==="mail_disabled"||scenario==="network_failure"){
    assert.match(messages.error[0],/認証メールは未送信/);
    assert.equal(controls.partnerInviteResult.hidden,false,"the valid link remains available for explicit resend");
    assert.equal(controls.partnerInviteResendEmailButton.disabled,false);
   }
  }
  assert.deepEqual(calls,["owner_changed","invalid_token"].includes(scenario)?["create"]:["create","mail"]);
  assert.equal(controls.partnerInviteCreateButton.disabled,false);
 }
});
