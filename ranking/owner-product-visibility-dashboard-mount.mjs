/**
 * STAGING / NO DEPLOY. Mount the real Firebase Auth + Functions SDK adapter
 * inside the existing internal dashboard's owner-only container.
 *
 * The host supplies its already-initialized Firebase SDK objects. This module
 * never queries Firestore, touches existing finance screens, or trusts a
 * browser role/company flag. Server callables enforce current owner rights.
 * The production index.html is intentionally NOT modified by this change.
 */
import {createOwnerProductVisibilityFirebaseBridge}
 from "./owner-product-visibility-firebase-bridge.mjs";
import {createOwnerProductVisibilityPanel}
 from "./owner-product-visibility-panel.mjs";

const stop=()=>{throw Error("OWNER_PRODUCT_DASHBOARD_MOUNT_NOT_READY");};

/**
 * Intended future host integration (after release approval):
 * mountOwnerProductVisibilityDashboard({
 *   featureEnabled:true,document,root:ownerProductPublicationContainer,
 *   auth,functions:partnerCountFunctions,httpsCallable,onAuthStateChanged
 * });
 *
 * The host MUST only mount inside the existing internal owner settings view.
 * Feature OFF is the default; no production callable is currently deployed.
 */
export function mountOwnerProductVisibilityDashboard({
 featureEnabled=false,document,root,auth,functions,httpsCallable,
 onAuthStateChanged
}={}){
 if(featureEnabled!==true||!document?.createElement||
    !root?.replaceChildren||!auth||!functions||
    typeof httpsCallable!=="function"||
    typeof onAuthStateChanged!=="function")stop();
 const bridge=createOwnerProductVisibilityFirebaseBridge({
  auth,functions,httpsCallable
 });
 const panel=createOwnerProductVisibilityPanel({
  document,root,auth,
  load:args=>bridge.load(args),
  save:args=>bridge.save(args)
 });
 let destroyed=false,unsubscribe=()=>{};
 const reset=()=>{
  bridge.onAuthChange();
  panel.onAuthChange();
 };
 const refresh=async()=>{
  if(destroyed)return false;
  if(!auth.currentUser||auth.currentUser.emailVerified!==true){
   reset();return false;
  }
  return panel.refresh();
 };
 try{
  const off=onAuthStateChanged(auth,user=>{
   if(destroyed)return false;
   reset();
   if(!user||user.emailVerified!==true||
      auth.currentUser!==user)return false;
   // Auth change invalidates any in-flight response; the panel rechecks the
   // same Firebase user object before rendering a confirmed server result.
   return panel.refresh();
  });
  if(typeof off!=="function")stop();
  unsubscribe=off;
 }catch(error){
  destroyed=true;panel.destroy();
  throw error;
 }
 return Object.freeze({
  refresh,
  getVersion:()=>destroyed?null:panel.getVersion(),
  destroy(){
   if(destroyed)return;
   destroyed=true;
   unsubscribe();
   reset();
   panel.destroy();
  }
 });
}
