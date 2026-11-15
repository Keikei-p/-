import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from 'node:vm';
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const pick=id=>(html.match(new RegExp('id="'+id+'"',"g"))||[]).length;
test("every invite button and feedback surface appears once inside the canonical same-app screen",()=>{
 for(const id of ["partnerInviteSendEmailButton","partnerInviteResendEmailButton",
  "partnerInviteEmailStatus","pMainChangeInviteAccount","pMainInviteStatus"]){
  assert.equal(pick(id),1,id);
 }
 assert.match(html,/await sendSignInLinkToEmail\(auth,latest\.email,partnerInviteAuthSettings\(latest\)\)/);
 assert.match(html,/document\.getElementById\("partnerInviteResendEmailButton"\)\.onclick=composePartnerInvitationEmail/);
 assert.match(html,/document\.getElementById\("partnerInviteSendEmailButton"\)\.onclick=composePartnerInvitationEmail/);
});
test("resend never silently claims delivery, uses current role email and team, refreshes only after expiry",()=>{
 assert.match(html,/Date\.now\(\)>=invite\.expiresAt/);
 assert.match(html,/action:"hubCreateInvite",\s*partnerCompanyId:invite\.partnerCompanyId,teamId:invite\.teamId/);
 assert.match(html,/email:invite\.email,role:invite\.role/);
 assert.match(html,/await sendSignInLinkToEmail\(auth,latest\.email,partnerInviteAuthSettings\(latest\)\)/);
 assert.match(html,/return false;/);
 assert.doesNotMatch(html,/招待メールを自動送信しました/);
});

test('existing Firebase resend awaits delivery, refreshes only expired links and keeps failures retryable',async()=>{
 const start=html.indexOf('function partnerInviteAuthSettings(');
 const end=html.indexOf('document.getElementById("partnerInviteSendEmailButton").onclick=',start);
 assert(start>0&&end>start);
 for(const scenario of ['sent','expired','disabled']){
  const controls=Object.fromEntries(['partnerInviteSendEmailButton','partnerInviteResendEmailButton',
   'partnerInviteEmailStatus','partnerInviteLinkOutput'].map(x=>[x,{}]));
  const calls=[],now=1000000;
  const invite={url:'https://nico-factory.web.app/?partnerStaffInvite='+'A'.repeat(43),
   email:'target@example.test',partnerCompanyId:'partner',teamId:'team',role:'leader',
   expiresAt:scenario==='expired'?now-1:now+10000};
  const context={URL,Date:{now:()=>now},location:{origin:'https://nico-factory.web.app'},auth:{},
   currentUser:{uid:'owner',emailVerified:true},currentCompanyData:{ownerUid:'owner'},
   directPartnerLastInvitation:invite,document:{getElementById:id=>controls[id]},console:{error(){}},
   partnerInlineManage:async payload=>{calls.push('refresh');
    assert.equal(payload.email,invite.email);assert.equal(payload.teamId,invite.teamId);
    assert.equal(payload.partnerCompanyId,invite.partnerCompanyId);assert.equal(payload.role,invite.role);
    return {data:{token:'B'.repeat(43),expiresAt:now+10000}};},
   sendSignInLinkToEmail:async(_,email,settings)=>{calls.push('mail');assert.equal(email,invite.email);
    assert.equal(new URL(settings.url).origin,'https://nico-factory.web.app');
    assert(!settings.url.includes(email));
    if(scenario==='disabled')throw Object.assign(Error('disabled'),{code:'auth/operation-not-allowed'});}
  };
  runInNewContext(html.slice(start,end),context);
  assert.equal(await context.composePartnerInvitationEmail(),scenario!=='disabled');
  assert.deepEqual(calls,scenario==='expired'?['refresh','mail']:['mail']);
  assert.equal(controls.partnerInviteResendEmailButton.disabled,false);
  if(scenario==='disabled')assert.match(controls.partnerInviteEmailStatus.textContent,/送信されていません/);
  else assert.match(controls.partnerInviteEmailStatus.textContent,/送信しました/);
 }
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
