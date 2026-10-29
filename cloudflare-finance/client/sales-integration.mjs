/**
 * Production-adapter dependency injection for the EXISTING sales UI.
 * Both existing URLs share this logic; no browser goes straight to Firestore
 * for monetary products, records, revenue goals, or count writes.
 * This file is staged only; it must NOT be wired into index.html before the
 * backup and complete dual-host release approval.
 */
import {getSafeFinancialView,submitCountIntent,SALES_HOST_ORIGINS}
  from "./dual-host-adapter.mjs";
import {projectSafeView,buildSafeFormIntent} from "./finance-browser-contract.mjs";
import {startProtectedView} from "./protected-view-runtime.mjs";

export function makeProtectedSalesBridge({
  origin,gatewayUrl,currentUser,companyId,subscribeToSignal,
  applySnapshot,onError,explicitCutover=false,fetcher=fetch
}){
  if(!explicitCutover)throw Error("protected_sales_cutover_not_approved");
  if(!SALES_HOST_ORIGINS.includes(origin))throw Error("unauthorized_sales_host");
  if(!currentUser||typeof currentUser.getIdToken!=="function"||
     typeof companyId!=="string"||!companyId)throw Error("missing_session");
  if(typeof subscribeToSignal!=="function"||typeof applySnapshot!=="function"||
      typeof onError!=="function")throw Error("invalid_sales_bridge");
  const getData=()=>getSafeFinancialView({
    gatewayUrl,origin,user:currentUser,explicitCutover:true,fetcher});
  const stream=startProtectedView({
    subscribeToSignal:cb=>subscribeToSignal(companyId,cb,onError),
    fetchProtectedView:getData,projectView:projectSafeView,
    onView:applySnapshot,onError});
  return {
    refresh:stream.refresh,
    close:stream.stop,
    async submit({selection,inputs,products}){
      // Monetary input fields are discarded, not serialized.
      const intent=buildSafeFormIntent(selection,inputs,products);
      const result=await submitCountIntent({
        gatewayUrl,origin,user:currentUser,input:intent,
        explicitCutover:true,fetcher});
      // Do not silently infer a successful save from a timeout or 409.
      await stream.refresh();
      return result;
    }
  };
}
