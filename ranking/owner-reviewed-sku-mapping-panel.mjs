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
 x.length<=80&&!CASH.test(x.normalize("NFKC"));
const keys=(x,expected)=>obj(x)&&
 Object.keys(x).sort().join("|")===expected.slice().sort().join("|");
const combined=x=>/SB光・AIR|旧合算|未分類/.test(x);
const el=(doc,tag,text)=>{
 const n=doc.createElement(tag);
 if(text!==undefined)n.textContent=text;
 return n;
};
function validate(mapping,catalog,partner){
 if(!keys(mapping,["schema","hubCompanyId","version","bindings"])||
    mapping.schema!=="nico-owner-reviewed-sku-map-v1"||
    !id(mapping.hubCompanyId)||
    !Number.isSafeInteger(mapping.version)||mapping.version<0||
    !Array.isArray(mapping.bindings)||mapping.bindings.length>1000||
    !keys(catalog,["schema","role","version","hubCompanyId","products",
      "partnerOverrides"])||
    catalog.schema!=="nico-hub-product-visibility-v1"||
    catalog.role!=="hub_owner"||
    catalog.hubCompanyId!==mapping.hubCompanyId||
    !Number.isSafeInteger(catalog.version)||catalog.version<0||
    !obj(catalog.partnerOverrides)||
    Object.keys(catalog.partnerOverrides).length>100||
    !Array.isArray(catalog.products)||catalog.products.length>1000)fail();
 const seen=new Set(),match=new Map(),products=new Map();
 for(const p of catalog.products){
  if(!keys(p,["id","name","active","enabled"])||
     !id(p.id)||products.has(p.id)||!name(p.name)||
     typeof p.active!=="boolean"||typeof p.enabled!=="boolean")fail();
  products.set(p.id,{id:p.id,name:p.name,active:p.active,enabled:p.enabled});
 }
 for(const [cid,ids] of Object.entries(catalog.partnerOverrides)){
  if(!id(cid)||cid===mapping.hubCompanyId||
     !Array.isArray(ids)||ids.length>1000||
     ids.some(x=>!id(x)||!products.has(x))||
     new Set(ids).size!==ids.length)fail();
 }
 const mappedHubSku=new Set();
 for(const b of mapping.bindings){
  if(!keys(b,["companyId","productId","hubProductId"])||
     !id(b.companyId)||!id(b.hubProductId)||
     !CATEGORIES.some(c=>c[0]===b.productId))fail();
  const k=b.companyId+":"+b.productId;
  if(seen.has(k))fail();
  seen.add(k);
  if(b.companyId!==partner)continue;
  if(!products.has(b.hubProductId)||mappedHubSku.has(b.hubProductId))fail();
  if(b.productId===LEGACY&&!combined(products.get(b.hubProductId).name))fail();
  mappedHubSku.add(b.hubProductId);
  match.set(b.productId,b.hubProductId);
 }
 const scoped=Object.hasOwn(catalog.partnerOverrides,partner)?
  new Set(catalog.partnerOverrides[partner]):
  new Set([...products.values()].filter(p=>p.enabled).map(p=>p.id));
 const published=productId=>{
  const p=products.get(productId);
  return !!p&&p.active&&p.enabled&&scoped.has(productId);
 };
 return {version:mapping.version,products:[...products.values()],match,published};
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
    readMappings({token}),readProducts({token})
   ]);
   if(closed||current!==sequence||auth.currentUser!==user)return false;
   const view=validate(mapping,products,partnerCompanyId);
   const section=el(document,"section");
   section.className="nico-sku-map-panel";
   section.appendChild(el(document,"h2","協力店の商材対応"));
   section.appendChild(el(document,"p",
    "商材対応と自社・協力店の公開ONが両方そろった商材だけが合同件数ランキングの対象です。元の件数・履歴は変更しません。"));
   const ready=CATEGORIES.filter(([category])=>
    view.published(view.match.get(category))).length;
   section.appendChild(el(document,"p",
    "公開設定上ON: "+ready+" / 9商材（実際の入力開始にはサーバー公開承認が必要）"));
   const scope=el(document,"p","対象会社ID: "+partnerCompanyId);
   section.appendChild(scope);
   const selects=[];
   const mappedElsewhere=category=>new Set([...view.match.entries()]
    .filter(([sku])=>sku!==category).map(([,id])=>id));
   for(const [category,name] of CATEGORIES){
    const row=el(document,"label");
    row.className="nico-sku-map-row";
    row.appendChild(el(document,"span",name));
    const select=el(document,"select");
    select.setAttribute?.("aria-label",name+" の自社商材");
    select.disabled=saving;
    const empty=el(document,"option","未対応（集計しない）");
    empty.value="";
    select.appendChild(empty);
    const currentId=view.match.get(category)||"";
    const usedElsewhere=mappedElsewhere(category);
    // The reviewed server writer rejects two partner SKUs pointing to one
    // hub product. Do not offer that conflicting choice in the Owner UI.
    const candidates=view.products.filter(p=>
     (p.active||p.id===currentId)&&!usedElsewhere.has(p.id)&&
     (category!==LEGACY||combined(p.name)));
    for(const p of candidates){
     const opt=el(document,"option",p.name+(p.active?"":"（取扱終了）"));
     opt.value=p.id;
     opt.disabled=!p.active;
     select.appendChild(opt);
    }
    select.value=currentId;
    const readiness=!currentId?"未対応（ランキング対象外）":
     !view.products.find(p=>p.id===currentId)?.active?"取扱終了":
     view.published(currentId)?"公開設定ON":"商材公開OFF";
    const state=el(document,"small",readiness);
    row.appendChild(state);
    select.addEventListener("change",async()=>{
     if(closed||saving||auth.currentUser!==user)return;
     const proposed=select.value||null;
     const old=currentId||null;
     if(proposed===old)return;
     saving=true;
     for(const x of selects)x.disabled=true;
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
      if(auth.currentUser===user&&!closed)
       status("対応設定の保存を確認できません。再読込して確認してください。");
     }finally{
      saving=false;
      if(!closed&&auth.currentUser===user)await refresh();
     }
    });
    selects.push(select);row.appendChild(select);section.appendChild(row);
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
