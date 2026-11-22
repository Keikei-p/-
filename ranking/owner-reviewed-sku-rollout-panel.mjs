/**
 * STAGING / NO DEPLOY. Optional Owner-only multi-partner SKU-copy preview
 * inside the EXISTING "協力店商材" tab. No new app, no finance SDK, no
 * automatic permission escalation or data migration.
 */
import {createOwnerSkuMappingFirebaseBridge}
 from "./owner-reviewed-sku-mapping-firebase-bridge.mjs";
import {planOwnerReviewedSkuRollout,applyOwnerReviewedSkuRollout}
 from "./owner-reviewed-sku-rollout.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const good=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const stop=()=>{throw Error("OWNER_SKU_ROLLOUT_PANEL_UNVERIFIED");};
export function mountOwnerSkuRolloutPanel({
 enabled=false,document,root,auth,functions,httpsCallable,
 onAuthStateChanged,sourceCompanyId,targetCompanyIds,confirmRollout
}={}){
 if(enabled!==true||!document?.createElement||!root?.replaceChildren||
    !auth||!functions||typeof httpsCallable!=="function"||
    typeof onAuthStateChanged!=="function"||
    typeof confirmRollout!=="function"||!good(sourceCompanyId)||
    !Array.isArray(targetCompanyIds)||targetCompanyIds.length>30||
    targetCompanyIds.some(x=>!good(x)||x===sourceCompanyId)||
    new Set(targetCompanyIds).size!==targetCompanyIds.length)stop();
 const bridge=createOwnerSkuMappingFirebaseBridge({auth,functions,httpsCallable});
 let generation=0,closed=false,busy=false;
 let identity=auth.currentUser,unsubscribe=()=>{},last=null;
 const el=(tag,label)=>{
  const x=document.createElement(tag);
  if(label!==undefined)x.textContent=label;
  return x;
 };
 const clear=()=>{
  last=null;generation++;root.replaceChildren();
 };
 const visible=(user,seq)=>!closed&&generation===seq&&
  auth.currentUser===user&&user?.emailVerified===true;
 async function refresh(){
  if(closed||busy)return false;
  clear();
  const seq=generation,user=auth.currentUser;
  if(!user?.emailVerified||typeof user.getIdToken!=="function")return false;
  const status=el("p","商材の対応付けを確認中…");
  status.setAttribute?.("role","status");
  root.appendChild(status);
  try{
   const token=await user.getIdToken();
   if(!visible(user,seq)||typeof token!=="string"||token.length<20)return false;
   const [mapping,catalog]=await Promise.all([
    bridge.readMappings({token}),bridge.readProducts({token})
   ]);
   if(!visible(user,seq))return false;
   const plan=planOwnerReviewedSkuRollout({
    mapping,catalog,sourceCompanyId,targetCompanyIds
   });
   last=plan;
   const box=el("section");
   box.className="nico-owner-sku-rollout";
   box.appendChild(el("h3","他の協力店へ承認済み商材の対応をまとめて反映"));
   box.appendChild(el("p","9種類の共通商材のみ対象。協力店専用商材・件数・原票・売上は変更しません。"));
   box.appendChild(el("p","対象："+targetCompanyIds.length+"社／新規対応："+plan.totalApply+
    "件／既存保持："+plan.totalExisting+"件／競合保留："+plan.totalConflicts+
    "件／公開OFF保留："+plan.totalOff+"件"));
   if(plan.totalApply){
    const button=el("button","確認して"+plan.totalApply+"件の商材対応を保存");
    button.type="button";button.className="team-action-button";
    button.addEventListener("click",async()=>{
     if(busy||!visible(user,seq)||last!==plan)return;
     // This is the ONLY code path that can perform a write. Browser prompts
     // are informational; backend Owner and version checks are mandatory.
     if(confirmRollout("他の協力店"+targetCompanyIds.length+"社へ、未設定の商材対応"+
       plan.totalApply+"件をコピーします。既存対応・過去件数は変更しません。続けますか？")!==true)return;
     busy=true;button.disabled=true;
     const result=await applyOwnerReviewedSkuRollout({
      confirmed:true,plan,auth,readMappings:bridge.readMappings,
      readProducts:bridge.readProducts,saveMapping:bridge.saveMapping,
      canContinue:()=>!closed&&visible(user,seq)
     });
     busy=false;
     if(!visible(user,seq))return;
     const refreshed=await refresh();
     if(!visible(user,generation))return;
     const notice=el("p",result.status==="verified"&&
      result.verified===result.planned&&refreshed?
      "保存後の再確認が完了しました（"+result.verified+"件）。":
      "対応付けは途中停止しました。確認済み"+result.verified+
      "件。最新の状態を確認し、残りは再確認してください。");
     notice.setAttribute?.("role","status");root.appendChild(notice);
    });
    box.appendChild(button);
   }else{
    box.appendChild(el("p","コピーできる未設定の商材対応はありません。先に選択会社で商材対応を確認してください。"));
   }
   status.textContent="";
   root.replaceChildren(box);
   return true;
  }catch{
   if(visible(user,seq)){
    last=null;
    status.textContent="商材の対応表を取得できません。Owner権限・設定を確認してください。";
   }
   return false;
  }
 }
 try{
  const off=onAuthStateChanged(auth,user=>{
   if(closed)return;
   if(user===identity&&user?.emailVerified===true)return;
   identity=user;bridge.onAuthChange();clear();
  });
  if(typeof off!=="function")stop();
  unsubscribe=off;
 }catch(err){
  closed=true;clear();throw err;
 }
 return Object.freeze({
  refresh,
  destroy(){if(closed)return;closed=true;unsubscribe();bridge.onAuthChange();clear();},
  getPlan:()=>last
 });
}
