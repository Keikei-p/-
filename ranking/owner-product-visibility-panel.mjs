/**
 * STAGING ONLY — owner product ON/OFF controls.
 * Never reads raw Firestore/products, and never writes data directly.
 * Inject authenticated server callables only. No HTML injection or prices.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|unitPrice|cashback)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const fail=()=>{throw Error("OWNER_PRODUCT_ONOFF_PANEL_UNVERIFIED");};
function validate(v){
 if(!v||v.schema!=="nico-hub-product-visibility-v1"||
    v.role!=="hub_owner"||!Number.isSafeInteger(v.version)||
    v.version<0||!Array.isArray(v.products)||v.products.length>1000||
    !v.products.every(p=>p&&
     Object.keys(p).sort().join("|")==="active|enabled|id|name"&&
     typeof p.id==="string"&&ID.test(p.id)&&
     typeof p.name==="string"&&p.name.trim()&&
     p.name.length<=80&&!MONEY.test(p.name)&&
     typeof p.active==="boolean"&&typeof p.enabled==="boolean"&&
     (!p.enabled||p.active))||
    new Set(v.products.map(p=>p.id)).size!==v.products.length)fail();
 return v;
}
const el=(doc,tag,text,klass)=>{
 const x=doc.createElement(tag);
 if(klass)x.className=klass;
 if(text!==undefined)x.textContent=text;
 return x;
};
export function createOwnerProductVisibilityPanel({
 document,root,auth,load,save,partnerCompanyId=null
}={}){
 if(!document?.createElement||!root?.replaceChildren||
    !auth||typeof load!=="function"||typeof save!=="function"||
    (partnerCompanyId!==null&&(!ID.test(partnerCompanyId)||
     ["__proto__","prototype","constructor"].includes(partnerCompanyId))))fail();
 let generation=0,closed=false,rendered=null,busy=false;
 const clear=()=>{root.replaceChildren();rendered=null;};
 function status(text){
  const x=el(document,"p",text,"nico-product-publication-status");
  x.setAttribute?.("role","status");
  root.appendChild(x);
 }
 async function refresh(){
  if(closed)return false;
  const token=++generation,identity=auth.currentUser;
  clear();
  if(!identity||typeof identity.uid!=="string"||
     typeof identity.getIdToken!=="function")return false;
  try{
   const bearer=await identity.getIdToken();
   if(closed||token!==generation||auth.currentUser!==identity)return false;
   if(typeof bearer!=="string"||!bearer)fail();
   const view=validate(await load({token:bearer}));
   // Company switches are the intersection of globally published SKUs
   // and the current company override. Missing override inherits global.
   const scoped=partnerCompanyId!==null;
   const settings=view.partnerOverrides;
   if(scoped&&(!settings||typeof settings!=="object"||
      Array.isArray(settings)||
      Object.values(settings).some(v=>!Array.isArray(v)||
       v.some(x=>typeof x!=="string"||!ID.test(x)))))fail();
   const partnerAllowed=scoped?new Set(
    Object.hasOwn(settings,partnerCompanyId)?settings[partnerCompanyId]:
     view.products.filter(x=>x.enabled).map(x=>x.id)):null;
   if(closed||token!==generation||auth.currentUser!==identity)return false;
   const page=el(document,"section",undefined,"nico-owner-publications");
   page.appendChild(el(document,"h2",scoped?"選択した協力店の商材ON/OFF":"協力店に公開する商材"));
   page.appendChild(el(document,"p",
    scoped?"自社で全体公開ONの商材だけを切替できます。OFFでも保存済み件数・履歴は消えません。":"ONの商材だけが協力店の件数と合同ランキングの対象です。OFFにしても保存済みの件数・履歴は消えません。"));
   for(const product of view.products){
    const label=el(document,"label",undefined,"nico-owner-product-switch");
    const checkbox=el(document,"input");
    checkbox.type="checkbox";
    const currentEnabled=scoped?
     product.enabled&&partnerAllowed.has(product.id):product.enabled;
    checkbox.checked=currentEnabled;
    checkbox.disabled=!product.active||busy||(scoped&&!product.enabled);
    checkbox.setAttribute?.("aria-label",product.name+" を協力店に公開");
    const name=el(document,"span",product.name);
    const flag=el(document,"strong",currentEnabled?"ON":"OFF");
    label.appendChild(checkbox);label.appendChild(name);label.appendChild(flag);
    checkbox.addEventListener("change",async()=>{
     if(closed||busy||auth.currentUser!==identity)return;
     busy=true;checkbox.disabled=true;
     flag.textContent="保存中";
     try{
      const authToken=await identity.getIdToken();
      if(closed||auth.currentUser!==identity)return;
      const result=await save({token:authToken,productId:product.id,
       enabled:checkbox.checked,expectedVersion:view.version,
       partnerCompanyId});
      if(!result||typeof result.saved!=="boolean"||
         !Number.isSafeInteger(result.version)||
         result.productId!==product.id||
         result.enabled!==checkbox.checked)fail();
      // Never show success before server confirms. Reload from server.
     }catch{
      clear();status("保存を確認できませんでした。再読み込みして確認してください。");
     }finally{
      busy=false;
      if(!closed&&auth.currentUser===identity)await refresh();
     }
    });
    page.appendChild(label);
   }
   root.replaceChildren(page);rendered=view;
   return true;
  }catch{
   if(!closed&&auth.currentUser===identity&&token===generation){
    clear();status("商材公開設定を確認できません。管理者でログインしてください。");
   }
   return false;
  }
 }
 return Object.freeze({
  refresh,
  getVersion:()=>rendered?.version??null,
  onAuthChange(){generation++;clear();},
  destroy(){closed=true;generation++;clear();}
 });
}
