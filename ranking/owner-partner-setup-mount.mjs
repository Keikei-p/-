/**
 * NO DEPLOY — combined mobile Owner setup for existing Firebase login.
 * Server-verified consent decides which controls can be mounted.
 * All writes are explicit user actions through Owner-only callables.
 * No raw Firestore, finance reads, impersonation or local data persistence.
 */
import {createRankingOwnerFirebaseBridge}
 from "./owner-ranking-consent-firebase-bridge.mjs";
import {createOwnerRankingConsentPanel}
 from "./owner-ranking-consent-panel.mjs";
import {createOwnerProductVisibilityFirebaseBridge}
 from "./owner-product-visibility-firebase-bridge.mjs";
import {createOwnerProductVisibilityPanel}
 from "./owner-product-visibility-panel.mjs";
import {createOwnerSkuMappingFirebaseBridge}
 from "./owner-reviewed-sku-mapping-firebase-bridge.mjs";
import {createOwnerReviewedSkuMappingPanel}
 from "./owner-reviewed-sku-mapping-panel.mjs";

const fail=()=>{throw Error("NICO_OWNER_PARTNER_SETUP_UNAVAILABLE");};
const el=(document,tag,text)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
};
export function mountOwnerPartnerSetup({
 document,root,auth,functions,httpsCallable,onAuthStateChanged
}={}){
 if(!document?.createElement||!root?.replaceChildren||!auth||
    !functions||typeof httpsCallable!=="function"||
    typeof onAuthStateChanged!=="function")fail();
 let closed=false,generation=0,views=[],partnerViews=[],partnerGeneration=0;
 let unsubscribe=()=>{};
 const clearViews=items=>{
  for(const panel of items.splice(0))panel.destroy();
 };
 const reset=()=>{
  generation++;partnerGeneration++;
  clearViews(partnerViews);clearViews(views);root.replaceChildren();
 };
 const message=label=>{
  const item=el(document,"p",label);
  item.setAttribute?.("role","status");
  root.appendChild(item);
 };
 const render=async(user,token)=>{
  const consentBridge=createRankingOwnerFirebaseBridge({
   auth,functions,httpsCallable,sharedCodeSession:()=>false
  });
  let status;
  try{status=await consentBridge.loadStatus();}
  catch{
   if(!closed&&generation===token&&auth.currentUser===user)
    message("公開設定を読み込めません。管理者ログインとサーバー公開状態を確認してください。");
   return false;
  }
  if(closed||generation!==token||auth.currentUser!==user)return false;
  const heading=el(document,"h1","協力店・ランキング一括管理");
  const intro=el(document,"p","自社と協力店の件数を連携するための設定です。売上・単価・キャッシュバックは協力店に公開しません。");
  root.appendChild(heading);root.appendChild(intro);
  const consentBox=el(document,"section");
  root.appendChild(consentBox);
  const consentPanel=createOwnerRankingConsentPanel({
   document,root:consentBox,
   loadStatus:()=>consentBridge.loadStatus(),
   saveConsent:input=>consentBridge.saveConsent(input)
  });
  views.push(consentPanel);
  await consentPanel.refresh();
  if(closed||generation!==token||auth.currentUser!==user)return false;
  // A partner Owner can approve their own ranking but never sees hub SKU tools.
  if(status.role!=="hub_owner")return true;
  const visibilityBridge=createOwnerProductVisibilityFirebaseBridge({
   auth,functions,httpsCallable
  });
  const skuBridge=createOwnerSkuMappingFirebaseBridge({
   auth,functions,httpsCallable
  });
  const globalBox=el(document,"section");
  root.appendChild(globalBox);
  const globalPanel=createOwnerProductVisibilityPanel({
   document,root:globalBox,auth,
   load:args=>visibilityBridge.load(args),
   save:args=>visibilityBridge.save(args)
  });
  views.push(globalPanel);
  await globalPanel.refresh();
  if(closed||generation!==token||auth.currentUser!==user)return false;
  const partnerHeading=el(document,"h2","協力店別の商材・対応表");
  root.appendChild(partnerHeading);
  const select=el(document,"select");
  select.setAttribute?.("aria-label","設定する協力店");
  const partnerBox=el(document,"section");
  const mapBox=el(document,"section");
  if(!status.partners.length){
   message("承認済み協力店がありません。既存の協力店管理から招待・承認してください。");
   return true;
  }
  for(const partner of status.partners){
   const option=el(document,"option",partner.companyName);
   option.value=partner.partnerCompanyId;
   select.appendChild(option);
  }
  select.value=status.partners[0].partnerCompanyId;
  root.appendChild(select);root.appendChild(partnerBox);
  root.appendChild(mapBox);
  const loadPartner=async companyId=>{
   if(!status.partners.some(x=>x.partnerCompanyId===companyId))return false;
   const scope=++partnerGeneration;
   clearViews(partnerViews);
   partnerBox.replaceChildren();mapBox.replaceChildren();
   if(closed||generation!==token||auth.currentUser!==user)return false;
   const switchPanel=createOwnerProductVisibilityPanel({
    document,root:partnerBox,auth,partnerCompanyId:companyId,
    load:args=>visibilityBridge.load(args),
    save:args=>visibilityBridge.save(args)
   });
   const mappingPanel=createOwnerReviewedSkuMappingPanel({
    enabled:true,document,root:mapBox,auth,partnerCompanyId:companyId,
    readMappings:args=>skuBridge.readMappings(args),
    readProducts:args=>skuBridge.readProducts(args),
    saveMapping:args=>skuBridge.saveMapping(args)
   });
   partnerViews.push(switchPanel,mappingPanel);
   await Promise.all([switchPanel.refresh(),mappingPanel.refresh()]);
   return !closed&&generation===token&&
    partnerGeneration===scope&&auth.currentUser===user;
  };
  select.addEventListener("change",()=>{void loadPartner(select.value);});
  await loadPartner(select.value);
  return true;
 };
 const refresh=async()=>{
  if(closed)return false;
  reset();
  const user=auth.currentUser;
  if(!user||user.emailVerified!==true){
   message("本人確認済みのメールアカウントでログインしてください。");
   return false;
  }
  return render(user,generation);
 };
 try{
  const remove=onAuthStateChanged(auth,()=>{void refresh();});
  if(typeof remove!=="function")fail();
  unsubscribe=remove;
 }catch(e){closed=true;reset();throw e;}
 return Object.freeze({
  refresh,
  destroy(){
   if(closed)return;
   closed=true;unsubscribe();reset();
  }
 });
}
