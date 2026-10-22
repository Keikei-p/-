/**
 * Read-only client projection. Never fetches raw Firestore data and never
 * writes to Firestore. Preserves count entry groups with opaque plan ordinals.
 */
function violation(){throw Error("financial_view_contract_violation")}
function isId(v){return typeof v==="string"&&/^[A-Za-z0-9_-]{1,150}$/.test(v)}
function planIndex(v){
  if(typeof v!=="string"||!/^plan_(0|[1-9]\d{0,2})$/.test(v))violation();
  return Number(v.slice(5));
}
function ensureNoAmounts(v){
  if(!v||typeof v!=="object")violation();
  for(const k of ["revenue","revenuePerUnit","cashback","cashbackOptions","totalRevenue","price","unitPrice","pricingOptions"]){
    if(Object.hasOwn(v,k))violation();
  }
}
export function projectSafeView(view) {
  if(!view||!view.policy||!Array.isArray(view.products)||
      !Array.isArray(view.records)||!Array.isArray(view.revenueGoals)||
      typeof view.policy.canViewRevenue!=="boolean"||
      typeof view.policy.canViewUnitPrice!=="boolean")violation();
  const revenue=view.policy.canViewRevenue===true;
  const unit=revenue&&view.policy.canViewUnitPrice===true;
  if(!revenue&&view.revenueGoals.length)violation();
  const planMap=new Map();
  const products=view.products.map(p=>{
    if(!isId(p.id)||typeof p.name!=="string")violation();
    if(unit){
      if(!Array.isArray(p.planIds))violation();
      p.planIds.forEach((id,i)=>{if(planIndex(id)!==i)violation()});
      return {...p,securePlanIds:p.planIds};
    }
    ensureNoAmounts(p);
    if(!Array.isArray(p.planIds)||p.planIds.length<1)violation();
    const pseudo=p.planIds.map((v,i)=>{
      if(planIndex(v)!==i)violation();
      return {cashback:i,revenuePerUnit:0};
    });
    planMap.set(p.id,p.planIds);
    return {id:p.id,companyId:p.companyId,name:p.name,
      active:p.active,sortOrder:p.sortOrder,revenue:0,pricingOptions:pseudo,
      securePlanIds:p.planIds};
  });
  const records=view.records.map(r=>{
    if(!isId(r.id)||!r.results||typeof r.results!=="object"||Array.isArray(r.results))violation();
    if(!revenue&&Object.hasOwn(r,"totalRevenue"))violation();
    if(unit)return {...r,secureReadOnly:!r.recordVersion};
    let locked=!r.recordVersion;
    const items={};
    for(const [originalKey,v]of Object.entries(r.results)){
      if(!v||!isId(v.productId)||!Number.isSafeInteger(v.count)||v.count<0)violation();
      ensureNoAmounts(v);
      const allowed=planMap.get(v.productId)||[];
      const idx=v.planId==null?-1:allowed.indexOf(v.planId);
      if(idx<0)locked=true;
      const key=idx<0?"legacy_"+originalKey:v.productId+"__cb_"+idx;
      if(Object.hasOwn(items,key))violation();
      items[key]={productId:v.productId,productName:v.productName||"商材",
        count:v.count,cashback:Math.max(idx,0),revenuePerUnit:0,
        securePlanId:idx<0?null:v.planId};
    }
    return {...r,results:items,secureReadOnly:locked};
  });
  return {products,records,revenueGoals:view.revenueGoals,policy:view.policy};
}
export function secureCountRows(rows){
  if(!Array.isArray(rows))violation();
  const seen=new Set(),out=[];
  for(const r of rows){
    if(!r||!isId(r.productId)||r.securePlanId==null)violation();
    planIndex(r.securePlanId);
    if(!Number.isSafeInteger(r.count)||r.count<0||r.count>9999)violation();
    const k=r.productId+"/"+r.securePlanId;
    if(seen.has(k))violation();
    seen.add(k);
    if(r.count>0)out.push({productId:r.productId,planId:r.securePlanId,count:r.count});
  }
  return out;
}

/**
 * Convert existing on-screen input values into a server-safe intent.
 * Caller must use a projected view from projectSafeView, never raw products.
 * No sale amount, product title, cashback amount, or unit price is sent.
 */
export function buildSafeFormIntent(selection,inputs,products) {
  if(!selection || !Array.isArray(products) || !Array.isArray(inputs))violation();
  const allowedKeys=["uid","date","teamId","workLocation","reportStatus","existingRecord"];
  if(Object.keys(selection).some(k=>!allowedKeys.includes(k)))violation();
  const prior=selection.existingRecord;
  if(prior?.secureReadOnly)throw Error("historical_plan_requires_owner_review");
  const rows=[];
  const map=new Map(products.map(p=>[p.id,p]));
  for(const item of inputs){
    if(!item || !item.dataset || !isId(item.dataset.productId))violation();
    const product=map.get(item.dataset.productId);
    if(!product || product.active===false || !Array.isArray(product.securePlanIds))violation();
    const count=Number(item.value||0);
    if(!Number.isSafeInteger(count)||count<0||count>9999)violation();
    const selectedCashback=Number(item.dataset.cashback);
    if(!Number.isSafeInteger(selectedCashback)||selectedCashback<0)violation();
    let position;
    if(product.pricingOptions?.length){
      const options=product.pricingOptions.slice().sort((a,b)=>Number(a.cashback)-Number(b.cashback));
      position=options.findIndex(x=>Number(x.cashback)===selectedCashback);
    }else{
      position=selectedCashback===0?0:-1;
    }
    if(position<0 || !product.securePlanIds[position])violation();
    rows.push({productId:product.id,securePlanId:product.securePlanIds[position],count});
  }
  const entries=secureCountRows(rows);
  if(selection.reportStatus==="submitted"&&!entries.length)violation();
  if(selection.reportStatus==="no_result"&&entries.length)violation();
  const body={uid:selection.uid,date:selection.date,
    teamId:selection.teamId,workLocation:selection.workLocation||"",
    reportStatus:selection.reportStatus,entries};
  if(prior){
    if(!isId(prior.id)||!prior.recordVersion)violation();
    if(prior.uid!==body.uid||prior.date!==body.date)violation();
    body.recordId=prior.id;
    body.expectedRecordUpdateTime=prior.recordVersion;
  }
  return body;
}
