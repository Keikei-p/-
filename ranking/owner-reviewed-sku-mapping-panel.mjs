/**
 * STAGING / NO DEPLOY: simple smartphone-ready owner SKU matching.
 * Original sales, partner counts and historical combined SB光・AIR are NEVER
 * rewritten. This panel only uses server Auth-bound get/set callables.
 *
 * The hub owner explicitly pairs each of the nine legacy partner categories
 * with a real hub product ID. "Unmapped" is always available, and any failed
 * mapping remains unsaved until confirmed by the server.
 */
const IDS=/^[A-Za-z0-9_:-]{1,200}$/;
const CASH=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|unitPrice|cashback)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:円|万円))/i;
const LEGACY="partnerSku05";
const PRIVATE=/^partnerPrivate:[A-Za-z0-9_-]{1,128}$/;
const CATEGORIES=Object.freeze([
 ["partnerSku01","NURO"],
 ["partnerSku02","SBMNP"],
 ["partnerSku03","YMMNP"],
 ["partnerSku04","YM純新規"],
 [LEGACY,"SB光・AIR（旧合算・未分類）"],
 ["partnerSku06","ウォーター"],
 ["partnerSku07","つばさ・HTB"],
 ["partnerSku08","太陽光・蓄電池AP"],
 ["partnerSku09","U-NEXT"]
]);
const fail=()=>{throw Error("OWNER_PARTNER_SKU_PANEL_UNVERIFIED");};
const id=x=>typeof x==="string"&&IDS.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const name=x=>typeof x==="string"&&x.trim().length>0&&
 x.length<=80&&!CASH.test(x);
const keys=(x,expected)=>obj(x)&&
 Object.keys(x).sort().join("|")===expected.slice().sort().join("|");
