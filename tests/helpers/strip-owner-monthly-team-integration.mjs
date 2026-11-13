// Reverse only the additive monthly bridge. The caller verifies the restored
// bytes against the reviewed production/tab candidate, never a regenerated UI.
export function stripOwnerMonthlyTeamIntegration(source){
 const blocks=[
  '\n<style id="nicoVerifiedPartnerTeamControls">\n#ownerPartnerDashboardDetails .owner-partner-filters[hidden],\n#ownerPartnerDashboardDetails .owner-partner-additional[hidden]{display:none!important}\n</style>\n',
  "\n// STAGING ONLY. This does not authorize a new Production API or deploy.\nconst NICO_VERIFIED_PARTNER_TEAM_CARDS_ENABLED = false;",
  "\n // The verified monthly path replaces this panel's legacy daily reader.\n if(NICO_VERIFIED_PARTNER_TEAM_CARDS_ENABLED)return refreshOwnerVerifiedPartnerTeamCards();",
  "  void refreshOwnerVerifiedPartnerTeamCards();\n",
  '\n  if(NICO_VERIFIED_PARTNER_TEAM_CARDS_ENABLED){\n    ownerVerifiedTeamState.generation++;\n    ownerVerifiedTeamState.key="";ownerVerifiedTeamState.loading=false;\n    document.getElementById("ownerPartnerDashboardList")?.replaceChildren();\n    document.getElementById("ownerPartnerDashboardSummary")?.replaceChildren();\n    document.getElementById("ownerPartnerDashboardStatus").textContent="";\n    document.getElementById("ownerPartnerDashboardDetails").hidden=true;\n  }'
 ];
 for(const block of blocks){
  if(source.split(block).length!==2)throw Error("MONTHLY_ADDITION_NOT_UNIQUE");
  source=source.replace(block,"");
 }
 const start=source.indexOf("// Draft/NO DEPLOY: never infer partner teams");
 const end=source.indexOf("function renderAllTeamsOverview(",start);
 if(start<0||end<=start)throw Error("MONTHLY_BRIDGE_MISSING");
 return source.slice(0,start)+source.slice(end);
}
