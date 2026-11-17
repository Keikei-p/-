/**
 * NO DEPLOY — combined mobile Owner setup for existing Firebase login.
 * Existing server-verified company relations determine which Owner SKU controls mount.
 * All writes are explicit user actions through Owner-only callables.
 * No raw Firestore, finance reads, impersonation or local data persistence.
 */
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
  // Use the EXISTING count-only hub workspace to discover partner companies.
  // Neither the client nor a bilateral ranking-consent form selects companies.
  const workspace=httpsCallable(functions,"getPartnerWorkspace");
  let status;
  try{
   const date=new Intl.DateTimeFormat("sv-SE",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
   }).format(new Date());
   // Read the registered partner companies even while general partner
   // workspace and count publication are disabled. The server restricts this
   // request to an authenticated internal Owner and returns company IDs only.
   const answer=(await workspace({date,ownerSetupCompaniesOnly:true})).data;
   if(!answer||!["hub","owner","leader","member"].includes(answer.role))fail();
   if(answer.role==="hub"){
    if(!Array.isArray(answer.registeredCompanies)||
       answer.registeredCompanies.length>100)fail();
    const seen=new Set(),partners=[];
    for(const company of answer.registeredCompanies){
     if(typeof company.partnerCompanyId!=="string"||
        !/^[A-Za-z0-9_-]{1,128}$/.test(company.partnerCompanyId)||
        seen.has(company.partnerCompanyId)||
        typeof company.name!=="string"||company.name.trim().length<1||
        company.name.length>80||/[\r\n\t]|(?:売上|単価|キャッシュバック|[¥￥$€])/i.test(company.name)||
        typeof company.active!=="boolean")fail();
     seen.add(company.partnerCompanyId);
     if(company.active)partners.push({
      partnerCompanyId:company.partnerCompanyId,
      companyName:company.name.trim()
     });
    }
    status={role:"hub_owner",partners};
   }else status={role:"partner_user",partners:[]};
  }catch{
   if(!closed&&generation===token&&auth.currentUser===user)
    message("協力店の連携状況を確認できません。自社Ownerでログインしてください。");
   return false;
  }
  if(closed||generation!==token||auth.currentUser!==user)return false;
  const heading=el(document,"h1","協力店・ランキング一括管理");
  const intro=el(document,"p","自社Ownerが公開ONにした商材の件数を協力店と連携します。追加の双方Owner承認は不要。既存の会社連携・ログイン検証は必須です。金額は表示しません。");
  root.appendChild(heading);root.appendChild(intro);
  // Partner Owners never receive the hub's SKU/publication settings.
  if(status.role!=="hub_owner"){
   message("商材ON/OFFと合同件数の設定は自社Ownerが行います。");
   return true;
  }
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
   message("件数連携が有効な協力店がありません。自社の協力店管理を確認してください。");
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
