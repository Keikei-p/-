"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const html=fs.readFileSync(require("node:path").join(__dirname,"../index.html"),"utf8");
test("Owner invite tab offers existing partner companies without replacing new-company invitation",()=>{
  for(const id of ["inviteDestinationSelect","partnerInviteModeSelect","partnerInviteCompanyName",
    "partnerExistingCompanySelect","partnerExistingTeamSelect","partnerExistingRoleSelect",
    "partnerExistingEmailInput","partnerExistingInviteButton","partnerExistingInviteUrl",
    "partnerExistingNewTeamName","partnerExistingAddTeamButton"]){
    assert.match(html,new RegExp('id="'+id+'"'),id);
  }
  assert.match(html,/value="existing">以前登録した協力店/);
  assert.match(html,/createPartnerCompanyInvitation/);
  assert.match(html,/readPartnerWorkDay\(\{date\}\)/);
  assert.match(html,/managePartnerWorkspaceForInvite\(\{action:"hubAddTeam"/);
  assert.match(html,/action:"hubCreateInvite"/);
  assert.match(html,/new URL\("\/partner-workspace\.html",location\.origin\)/);
});
test("Existing company must be approved and current login must be hub Owner",()=>{
  assert.match(html,/function partnerExistingOwner\(\)/);
  assert.match(html,/currentCompanyData\.ownerUid===currentUser\.uid/);
  assert.match(html,/companyKind!=="partner"/);
  assert.match(html,/currentUserData\?\.accessKind!=="partner"/);
  assert.match(html,/if\(!company\?\.active\|\|!company\.teams\?\.some/);
  assert.match(html,/!ready\?company\.name\+"：スタッフ招待の承認待ち/);
});
test("Existing company invitation reuses server-managed partner workspace and never exposes sales write endpoints",()=>{
  const start=html.indexOf("let partnerExistingCompanies=[];");
  const end=html.indexOf('document.getElementById("inviteDestinationSelect").addEventListener(',start);
  assert.ok(start>=0&&end>start);
  const snippet=html.slice(start,end);
  assert.doesNotMatch(snippet,/setDoc\(|deleteDoc\(|updateDoc\(|addDoc\(/);
  assert.doesNotMatch(snippet,/\bproducts\b|\brecords\b|\brevenueGoals\b|canViewRevenue\s*:\s*true/);
  assert.match(snippet,/partnerExistingLoadSerial/);
  assert.match(snippet,/partnerExistingCompanies\.find/);
  assert.match(snippet,/new Intl\.DateTimeFormat\("en-CA",\{timeZone:"Asia\/Tokyo"/);
});
