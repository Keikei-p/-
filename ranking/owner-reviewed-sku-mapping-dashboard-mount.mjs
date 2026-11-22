/**
 * Draft integration only. Mounts the EXISTING Owner-reviewed SKU mapping panel
 * inside the existing Owner "協力店商材" workspace. No new page, no direct
 * Firestore access, no pricing data and no automatic mapping writes.
 * Caller must additionally confirm the current Owner scope and company
 * selection. Callables re-verify every Owner action on the server.
 */
import {createOwnerSkuMappingFirebaseBridge}
 from "./owner-reviewed-sku-mapping-firebase-bridge.mjs";
import {createOwnerReviewedSkuMappingPanel}
 from "./owner-reviewed-sku-mapping-panel.mjs";

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const stop=()=>{throw Error("OWNER_SKU_DASHBOARD_MOUNT_NOT_READY");};
const safeId=id=>typeof id==="string"&&ID.test(id)&&
 !["__proto__","prototype","constructor"].includes(id);

export function mountOwnerReviewedSkuMappingDashboard({
 featureEnabled=false,document,root,auth,functions,httpsCallable,
 onAuthStateChanged,partnerCompanyId
}={}){
 if(featureEnabled!==true||!safeId(partnerCompanyId)||
    !document?.createElement||!root?.replaceChildren||!auth||!functions||
    typeof httpsCallable!=="function"||
    typeof onAuthStateChanged!=="function")stop();
 const bridge=createOwnerSkuMappingFirebaseBridge({
  auth,functions,httpsCallable
 });
 const panel=createOwnerReviewedSkuMappingPanel({
  enabled:true,document,root,auth,partnerCompanyId,
  readMappings:args=>bridge.readMappings(args),
  readProducts:args=>bridge.readProducts(args),
  saveMapping:args=>bridge.saveMapping(args)
 });
 let destroyed=false,unsubscribe=()=>{};
 const reset=()=>{bridge.onAuthChange();panel.onAuthChange();};
 try{
  const off=onAuthStateChanged(auth,user=>{
   if(destroyed)return;
   reset();
   // Invalidate only. The existing Owner workspace explicitly requests
   // refresh on open, avoiding two racing requests from Firebase's immediate
   // auth callback and the Owner's click. Never auto-write or auto-fetch.
   if(!user||user.emailVerified!==true||auth.currentUser!==user)return;
  });
  if(typeof off!=="function")stop();
  unsubscribe=off;
 }catch(error){
  destroyed=true;reset();panel.destroy();throw error;
 }
 return Object.freeze({
  refresh:()=>destroyed?Promise.resolve(false):panel.refresh(),
  getVersion:()=>destroyed?null:panel.getVersion(),
  destroy(){
   if(destroyed)return;
   destroyed=true;unsubscribe();reset();panel.destroy();
  }
 });
}
