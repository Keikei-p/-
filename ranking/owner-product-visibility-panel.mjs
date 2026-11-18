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
   // Keep all existing product IDs and published count mappings. Historical
   // (inactive) masters are not deleted; move their disabled switches to one
   // collapsed section instead of duplicating old/new choices in the main UI.
   const primary=view.products.filter(p=>p.active);
   const historical=view.products.filter(p=>!p.active);
   const archived=historical.length?el(document,"details"):null;
   if(archived){
    archived.className="nico-owner-archived-product-switches";
    archived.appendChild(el(document,"summary",
     "旧商材・取扱終了（"+historical.length+"件）／過去実績は保持"));
   }
   page.appendChild(el(document,"p",
    "使用中 "+primary.length+"商材。光・AIRは個別入力、ランキングは従来の合算商材を使います。"));
   for(const product of [...primary,...historical]){
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
     let saveFailed=false;
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
      // Do not erase a failed-save warning while reloading canonical state.
      saveFailed=true;
     }finally{
      busy=false;
      if(!closed&&auth.currentUser===identity){
       const fresh=await refresh();
       if(saveFailed&&fresh&&!closed&&auth.currentUser===identity)
        status("保存を確認できませんでした。表示はサーバーの最新状態です。");
      }
     }
    });
    if(product.active)page.appendChild(label);
    else archived?.appendChild(label);
   }
   if(archived)page.appendChild(archived);
   // The Owner explicitly chose ALL registered active products for ranking.
   // Do not bypass per-product, server-audited ON/OFF and version checks.
   // Company-specific overrides are never silently changed by a global save.
   const selectable=view.products.filter(p=>p.active&&(
    scoped? p.enabled&&!partnerAllowed.has(p.id):!p.enabled));
   if(selectable.length){
    const all=el(document,"button",
     scoped?"この協力店の公開可能商材をすべてON":
      "登録済みの有効商材をすべてランキング対象にする",
     "team-action-button");
    all.type="button";
    all.setAttribute?.("aria-label",scoped?
     "選択した協力店の全公開可能商材をON":"有効な自社商材をすべて公開ON");
    const hint=el(document,"p",scoped?
     "この協力店のOFF商材だけをONにします。他社は変更しません。":
     "全体でOFFの有効商材をONにします。会社別にOFFにした設定は保持されます。");
    page.appendChild(hint);
    page.appendChild(all);
    all.addEventListener("click",async()=>{
     if(closed||busy||auth.currentUser!==identity)return;
     busy=true;all.disabled=true;
     let saved=0,failed=false;
     try{
      let expected=view.version;
      for(const product of selectable){
       if(closed||token!==generation||auth.currentUser!==identity)fail();
       const freshToken=await identity.getIdToken();
       if(closed||token!==generation||auth.currentUser!==identity)fail();
       const latest=validate(await load({token:freshToken}));
       if(latest.version!==expected)fail();
       const current=latest.products.find(p=>p.id===product.id);
       const alreadyOn=scoped?
        current?.enabled&&new Set(Object.hasOwn(latest.partnerOverrides||{},partnerCompanyId)?
         latest.partnerOverrides[partnerCompanyId]:
         latest.products.filter(p=>p.enabled).map(p=>p.id)).has(product.id):
        current?.enabled;
       if(!current||current.active!==true||alreadyOn||
          scoped&&!current.enabled)fail();
       const result=await save({token:freshToken,productId:product.id,
        enabled:true,expectedVersion:expected,partnerCompanyId});
       if(!result||result.saved!==true||
          result.version!==expected+1||
          result.productId!==product.id||result.enabled!==true||
          result.partnerCompanyId!==partnerCompanyId)fail();
       const checked=validate(await load({token:freshToken}));
       const actual=checked.products.find(p=>p.id===product.id);
       if(checked.version!==result.version||!actual||
          (scoped?
           !actual.enabled||!new Set(Object.hasOwn(checked.partnerOverrides||{},partnerCompanyId)?
            checked.partnerOverrides[partnerCompanyId]:
            checked.products.filter(p=>p.enabled).map(p=>p.id)).has(product.id):
           !actual.enabled))fail();
       expected=result.version;saved++;
      }
     }catch{failed=true;}
     finally{
      busy=false;
      if(!closed&&auth.currentUser===identity){
       const done=await refresh();
       if(done&&!closed&&auth.currentUser===identity)
        status(failed?
         "一括ONは途中で停止しました。保存確認済み"+saved+
          "件。残りは最新の状態から設定してください。":
         "対象商材"+saved+"件のONを保存・再確認しました。");
      }
     }
    });
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
