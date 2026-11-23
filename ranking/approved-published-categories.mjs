// Shared ranks are released ONLY for exact Owner-reviewed SKU mappings and
// server-stored per-partner visibility. This module never writes or returns
// financial master fields, inactive products, raw IDs or cashback tier labels.
// Strict old 光/AIR combined names only. Generic "旧合算"/"未分類" alone
// never authorizes an unrelated partner count input or publish target.
const LEGACY_COMBINED_LIGHT_AIR=/(?:^|[\s（(])(?:SB|ソフトバンク)?光\s*[/／・]\s*(?:AIR|エアー)(?=$|[\s）)（(])/i;
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
// Fallback only for exact, long-established count category names. The Owner
// must still have published the unique ACTIVE hub product in the public count
// catalog; browser aliases, financial masters, fuzzy or partial names are banned.
const normalizeLabel=x=>x.normalize("NFKC").trim().toLowerCase().replace(/[\s　]+/g,"");
const COMBINED_ALIASES=new Set(["SB光・AIR","SB光・AIR（旧合算・未分類）",
 "光/AIR","光・Air","SB光/AIR","ソフトバンク光/Air"].map(normalizeLabel));

const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:単価|売上|収益|利益|報酬|原価|価格|キャッシュバック|cash\s*back|revenue|unit\s*price|commission|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9][0-9,.]*\s*(?:万|千)?円)/i;
const stop=()=>{throw Error("PARTNER_PUBLICATION_UNVERIFIED")};
const id=x=>typeof x==="string"&&ID.test(x)&&!["__proto__","constructor","prototype"].includes(x);
const privateSku=x=>typeof x==="string"&&
 id(x.match(/^partnerPrivate:([A-Za-z0-9_-]{1,128})$/)?.[1]);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const unique=x=>Array.isArray(x)&&x.length<=1000&&x.every(id)&&new Set(x).size===x.length;
export function allowedPartnerCategories({hubId,cid,ownerUid,visibility,mapping,products}={}){
 if(!id(hubId)||!id(cid)||hubId===cid||!id(ownerUid)||
  !obj(visibility)||visibility.hubCompanyId!==hubId||
  visibility.ownerUid!==ownerUid||
  !Number.isSafeInteger(visibility.version)||visibility.version<1||
  !unique(visibility.enabledHubProductIds)||
  !obj(visibility.partnerOverrides)||
  Object.keys(visibility.partnerOverrides).length>100||
  !obj(mapping)||mapping.hubCompanyId!==hubId||
  mapping.ownerUid!==ownerUid||mapping.reviewedByUid!==ownerUid||
  mapping.active!==true||!Number.isSafeInteger(mapping.version)||
  mapping.version<1||!Array.isArray(mapping.bindings)||
  mapping.bindings.length>1000||!Array.isArray(products)||
  products.length>1000)stop();
 const catalog=new Map(),approved=new Set(visibility.enabledHubProductIds);
 for(const product of products){
  if(!obj(product)||!id(product.id)||product.companyId!==hubId||
   catalog.has(product.id)||
   (product.active!==undefined&&typeof product.active!=="boolean"))stop();
  catalog.set(product.id,product);
 }
 for(const v of approved)if(!catalog.has(v))stop();
 for(const [companyId,selected] of Object.entries(visibility.partnerOverrides)){
  if(!id(companyId)||companyId===hubId||!unique(selected)||
   selected.some(x=>!catalog.has(x)))stop();
 }
 const scoped=Object.prototype.hasOwnProperty.call(visibility.partnerOverrides,cid)?
  new Set(visibility.partnerOverrides[cid]):approved;
 const binding=new Map(),seen=new Set(),seenHubSku=new Set();
 for(const b of mapping.bindings){
  if(!obj(b)||Object.keys(b).sort().join("|")!==
   ["companyId","productId","hubProductId"].sort().join("|")||
   !id(b.companyId)||b.companyId===hubId||
   (!/^partnerSku0[1-9]$/.test(b.productId)&&!privateSku(b.productId))||
   !id(b.hubProductId)||!catalog.has(b.hubProductId))stop();
  const k=JSON.stringify([b.companyId,b.productId]);
  if(seen.has(k))stop();
  seen.add(k);
  if(b.companyId!==cid)continue;
  // Unrelated historical masters may have no label. The exact chosen SKU
  // cannot: it must be reviewed, active and not amount-encoded.
  const chosen=catalog.get(b.hubProductId);
  // The mapped public row must be count-only and unique for this partner.
  // Two categories mapped to one hub SKU would double-count the same result.
  if(Object.keys(chosen).sort().join("|")!==
     ["id","companyId","name","active"].sort().join("|")||
     typeof chosen.active!=="boolean"||
     typeof chosen.name!=="string"||!chosen.name.trim()||
     chosen.name.length>80||MONEY.test(chosen.name.normalize("NFKC"))||
     seenHubSku.has(b.hubProductId))stop();
  seenHubSku.add(b.hubProductId);
  if(b.productId==="partnerSku05"&&
   !LEGACY_COMBINED_LIGHT_AIR.test(catalog.get(b.hubProductId).name.normalize("NFKC")))stop();
  // Reviewed private bindings reserve their target for historical counts.
  // The fixed legacy input form only accepts its own nine categories.
  if(!privateSku(b.productId))binding.set(b.productId,b.hubProductId);
 }
 // Exact Owner-reviewed IDs remain first priority. For genuinely unmapped
 // categories ONLY, join a unique exact hub label. The old combined light/AIR
 // aliases stay one category. A duplicate or inactive target grants no input.
 const byName=new Map(),combinedMatches=[];
 for(const product of catalog.values()){
  if(typeof product.name!=="string"||
     !product.name.trim()||product.name.length>80||
     MONEY.test(product.name.normalize("NFKC")))continue;
  const name=product.name.trim(),rows=byName.get(name)||[];
  rows.push(product);byName.set(name,rows);
  if(COMBINED_ALIASES.has(normalizeLabel(product.name)))combinedMatches.push(product);
 }
 const proposed=new Map(),claims=new Map();
 for(let i=0;i<KEYS.length;i++){
  const sku="partnerSku"+String(i+1).padStart(2,"0");
  if(binding.has(sku))continue;
  const possible=sku==="partnerSku05"?combinedMatches:byName.get(KEYS[i])||[];
  if(possible.length!==1||possible[0].active!==true)continue;
  const target=possible[0];
  if(seenHubSku.has(target.id))continue;
  // Old light/AIR combined never becomes separate 光 or separate AIR.
  if(sku==="partnerSku05"&&
     !LEGACY_COMBINED_LIGHT_AIR.test(target.name.normalize("NFKC")))continue;
  proposed.set(sku,target.id);
  claims.set(target.id,(claims.get(target.id)||0)+1);
 }
 // Two different original categories cannot claim the same hub SKU.
 for(const [sku,pid] of proposed)
  if(claims.get(pid)===1)binding.set(sku,pid);
 return Object.freeze(KEYS.filter((category,i)=>{
  const sku="partnerSku"+String(i+1).padStart(2,"0"),pid=binding.get(sku);
  return pid&&approved.has(pid)&&scoped.has(pid)&&catalog.get(pid).active!==false;
 }));
}
export {KEYS};
