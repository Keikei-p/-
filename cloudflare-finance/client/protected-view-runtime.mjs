/**
 * Event-driven protected view synchronization.
 * This module NEVER reads products/records/recordCorrections from Firestore.
 * subscribeToSignal must observe only companies/{id}/publicSync/state.
 * GET is only through authenticated, server-authorized finance gateway.
 */
export function startProtectedView({subscribeToSignal,fetchProtectedView,projectView,onView,onError}){
  if(![subscribeToSignal,fetchProtectedView,projectView,onView,onError].every(x=>typeof x==="function"))
    throw Error("invalid_finance_runtime");
  let stopped=false,epoch=0,latestRequest=0,inFlight=false,pending=false;
  async function refresh(){
    if(stopped)return;
    if(inFlight){pending=true;return;}
    inFlight=true;
    const ticket=++latestRequest;
    const generation=epoch;
    try{
      const data=await fetchProtectedView();
      if(stopped||generation!==epoch||ticket!==latestRequest)return;
      // The entire view must satisfy the local no-leak contract before it is
      // allowed to replace any visible app state.
      const projected=projectView(data);
      if(stopped||generation!==epoch)return;
      await onView(projected);
    }catch(err){
      if(!stopped&&generation===epoch)onError(err);
      // Never fetch from legacy raw Firestore as an error fallback.
    }finally{
      inFlight=false;
      if(!stopped && pending){
        pending=false;
        void refresh();
      }
    }
  }
  const stopSignal=subscribeToSignal(()=>{void refresh()});
  if(typeof stopSignal!=="function")throw Error("invalid_sync_subscription");
  void refresh();
  return {refresh,stop(){
    if(stopped)return;
    stopped=true;epoch++;pending=false;
    stopSignal();
  }};
}
