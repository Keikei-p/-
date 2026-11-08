/**
 * STAGING ONLY / NOT INCLUDED IN PRODUCTION HOSTING.
 * Mobile-first owner settings for independently approved combined ranking.
 * All information arrives from a trusted server status API.
 * The browser NEVER writes Firestore directly and never stores credentials,
 * IDs, decisions, private counts or financial originals in web storage.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONEY=/(?:売上|単価|報酬|利益|キャッシュバック|[¥￥$€]|(?:CB|revenue|cashback)\s*[:=_-]?\s*[0-9０-９]|\d[\d,.]*円)/i;
const fail=()=>{throw Error("公開設定を安全に確認できません。再読み込みしてください。");};
const validLabel=x=>typeof x==="string"&&x.trim().length>0&&x.length<=80&&!MONEY.test(x);
export function validateOwnerRankingConsentStatus(value){
 if(!value||typeof value!=="object"||
    Object.keys(value).sort().join("|")!==
    ["schema","role","partners"].sort().join("|")||
    value.schema!=="nico-ranking-owner-consent-v1"||
    !["hub_owner","partner_owner"].includes(value.role)||
    !Array.isArray(value.partners)||value.partners.length>100)fail();
 const seen=new Set();
 for(const row of value.partners){
  if(!row||typeof row!=="object"||Array.isArray(row)||
     Object.keys(row).sort().join("|")!==
     ["partnerCompanyId","companyName","ownApproved","otherApproved","version","canEdit"].sort().join("|")||
     !ID.test(row.partnerCompanyId)||
     seen.has(row.partnerCompanyId)||!validLabel(row.companyName)||
     typeof row.ownApproved!=="boolean"||
     typeof row.otherApproved!=="boolean"||
     typeof row.canEdit!=="boolean"||
     !Number.isSafeInteger(row.version)||row.version<0||row.version>999||
     value.role==="partner_owner"&&value.partners.length!==1)fail();
  seen.add(row.partnerCompanyId);
 }
 return value;
}
const el=(doc,tag,cls,txt)=>{
 const e=doc.createElement(tag);e.className=cls;
 if(txt!==undefined)e.textContent=txt;
 return e;
};
/**
 * loadStatus() -> validated server status, saveConsent({partnerCompanyId,
 * enable,expectedVersion}) -> {saved,partnerCompanyId,enabled,version}.
 * Both callbacks MUST use the real verified Firebase user on the server.
 * No automatic retry for writes. A failure clears all previously shown data.
 */
export function createOwnerRankingConsentPanel({
 document,root,loadStatus,saveConsent
}={}){
 if(!document||typeof document.createElement!=="function"||
    !root||typeof root.replaceChildren!=="function"||
    typeof loadStatus!=="function"||typeof saveConsent!=="function")fail();
 let busy=false,closed=false,renderVersion=0;
 const empty=()=>root.replaceChildren();
 const message=x=>{
  empty();root.appendChild(el(document,"p","ranking-owner-alert",x));
 };
 const secureClear=()=>message("公開設定を確認できません。再読み込みしてください。");
 const refresh=async()=>{
  if(closed||busy)return false;
  const current=++renderVersion;
  empty();
  try{
   const data=validateOwnerRankingConsentStatus(await loadStatus());
   if(closed||current!==renderVersion)return false;
   const view=el(document,"section","ranking-owner-settings");
   view.appendChild(el(document,"h2","ranking-owner-title","合同ランキングの公開設定"));
   view.appendChild(el(document,"p","ranking-owner-caption",
    "金額・単価・キャッシュバックは公開されません。公開には両社の承認が必要です。"));
   if(!data.partners.length)
    view.appendChild(el(document,"p","ranking-owner-empty","公開対象の協力店はありません。"));
   for(const item of data.partners){
    const section=el(document,"section","ranking-owner-company");
    section.appendChild(el(document,"h3","ranking-owner-company-name",item.companyName));
    const state=item.ownApproved&&item.otherApproved?"両社承認済み":
     item.ownApproved?"自社承認済み・相手の承認待ち":
     item.otherApproved?"相手の承認済み・自社の承認待ち":"両社未承認";
    section.appendChild(el(document,"p","ranking-owner-state",state));
    section.appendChild(el(document,"p","ranking-owner-meta",
     data.role==="hub_owner"?"自社の公開承認を変更します。":"協力店側の公開承認を変更します。"));
    const control=el(document,"label","ranking-owner-confirm");
    const agree=el(document,"input","ranking-owner-checkbox");
    agree.type="checkbox";agree.checked=false;agree.disabled=!item.canEdit||item.ownApproved;
    control.appendChild(agree);
    control.appendChild(el(document,"span","ranking-owner-confirm-label",
     "個人名・班名を両社ランキングに表示することを理解しています"));
    if(!item.ownApproved)section.appendChild(control);
    const button=el(document,"button","ranking-owner-save",
     item.ownApproved?"公開承認を取り消す":"この会社の公開を承認する");
    button.type="button";button.disabled=!item.canEdit||
       (!item.ownApproved&&!agree.checked);
    if(!item.ownApproved&&item.canEdit)
      agree.addEventListener("change",()=>{button.disabled=!agree.checked||busy;});
    button.addEventListener("click",async()=>{
      if(closed||busy||!item.canEdit||button.disabled||
         (!item.ownApproved&&!agree.checked))return;
      busy=true;button.disabled=true;const next=!item.ownApproved;
      const previousVersion=item.version;
      try{
       const saved=await saveConsent({
        partnerCompanyId:item.partnerCompanyId,enable:next,
        expectedVersion:previousVersion
       });
       if(!saved||saved.partnerCompanyId!==item.partnerCompanyId||
          saved.enabled!==next||
          typeof saved.saved!=="boolean"||
          !Number.isSafeInteger(saved.version)||
          saved.version!==(saved.saved?previousVersion+1:previousVersion))fail();
       busy=false;const ok=await refresh();
       if(!ok)fail();
      }catch{
       busy=false;renderVersion++;secureClear();
      }
    });
    section.appendChild(button);view.appendChild(section);
   }
   root.replaceChildren(view);return true;
  }catch{
   if(!closed&&current===renderVersion)secureClear();
   return false;
  }
 };
 return Object.freeze({
  refresh,
  destroy(){closed=true;renderVersion++;empty();}
 });
}
