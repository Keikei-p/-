/**
 * Event-driven protected view synchronization.
 * NEVER read products/records/recordCorrections from browser Firestore.
 * subscribeToSignal observes only companies/{id}/publicSync/state.
 * A caller awaiting refresh() MUST receive a fully verified new gateway
 * snapshot, even if a previous request was in flight when refresh was called.
 */
export function startProtectedView({subscribeToSignal,fetchProtectedView,projectView,onView,onError}){
  if(![subscribeToSignal,fetchProtectedView,projectView,onView,onError].every(x=>typeof x==="function"))
    throw Error("invalid_finance_runtime");
  let stopped=false,epoch=0,active=null,queued=null;
  function run(){
    const generation=epoch;
    const task=(async()=>{
      try{
        const data=await fetchProtectedView();
        if(stopped||generation!==epoch)throw Error("protected_view_stopped");
        // The full server view must pass the no-leak contract before touching UI.
        const projected=projectView(data);
        if(stopped||generation!==epoch)throw Error("protected_view_stopped");
        await onView(projected);
        if(stopped||generation!==epoch)throw Error("protected_view_stopped");
        return projected;
      }catch(error){
        if(!stopped&&generation===epoch){
          try{onError(error)}catch{/* do not replace the original failure */}
        }
        // Never treat a denied or stale response as post-write confirmation.
        throw error;
      }
    })();
    active=task;
    // Attach both handlers. Rejecting task cannot create an unhandled
    // rejection in the scheduler; the original refresh caller owns its error.
    void task.then(()=>{
      if(active!==task)return;
      active=null;
      if(queued){
        const nextWaiter=queued;queued=null;
        run().then(nextWaiter.resolve,nextWaiter.reject);
      }
    },()=>{
      if(active!==task)return;
      active=null;
      if(queued){
        const nextWaiter=queued;queued=null;
        run().then(nextWaiter.resolve,nextWaiter.reject);
      }
    });
    return task;
  }
  function refresh(){
    if(stopped)return Promise.resolve(undefined);
    if(active){
      // An explicit save may occur after the active GET began. It must wait
      // for a NEW GET, not accidentally reuse that pre-write snapshot.
      if(!queued){
        let resolve,reject;
        const promise=new Promise((a,b)=>{resolve=a;reject=b});
        queued={promise,resolve,reject};
      }
      return queued.promise;
    }
    return run();
  }
  const stopSignal=subscribeToSignal(()=>{void refresh().catch(()=>{})});
  if(typeof stopSignal!=="function")throw Error("invalid_sync_subscription");
  void refresh().catch(()=>{});
  return {refresh,stop(){
    if(stopped)return;
    stopped=true;epoch++;
    if(queued){queued.reject(Error("protected_view_stopped"));queued=null}
    stopSignal();
  }};
}
