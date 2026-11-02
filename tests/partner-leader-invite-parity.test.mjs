import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const slice=(a,b)=>{
 const i=html.indexOf(a),j=html.indexOf(b,i+a.length);
 assert(i>=0&&j>i,"missing code boundary: "+a);
 return html.slice(i,j);
};
const inviteHtml=slice('<section id="partnerPanelInvite"','<section id="partnerPanelCatalog"');
const inviteScript=slice('let partnerLeaderLastInvitation=null;','pInline("pInlineAddPrivateProduct").onclick=');

test("partner leader invite is in the original app menu with owner-style stacked, labelled controls",()=>{
 assert.match(html,/\["✉️","招待リンク","invite"\]/);
 assert.match(html,/id="companyInviteControls"/);
 for(const id of ["pInlineInviteEmail","pInlineInviteRole","pInlineInviteTeam",
  "pInlineCreateInvite","pInlineResendInvite","pInlineCopyInvite",
  "pInlineInviteUrl","pInlineInviteRecipient","pInlineInviteEmailStatus","pInlineInviteFormStatus"]){
  assert.equal((inviteHtml.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
 }
 assert(inviteHtml.indexOf('id="pInlineInviteEmail"') <
        inviteHtml.indexOf('id="pInlineInviteRole"'));
 assert(inviteHtml.indexOf('id="pInlineInviteRole"') <
        inviteHtml.indexOf('id="pInlineInviteTeam"'));
 assert.match(html,/#partnerInlineWorkspace #partnerPanelInvite \.partner-invite-form\{display:block/);
 assert.match(html,/#partnerInlineWorkspace #partnerPanelInvite \.form-group input/);
 assert.match(inviteHtml,/role="status" aria-live="polite"/);
 assert.match(inviteHtml,/30分/);
});
function fixture({expired=false,sendError=false,verified=true,role="leader"}={}){
 const oldToken="a".repeat(43),newToken="b".repeat(43);
 const elements=new Map();
 const pInline=id=>{
  if(!elements.has(id))elements.set(id,{hidden:true,value:"",textContent:"",
   style:{},disabled:false,onclick:null});
  return elements.get(id);
 };
 let sent=[],writes=0;
 const auth={currentUser:{uid:"leader-1",emailVerified:verified}};
 const context={pInline,auth,partnerInlineData:{role},
  partnerInlineWorkspaceCompany:"company-A",partnerInlineBusy:false,
  location:{origin:"https://nico-factory.web.app"},URL,console,
  partnerInviteAuthSettings:invite=>({url:invite.url,handleCodeInApp:true}),
  partnerInlinePayload:x=>x,
  partnerInlineManage:async x=>{
   writes++;assert.equal(x.action,"createInvite");
   assert.equal(x.role,"leader");
   assert.equal(x.teamId,"team-A");
   return {data:{token:newToken,expiresAt:Date.now()+1800000}};
  },
  sendSignInLinkToEmail:async (_auth,email,settings)=>{
   sent.push({email,url:settings.url});
   if(sendError){const e=Error("auth off");e.code="auth/operation-not-allowed";throw e;}
  }};
 runInNewContext(inviteScript,context);
 const invite={uid:"leader-1",workspaceCompanyId:"company-A",
  email:"person@example.com",teamId:"team-A",role:"leader",
  url:"https://nico-factory.web.app/?partnerStaffInvite="+oldToken,
  expiresAt:Date.now()+(expired?-1000:1800000)};
 return {context,pInline,invite,sent,get writes(){return writes},oldToken,newToken};
}
test("verified leader sends original invitation and reports delivery without revenue permissions",async()=>{
 const f=fixture();
 assert.equal(await f.context.partnerLeaderSendInviteEmail(f.invite),true);
 assert.equal(f.writes,0);
 assert.equal(f.sent.length,1);
 assert.match(f.sent[0].url,new RegExp(f.oldToken));
 assert.match(f.pInline("pInlineInviteEmailStatus").textContent,/送信しました/);
});
test("resend of expired invitation generates a new server-authorized token",async()=>{
 const f=fixture({expired:true});
 assert.equal(await f.context.partnerLeaderSendInviteEmail(f.invite),true);
 assert.equal(f.writes,1);
 assert.equal(f.sent.length,1);
 assert.match(f.sent[0].url,new RegExp(f.newToken));
 assert.doesNotMatch(f.sent[0].url,new RegExp(f.oldToken));
 assert.equal(f.pInline("pInlineInviteResult").hidden,false);
});
test("email-link failure never claims the invite email was delivered",async()=>{
 const f=fixture({sendError:true});
 assert.equal(await f.context.partnerLeaderSendInviteEmail(f.invite),false);
 assert.equal(f.sent.length,1);
 assert.match(f.pInline("pInlineInviteEmailStatus").textContent,/送信されていません/);
 assert.equal(f.pInline("pInlineInviteEmailStatus").style.color,"#b91c1c");
});
test("unverified actor or member cannot send partner invitation",async()=>{
 for(const args of [{verified:false},{role:"member"}]){
  const f=fixture(args);
  await assert.rejects(f.context.partnerLeaderSendInviteEmail(f.invite),/context_changed/);
  assert.equal(f.sent.length,0);
  assert.equal(f.writes,0);
 }
});

test("invalid invite email and missing team get immediate specific feedback without server writes",async()=>{
 const f=fixture();
 f.context.partnerInlineRun=async work=>{try{await work();}catch{}};
 const click=f.pInline("pInlineCreateInvite").onclick;
 assert.equal(typeof click,"function");
 f.pInline("pInlineInviteEmail").value="invalid";
 f.pInline("pInlineInviteRole").value="member";
 f.pInline("pInlineInviteTeam").value="team-A";
 await click();
 assert.match(f.pInline("pInlineInviteFormStatus").textContent,/メールアドレスを正しく入力/);
 assert.equal(f.writes,0,"invalid email cannot create a backend invitation");
 f.pInline("pInlineInviteEmail").value="member@example.com";
 f.pInline("pInlineInviteTeam").value="";
 await click();
 assert.match(f.pInline("pInlineInviteFormStatus").textContent,/所属する班を選択/);
 assert.equal(f.writes,0,"missing team cannot create a backend invitation");
});
test("unauthorized invite role is explained before attempting a privileged server call",async()=>{
 const f=fixture({role:"member"});
 f.context.partnerInlineRun=async work=>{try{await work();}catch{}};
 f.pInline("pInlineInviteEmail").value="member@example.com";
 f.pInline("pInlineInviteRole").value="member";
 f.pInline("pInlineInviteTeam").value="team-A";
 await f.pInline("pInlineCreateInvite").onclick();
 assert.match(f.pInline("pInlineInviteFormStatus").textContent,/リーダー・管理者のみ/);
 assert.equal(f.writes,0);
});
