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
  origin,gatewayUrl,currentUser,companyId,getMonth,subscribeToSignal,
  applySnapshot,onError,explicitCutover=false,fetcher=fetch
}){
  if(!explicitCutover)throw Error("protected_sales_cutover_not_approved");
  if(!SALES_HOST_ORIGINS.includes(origin))throw Error("unauthorized_sales_host");
  if(!currentUser||typeof currentUser.getIdToken!=="function"||
     typeof companyId!=="string"||!companyId)throw Error("missing_session");
  if(typeof getMonth!=="function"||typeof subscribeToSignal!=="function"||
      typeof applySnapshot!=="function"||typeof onError!=="function")
    throw Error("invalid_sales_bridge");
  const getData=()=>getSafeFinancialView({
    gatewayUrl,origin,user:currentUser,month:getMonth(),explicitCutover:true,fetcher});
  const stream=startProtectedView({
    subscribeToSignal:cb=>subscribeToSignal(companyId,cb,onError),
    fetchProtectedView:getData,
    projectView:response=>{
      // Never publish a late previous-month response after the user changed
      // the selected month. A caller must invoke refresh() on month change.
      if(response.month!==getMonth())throw Error("selected_finance_month_changed");
      return {...projectSafeView(response),month:response.month};
    },onView:applySnapshot,onError});
  return {
    refresh:stream.refresh,
    close:stream.stop,
    async submit({selection,inputs,products}){
      // Monetary input fields are discarded, not serialized.
      const intent=buildSafeFormIntent(selection,inputs,products);
      const result=await submitCountIntent({
        gatewayUrl,origin,user:currentUser,input:intent,
        explicitCutover:true,fetcher});
      // A 200 from the write API alone is not proof the UI now contains
      // the saved record. Explicitly fetch a fresh authenticated view, not
      // an in-flight pre-write view, then cross-check immutable identity
      // and the saved aggregate. Never fall back to raw Firestore.
      const expectedMonth=String(selection?.date||"").slice(0,7);
      if(expectedMonth!==getMonth())throw Error("saved_month_not_selected");
      const confirmed=await stream.refresh();
      const matched=confirmed?.records?.find(record=>
        record.id===result.recordId && record.totalCount===result.totalCount);
      if(!matched)throw Error("saved_record_not_visible_after_refresh");
      return result;
    }
  };
}
