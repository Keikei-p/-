import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
function between(start,end){
 const i=html.indexOf(start),j=html.indexOf(end,i);
 assert.ok(i>=0&&j>i,"missing or disordered boundary "+start);
 return html.slice(i,j);
}

test("partner uses the same native-style management choices as internal staff",()=>{
 const original=between('id="managementMenuPanel"','id="managementWorkspace"');
 const partner=between('id="partnerManagementTabs"','id="partnerSameAppDashboardDetails"');
 for(const name of ["招待リンク","班管理","メンバー管理","商材管理"]){
  assert.ok(original.includes(name),"internal option "+name);
  assert.ok(partner.includes(name),"partner option "+name);
 }
 for(const [panel,dest] of [["invite","partnerPanelInvite"],["teams","partnerPanelTeams"],
   ["members","partnerPanelMembers"],["catalog","partnerPanelCatalog"]]){
  assert.match(partner,new RegExp('data-partner-panel="'+panel+'"[^>]*aria-controls="'+dest+'"'));
  assert.equal((html.match(new RegExp('id="'+dest+'"','g'))||[]).length,1,"unique "+dest);
 }
 assert.match(html,/\["👥","班管理","teams"\]/);
 assert.match(html,/\["👤","メンバー管理","members"\]/);
});

test("invite and member administration are separate with no finance access",()=>{
 const teams=between('id="partnerPanelTeams"','id="partnerPanelMembers"');
 const members=between('id="partnerPanelMembers"','id="partnerPanelInvite"');
 const invite=between('id="partnerPanelInvite"','id="partnerPanelCatalog"');
 for(const id of ["pInlineTeamName","pInlineAddTeam","pInlineTeams"])assert.ok(teams.includes('id="'+id+'"'));
 for(const id of ["pInlinePeople","pInlineManageTeam","pInlineMoveStaff","pInlineAddManaged"])
  assert.ok(members.includes('id="'+id+'"'));
 for(const id of ["pInlineInviteEmail","pInlineInviteRole","pInlineInviteTeam",
  "pInlineCreateInvite","pInlineResendInvite"])
  assert.ok(invite.includes('id="'+id+'"'));
 assert.ok(html.includes('id="partnerManagementTabs"'));
 assert.match(html,/if\(\["invite","catalog"\]\.includes\(name\)\&\&partnerInlineData/);
 assert.match(html,/button\.hidden=!canManage/);
 assert.match(html,/sendSignInLinkToEmail\(auth,latest\.email,partnerInviteAuthSettings\(latest\)\)/);
 const safe=between("function mountPartnerSafeManagementMenu(){","// Partner sees original dashboard-style menu");
 for(const forbidden of ["getDocs(","onSnapshot(","monthlyRevenue","revenuePerUnit","unitPrice"])
  assert.ok(!safe.includes(forbidden),"finance operation in partner menu: "+forbidden);
});

test("management panels open at selected row rather than the bottom",()=>{
 const position=between("function partnerSameAppPositionPanel(name){","function partnerSameAppSelectPanel(name){");
 for(const marker of ['partnerManagementTabs','partnerSameAppNavigation','button.offsetTop',
   'row[row.length-1]','after(detail)'])
  assert.ok(position.includes(marker),marker);
 const route=between("function partnerSameAppSelectPanel(name){","window.addEventListener(\"resize\"");
 assert.ok(route.includes('teams:"partnerPanelTeams"'));
 assert.ok(route.includes('"partnerSameAppNavigation","partnerManagementTabs"'));
 assert.ok(html.includes('pInline(nav).addEventListener("click",event=>'));
 assert.match(html,/#partnerInlineWorkspace #pInlinePeople\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});
