"use strict";
/**
 * OFFLINE / NO DEPLOY. Contract for NEW Owner-approved individual partner
 * product counts. These counts must be stored separately from the immutable
 * nine-category historical ledger and its privateCounts.
 *
 * The caller MUST pass only the freshly verified server-side partner scope,
 * transaction-read publication/catalog, and transaction-read saved counts.
 * The browser may propose new numbers, NEVER its company/Owner permissions.
 * This helper does not read/write Firestore or touch revenue, unit price or CB.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|収益|利益|報酬|原価|価格|キャッシュバック|cash\s*back|revenue|unit\s*price|commission|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9０-９][0-9０-９,.，]*\s*(?:万|千)?円)/i;
const MAX_PRODUCTS=200;
const MAX_COUNT=9999;
const MAX_TOTAL=2000000;
const DENY="OWNER_APPROVED_INDIVIDUAL_COUNT_UNVERIFIED";
const fail=()=>{throw Error(DENY);};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const safeId=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const id=x=>safeId(x)&&!x.startsWith("legacyPartnerSku:")&&
 !x.startsWith("partnerPrivate:");
const unique=(x)=>Array.isArray(x)&&x.length<=1000&&
 new Set(x).size===x.length&&x.every(safeId);
const sameKeys=(o,required)=>obj(o)&&
 Object.keys(o).sort().join("|")===required.slice().sort().join("|");
const countMap=(value)=>{
 if(!obj(value)||Object.keys(value).length>MAX_PRODUCTS)fail();
 const next=Object.create(null);
 let total=0;
 for(const [productId,n] of Object.entries(value)){
  if(!id(productId)||!Number.isSafeInteger(n)||n<0||n>MAX_COUNT)fail();
  next[productId]=n;
  total+=n;
  if(!Number.isSafeInteger(total)||total>MAX_TOTAL)fail();
 }
 return {counts:next,total};
};
/** Verify Owner publication and a public count-only catalog, never finance products. */
function verifiedCatalog({scope,visibility,publicCatalog}={}){
 if(!obj(scope)||scope.verifiedByServer!==true||
    !(scope.kind==="partner"||(scope.kind==="hub_owner"&&scope.role==="owner"&&scope.uid===scope.ownerUid))||
    !id(scope.uid)||!id(scope.cid)||!id(scope.hubId)||
    scope.cid===scope.hubId||!id(scope.ownerUid))fail();
 if(!obj(visibility)||visibility.hubCompanyId!==scope.hubId||
    visibility.ownerUid!==scope.ownerUid||
    !Number.isSafeInteger(visibility.version)||visibility.version<1||
    !unique(visibility.enabledHubProductIds)||
    !obj(visibility.partnerOverrides)||
    Object.keys(visibility.partnerOverrides).length>100)fail();
 const p=publicCatalog;
 if(!obj(p)||p.schema!=="nico-reviewed-count-public-catalog-v1"||
    p.hubCompanyId!==scope.hubId||p.ownerUid!==scope.ownerUid||
    p.version!==visibility.version||
    !Array.isArray(p.products)||p.products.length>1000||
    Object.keys(p).some(k=>!["schema","hubCompanyId","ownerUid",
      "version","createdAt","updatedAt","products"].includes(k)))fail();
 const catalog=new Map();
 for(const row of p.products){
  if(!sameKeys(row,["id","companyId","name","active"])||
     !safeId(row.id)||row.companyId!==scope.hubId||
     typeof row.name!=="string"||!row.name.trim()||
     row.name.length>80||MONEY.test(row.name.normalize("NFKC"))||
     typeof row.active!=="boolean"||catalog.has(row.id))fail();
  catalog.set(row.id,row);
 }
 const global=new Set(visibility.enabledHubProductIds);
 for(const key of global)if(!catalog.has(key))fail();
 for(const [company,ids] of Object.entries(visibility.partnerOverrides)){
  if(!id(company)||company===scope.hubId||!unique(ids)||
     ids.some(x=>!catalog.has(x)))fail();
 }
 const own=Object.hasOwn(visibility.partnerOverrides,scope.cid)?
   new Set(visibility.partnerOverrides[scope.cid]):global;
 const permitted=new Set();
 for(const key of global)if(id(key)&&own.has(key)&&catalog.get(key).active===true)
  permitted.add(key);
 return {catalog,permitted};
}
/**
 * Omitted request => old state unchanged. Provided request includes ONLY
 * published ON individual IDs; all prior OFF values are preserved internally
 * without being sent to the client. This does NOT change the old nine counts.
 * A caller should create audit/version writes only when changed=true.
 */
function reconcileOwnerApprovedIndividualCounts({scope,visibility,publicCatalog,
 previous,requested}={}){
 const {catalog,permitted}=verifiedCatalog({scope,visibility,publicCatalog});
 // The caller must supply the transaction-read prior state, even when empty.
 // Omitting it could otherwise erase or duplicate already saved OFF counts.
 const saved=countMap(previous);
 if(requested===undefined){
  const visible=Object.fromEntries([...permitted].map(key=>[key,saved.counts[key]??0]));
  return Object.freeze({changed:false,delta:0,
   counts:Object.freeze({...saved.counts}),total:saved.total,
   visibleCounts:Object.freeze(visible),
   publishedProducts:Object.freeze([...permitted].map(key=>
    Object.freeze({id:key,name:catalog.get(key).name})))});
 }
 const input=countMap(requested);
 for(const key of Object.keys(input.counts))if(!permitted.has(key))fail();
 const result={...saved.counts,...input.counts};
 const next=countMap(result);
 const changed=Object.entries(input.counts).some(([key,n])=>
   (saved.counts[key]??0)!==n);
 const visible=Object.fromEntries([...permitted].map(key=>[key,next.counts[key]??0]));
 return Object.freeze({changed,delta:next.total-saved.total,
  counts:Object.freeze({...next.counts}),total:next.total,
  visibleCounts:Object.freeze(visible),
  publishedProducts:Object.freeze([...permitted].map(key=>
    Object.freeze({id:key,name:catalog.get(key).name})))});
}
module.exports={reconcileOwnerApprovedIndividualCounts};