const combined=x=>typeof x==="string"&&/(?:^|[\s（(])(?:SB|ソフトバンク)?光\s*[/／・]\s*(?:AIR|エアー)(?=$|[\s）)（(])/i.test(x.normalize("NFKC"));
const LEGACY_COMBINED_TSUBASA_HTB=/(?:^|[\s（(])(?:つばさ|翼)\s*[/／・]\s*HTB(?=$|[\s）)（(])/i;
const energyCombined=x=>typeof x==="string"&&LEGACY_COMBINED_TSUBASA_HTB.test(x.normalize("NFKC"));
const el=(doc,tag,text)=>{
 const n=doc.createElement(tag);
 if(text!==undefined)n.textContent=text;
 return n;
};
function validate(mapping,catalog,partner){
 const mappingFields=["schema","hubCompanyId","version","bindings"];
 const withPrivate=obj(mapping)&&Object.hasOwn(mapping,"partnerProducts");
 if(withPrivate)mappingFields.push("partnerProducts");
 if(!keys(mapping,mappingFields)||
    mapping.schema!=="nico-owner-reviewed-sku-map-v1"||
    !id(mapping.hubCompanyId)||
    !Number.isSafeInteger(mapping.version)||mapping.version<0||
    !Array.isArray(mapping.bindings)||mapping.bindings.length>1000||
    !keys(catalog,["schema","role","version","hubCompanyId","products",
      "partnerOverrides"])||
    catalog.schema!=="nico-hub-product-visibility-v1"||
    catalog.role!=="hub_owner"||
    catalog.hubCompanyId!==mapping.hubCompanyId||
    !Array.isArray(catalog.products)||catalog.products.length>1000)fail();
 const seen=new Set(),targets=new Set(),match=new Map(),products=new Map();
 const privateProducts=new Map();
 if(withPrivate){
  if(!Array.isArray(mapping.partnerProducts)||mapping.partnerProducts.length>1000)fail();
  for(const p of mapping.partnerProducts){
   if(!keys(p,["id","name","active"])||typeof p.id!=="string"||
      !PRIVATE.test(p.id)||privateProducts.has(p.id)||!name(p.name)||
      typeof p.active!=="boolean")fail();
   privateProducts.set(p.id,p);
  }
 }
 for(const p of catalog.products){
  if(!keys(p,["id","name","active","enabled"])||
     !id(p.id)||products.has(p.id)||!name(p.name)||
     typeof p.active!=="boolean"||typeof p.enabled!=="boolean")fail();
  products.set(p.id,{id:p.id,name:p.name,active:p.active,enabled:p.enabled});
 }
 for(const b of mapping.bindings){
  if(!keys(b,["companyId","productId","hubProductId"])||
     !id(b.companyId)||!id(b.hubProductId)||
     typeof b.productId!=="string"||
     (!CATEGORIES.some(c=>c[0]===b.productId)&&!PRIVATE.test(b.productId)))fail();
  // Fail closed on a historical duplicate target before it can mislead Owner.
  const k=JSON.stringify([b.companyId,b.productId]);
  const target=JSON.stringify([b.companyId,b.hubProductId]);
  if(seen.has(k)||targets.has(target))fail();
  seen.add(k);targets.add(target);
  if(b.companyId!==partner)continue;
  // A historical private category can be assessed only with the current
  // server-verified partner catalog. Never trust a mapping without its source.
  const isPrivate=PRIVATE.test(b.productId);
  if(isPrivate&&(!withPrivate||!privateProducts.has(b.productId)))fail();
  if(!products.has(b.hubProductId))fail();
  const sourceName=isPrivate?privateProducts.get(b.productId).name:null;
  // Mirror the Owner writer and canonical count reader: old private 光/AIR
  // combined counts must never be displayed as mapped into standalone Air,
  // unrelated "旧合算" products, or a different financial category.
  if((b.productId===LEGACY||combined(sourceName))&&
     !combined(products.get(b.hubProductId).name))fail();
  if((b.productId==="partnerSku07"||energyCombined(sourceName))&&
     !energyCombined(products.get(b.hubProductId).name))fail();
  match.set(b.productId,b.hubProductId);
 }
 return {version:mapping.version,products:[...products.values()],match,privateProducts};
}
// Owner preview only proposes an unambiguous exact name. The original
// combined 光/AIR category retains its historic saved and display names.
export function suggestUnambiguousOwnerSkuMappings({mapping,catalog,partnerCompanyId}={}){
 if(!id(partnerCompanyId))fail();
 const view=validate(mapping,catalog,partnerCompanyId);
 const published=new Set(catalog.products.filter(p=>p.active&&p.enabled).map(p=>p.id));
 const override=catalog.partnerOverrides;
 if(!obj(override)||Object.values(override).some(x=>!Array.isArray(x)||
     x.some(y=>!id(y))))fail();
 if(Object.hasOwn(override,partnerCompanyId)){
  const allowed=new Set(override[partnerCompanyId]);
  for(const productId of published)if(!allowed.has(productId))published.delete(productId);
 }
 const occupied=new Set(view.match.values());
 const result=[];
 const categories=[...CATEGORIES,...[...view.privateProducts.values()].map(p=>[p.id,p.name])];
 for(const [productId,partnerLabel] of categories){
  if(view.match.has(productId))continue;
  // Historic 光/AIR has several legitimate combined labels. Suggest a
  // mapping only if the Owner has a unique matching combined hub SKU;
  // standalone 光/Air are never candidates and no save happens here.
  const candidates=view.products.filter(p=>productId===LEGACY?
   combined(p.name):productId==="partnerSku07"?energyCombined(p.name):p.name===partnerLabel);
  const [target]=candidates;
  if(candidates.length===1&&published.has(target.id)&&!occupied.has(target.id))
   result.push({partnerProductId:productId,partnerLabel,
    hubProductId:target.id,hubProductLabel:target.name});
 }
 const freq=new Map();
 for(const proposal of result)freq.set(proposal.hubProductId,
  (freq.get(proposal.hubProductId)||0)+1);
 return Object.freeze(result.filter(x=>freq.get(x.hubProductId)===1)
  .map(x=>Object.freeze(x)));
}
export const PARTNER_CATEGORIES=CATEGORIES;
/**
 * The host supplies a partner ID from its existing, authenticated owner
 * company selector. Server mapping changes re-verify the real relation.
 * enabled=false makes absolutely no network calls.
 */
export function createOwnerReviewedSkuMappingPanel({
 enabled=false,document,root,auth,partnerCompanyId,
 readMappings,readProducts,saveMapping
}={}){
 if(!document?.createElement||!root?.replaceChildren||!auth||
    !id(partnerCompanyId)||typeof readMappings!=="function"||
    typeof readProducts!=="function"||typeof saveMapping!=="function")fail();
 let closed=false,sequence=0,saving=false,lastVersion=null;
 const loadMappings=token=>readMappings({token,partnerCompanyId});
 const clear=()=>root.replaceChildren();
 const status=message=>{
  clear();const x=el(document,"p",message);
  x.setAttribute?.("role","status");
  root.appendChild(x);
 };
 async function refresh(){
  const current=++sequence;
  if(closed)return false;
  clear();lastVersion=null;
  if(enabled!==true)return false;
  const user=auth.currentUser;
  if(!user||typeof user.uid!=="string"||!user.emailVerified||
     typeof user.getIdToken!=="function")return false;
  try{
   const token=await user.getIdToken();
   if(closed||current!==sequence||auth.currentUser!==user)return false;
   if(typeof token!=="string"||token.length<20)fail();
   const [mapping,products]=await Promise.all([
    loadMappings(token),readProducts({token})
   ]);
   if(closed||current!==sequence||auth.currentUser!==user)return false;
   const view=validate(mapping,products,partnerCompanyId);
   const section=el(document,"section");
   section.className="nico-sku-map-panel";
   section.appendChild(el(document,"h2","協力店の商材対応"));
   section.appendChild(el(document,"p",
    "対応先を確認します。連携先が未確定の過去件数は照合保留として保持します。"));
   const scope=el(document,"p","対象会社ID: "+partnerCompanyId);
   section.appendChild(scope);
   const selects=[];
   const categories=[...CATEGORIES,...[...view.privateProducts.values()]
    .map(p=>[p.id,p.name+(p.active?"":"（過去の商材）")])];
   for(const [category,name] of categories){
    const row=el(document,"label");
    row.className="nico-sku-map-row";
    row.appendChild(el(document,"span",name));
    const select=el(document,"select");
    select.setAttribute?.("aria-label",name+" の自社商材");
    select.disabled=saving;
    const empty=el(document,"option",PRIVATE.test(category)?"未対応（照合保留）":"未対応（集計しない）");
    empty.value="";
    select.appendChild(empty);
    const currentId=view.match.get(category)||"";
    const candidates=view.products.filter(p=>
     (p.active||p.id===currentId)&&
     (!(category===LEGACY||combined(view.privateProducts.get(category)?.name??""))||combined(p.name))&&
     (!(category==="partnerSku07"||energyCombined(view.privateProducts.get(category)?.name??""))||energyCombined(p.name)));
    for(const p of candidates){
     const opt=el(document,"option",p.name+(p.active?"":"（取扱終了）"));
     opt.value=p.id;
     opt.disabled=!p.active;
     select.appendChild(opt);
    }
    select.value=currentId;
    select.addEventListener("change",async()=>{
     if(closed||saving||auth.currentUser!==user)return;
     const proposed=select.value||null;
     const old=currentId||null;
     if(proposed===old)return;
     saving=true;
     for(const x of selects)x.disabled=true;
     let saveFailed=false;
     try{
      const fresh=await user.getIdToken();
      if(auth.currentUser!==user||closed)return;
      const result=await saveMapping({token:fresh,
       partnerCompanyId,partnerProductId:category,
       hubProductId:proposed,expectedVersion:view.version});
      if(!keys(result,["saved","version","partnerCompanyId",
          "partnerProductId","hubProductId"])||
         result.partnerCompanyId!==partnerCompanyId||
         result.partnerProductId!==category||
         result.hubProductId!==proposed||
         typeof result.saved!=="boolean"||
         !Number.isSafeInteger(result.version)||
         result.version<view.version)fail();
      // A confirmed write still requires a fresh canonical server read.
     }catch{
      saveFailed=true;
     }finally{
      saving=false;
      if(!closed&&auth.currentUser===user){
       const fresh=await refresh();
       if(saveFailed&&fresh&&!closed&&auth.currentUser===user){
        const notice=el(document,"p",
         "対応設定の保存を確認できません。表示はサーバーの最新状態です。");
        notice.setAttribute?.("role","status");
        root.appendChild(notice);
       }
      }
     }
    });
    selects.push(select);row.appendChild(select);section.appendChild(row);
   }
   // Owner reviews exact matches first. No page-load save, guessed partner
   // finance read, duplicate hub product or alteration of existing bindings.
   const proposals=suggestUnambiguousOwnerSkuMappings({
    mapping,catalog:products,partnerCompanyId
   });
   if(proposals.length){
    const preview=el(document,"section");
    preview.className="nico-sku-batch-preview";
    preview.appendChild(el(document,"h3","一致した商材の一括連携"));
    preview.appendChild(el(document,"p",
     "名称が確実に一致する未設定の商材のみ。内容を確認して保存してください。対象外は従来どおり個別に設定できます。"));
    for(const p of proposals)
     preview.appendChild(el(document,"p",p.partnerLabel+" → "+p.hubProductLabel));
    const batch=el(document,"button",
     "上記"+proposals.length+"件を確認して連携する");
    batch.type="button";
    batch.setAttribute?.("aria-label","一致商材を確認して一括保存");
    batch.addEventListener("click",async()=>{
     if(closed||saving||auth.currentUser!==user)return;
     saving=true;batch.disabled=true;
     for(const x of selects)x.disabled=true;
     let completed=0,failed=false,expectedVersion=view.version;
     try{
      for(const proposed of proposals){
       if(closed||auth.currentUser!==user||current!==sequence)fail();
       const token=await user.getIdToken();
       if(auth.currentUser!==user||closed)fail();
       // Authoritative revocation, version, Owner and publication checks
       // are repeated by the existing server callables for each change.
       const [latestMap,latestProducts]=await Promise.all([
        loadMappings(token),readProducts({token})
       ]);
       const latest=validate(latestMap,latestProducts,partnerCompanyId);
       if(latest.version!==expectedVersion)fail();
       const stillEligible=suggestUnambiguousOwnerSkuMappings({
        mapping:latestMap,catalog:latestProducts,partnerCompanyId
       }).some(p=>p.partnerProductId===proposed.partnerProductId&&
        p.hubProductId===proposed.hubProductId);
       if(!stillEligible)fail();
       const result=await saveMapping({token,partnerCompanyId,
        partnerProductId:proposed.partnerProductId,
        hubProductId:proposed.hubProductId,expectedVersion});
       if(!keys(result,["saved","version","partnerCompanyId",
           "partnerProductId","hubProductId"])||
          result.saved!==true||result.version!==expectedVersion+1||
          result.partnerCompanyId!==partnerCompanyId||
          result.partnerProductId!==proposed.partnerProductId||
          result.hubProductId!==proposed.hubProductId)fail();
       const checked=await loadMappings(token);
       const confirmed=validate(checked,latestProducts,partnerCompanyId);
       if(confirmed.version!==result.version||
          confirmed.match.get(proposed.partnerProductId)!==
           proposed.hubProductId)fail();
       expectedVersion=result.version;completed++;
      }
     }catch{failed=true;
     }finally{
      saving=false;
      if(!closed&&auth.currentUser===user){
       const fresh=await refresh();
       if(fresh&&!closed&&auth.currentUser===user){
        const notice=el(document,"p",failed?
         "一括連携は途中で停止しました。保存確認済み"+completed+
          "件。最新状態を再取得したため残りを確認してください。":
         "一括連携を保存・再確認しました（"+completed+"件）。");
        notice.setAttribute?.("role","status");root.appendChild(notice);
       }
      }
     }
    });
    preview.appendChild(batch);section.appendChild(preview);
   }
   root.replaceChildren(section);
   lastVersion=view.version;
   return true;
  }catch{
   if(!closed&&current===sequence&&auth.currentUser===user)
    status("対応表を読み込めません。管理者権限を確認してください。");
   return false;
  }
 }
 return Object.freeze({
  refresh,
  getVersion:()=>lastVersion,
  onAuthChange(){sequence++;lastVersion=null;clear()},
  destroy(){closed=true;sequence++;lastVersion=null;clear()}
 });
}
