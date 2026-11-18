/**
 * Read-only partner navigation projection of PR #802's server-issued Owner
 * publication. UI presentation is never an authorization boundary. Existing
 * count/finance APIs must independently refuse unpublished data BEFORE ON.
 * This module never reads Firebase, writes records, or mutates count inputs.
 */
import {readVerifiedPartnerTabPolicy,PARTNER_OPTIONAL_TABS}
 from "./partner-tab-visibility-policy.mjs";
const MANAGEMENT=new Set(["record","invite","teams","members","catalog","account"]);
const OPTIONAL=new Set(PARTNER_OPTIONAL_TABS.map(x=>x.id));
const blocked=()=>{throw Error("PARTNER_VISIBLE_TABS_UNVERIFIED");};
function nodes(root){
 if(!root||typeof root.querySelectorAll!=="function")blocked();
 return [...root.querySelectorAll("button[data-partner-panel]")];
}
/**
 * Accept ONLY the authenticated getPartnerPublishedTabs response. Never use
 * a browser role, hubCompanyId or a company-specific visibility override.
 * A missing policy is all optional tabs OFF, not all published.
 */
export function applyPartnerTabPublicationToNavigation({
 navigation,management,details,policy,selectedPanel="record"
}={}){
 if(!details||typeof details.querySelectorAll!=="function"||
    typeof selectedPanel!=="string")blocked();
 const approved=readVerifiedPartnerTabPolicy(policy);
 const allowed=new Set(approved.tabs);
 const buttons=[...nodes(navigation),...nodes(management)];
 for(const b of buttons){
  const id=b.dataset?.partnerPanel;
  if(typeof id!=="string"||(!MANAGEMENT.has(id)&&!OPTIONAL.has(id)&&
     !["analysis","chart","products"].includes(id)))blocked();
  const visible=MANAGEMENT.has(id)||allowed.has(id);
  b.hidden=!visible;
  b.setAttribute("aria-hidden",String(!visible));
  if(!visible)b.setAttribute("aria-expanded","false");
 }
 for(const section of details.querySelectorAll("[data-partner-view]")){
  const id=section.dataset.partnerView;
  if(!MANAGEMENT.has(id)&&!allowed.has(id))section.hidden=true;
 }
 const active=MANAGEMENT.has(selectedPanel)||allowed.has(selectedPanel);
 if(!active)details.hidden=true;
 return Object.freeze({
  schema:approved.schema,revision:approved.revision,
  published:approved.published,
  visibleTabs:Object.freeze([...approved.tabs]),
  selectedPanelAllowed:active
 });
}
