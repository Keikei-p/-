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
import {createOwnerReviewedSkuMappingPanel,suggestUnambiguousOwnerSkuMappings}
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
  }catch(error){
   if(!closed&&generation===token&&auth.currentUser===user){
    // The new Owner setup route deliberately denies partner accounts. This
    // is expected authorization behavior, not a partner count/login outage.
    const denied=["permission-denied","functions/permission-denied"]
     .includes(error?.code);
    message(denied?
     "商材ON/OFFと合同件数の設定は自社Owner専用です。協力店側での追加承認は不要です。":
     "協力店の連携状況を確認できません。自社Ownerでログインしてください。");
   }
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
   save:async args=>{
    const result=await visibilityBridge.save(args);
    // Both panels share one server revision. Refresh the selected partner
    // after a confirmed global write, or its switches stay stale/disabled.
    if(result?.saved===true&&!closed&&generation===token&&
       auth.currentUser===user){
     const activePartner=partnerViews[0];
     if(activePartner)await activePartner.refresh();
    }
    return result;
   }
  });
  views.push(globalPanel);
  await globalPanel.refresh();
  if(closed||generation!==token||auth.currentUser!==user)return false;
  const allCompanyBatchBox=el(document,"section");
  root.appendChild(allCompanyBatchBox);
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
    save:async args=>{
     const result=await visibilityBridge.save(args);
     // A partner override also increments the same global visibility version.
     if(result?.saved===true&&!closed&&generation===token&&
        partnerGeneration===scope&&auth.currentUser===user)
      await globalPanel.refresh();
     return result;
    }
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
  if(closed||generation!==token||auth.currentUser!==user)return false;
  // All active partners come from the authenticated, server-verified owner
  // workspace. Preview uses only approved public count-only product labels.
  // No implicit read of original products/records, no automatic save.
  let initialMapping,initialProducts,plan;
  try{
   const actorToken=await user.getIdToken();
   if(closed||generation!==token||auth.currentUser!==user)return false;
   [initialMapping,initialProducts]=await Promise.all([
    skuBridge.readMappings({token:actorToken}),
    skuBridge.readProducts({token:actorToken})
   ]);
   if(closed||generation!==token||auth.currentUser!==user)return false;
   plan=[];
   for(const partner of status.partners){
    const suggestions=suggestUnambiguousOwnerSkuMappings({
     mapping:initialMapping,catalog:initialProducts,
     partnerCompanyId:partner.partnerCompanyId
    });
    for(const proposal of suggestions)plan.push({
     ...proposal,partnerCompanyId:partner.partnerCompanyId,
     companyName:partner.companyName
    });
   }
   if(!Number.isSafeInteger(initialMapping.version)||plan.length>60)fail();
  }catch{
   if(!closed&&generation===token&&auth.currentUser===user)
    allCompanyBatchBox.appendChild(el(document,"p",
     "全社の対応候補を読み込めません。会社ごとの設定は引き続き利用できます。"));
   return true;
  }
  if(plan.length){
   allCompanyBatchBox.appendChild(el(document,"h2",
    "登録済み協力店の一致商材をまとめて連携"));
   allCompanyBatchBox.appendChild(el(document,"p",
    "各社のON商材から名称が確実に一致する未設定分だけを表示します。内容を確認するまで保存しません。"));
   for(const p of plan){
    const entry=el(document,"p",p.companyName+"："+
     p.partnerLabel+" → "+p.hubProductLabel);
    allCompanyBatchBox.appendChild(entry);
   }
   const run=el(document,"button",
    "上記"+plan.length+"件を全社まとめて保存");
   run.type="button";
   run.setAttribute?.("aria-label","全社の一致商材を確認して保存");
   let busy=false;
   run.addEventListener("click",async()=>{
    if(busy||closed||generation!==token||auth.currentUser!==user)return;
    busy=true;run.disabled=true;
    let saved=0,failed=false,expected=initialMapping.version;
    try{
     for(const item of plan){
      if(closed||generation!==token||auth.currentUser!==user)fail();
      const freshToken=await user.getIdToken();
      if(closed||generation!==token||auth.currentUser!==user)fail();
      const [mapping,products]=await Promise.all([
       skuBridge.readMappings({token:freshToken}),
       skuBridge.readProducts({token:freshToken})
      ]);
      // Stop if someone changed any public ON/OFF setting or saved another
      // mapping since this exact preview. Never overwrite another revision.
      if(mapping.version!==expected||
         products.version!==initialProducts.version)fail();
      const stillProposed=suggestUnambiguousOwnerSkuMappings({
       mapping,catalog:products,
       partnerCompanyId:item.partnerCompanyId
      }).some(p=>p.partnerProductId===item.partnerProductId&&
       p.hubProductId===item.hubProductId);
      if(!stillProposed)fail();
      const confirmed=await skuBridge.saveMapping({
       token:freshToken,
       partnerCompanyId:item.partnerCompanyId,
       partnerProductId:item.partnerProductId,
       hubProductId:item.hubProductId,expectedVersion:expected
      });
      if(!confirmed||confirmed.saved!==true||
         confirmed.version!==expected+1||
         confirmed.partnerCompanyId!==item.partnerCompanyId||
         confirmed.partnerProductId!==item.partnerProductId||
         confirmed.hubProductId!==item.hubProductId)fail();
      const verified=await skuBridge.readMappings({token:freshToken});
      if(verified.version!==confirmed.version||
         !Array.isArray(verified.bindings)||
         !verified.bindings.some(b=>b.companyId===item.partnerCompanyId&&
          b.productId===item.partnerProductId&&
          b.hubProductId===item.hubProductId))fail();
      expected=confirmed.version;saved++;
     }
    }catch{failed=true;}
    finally{
     busy=false;
     if(!closed&&generation===token&&auth.currentUser===user){
      const updated=await refresh();
      if(updated&&!closed&&auth.currentUser===user)
       message(failed?
        "全社一括連携を停止しました。保存確認済み"+saved+
         "件。残りは現在の設定を確認してください。":
        "全社の商材対応"+saved+"件を保存・再確認しました。");
     }
    }
   });
   allCompanyBatchBox.appendChild(run);
  }else allCompanyBatchBox.appendChild(el(document,"p",
   "全社一括連携の未設定候補はありません。必要なら会社別の商材対応を選んでください。"));
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
