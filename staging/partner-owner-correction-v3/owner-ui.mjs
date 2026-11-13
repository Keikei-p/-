/**
 * STAGING ONLY. Simple count-only, phone-first owner correction panel.
 * Does not import Firebase or attach to the current production page.
 * Caller must bind list/correct to server-authorized owner endpoints.
 */
export const COUNT_KEYS=Object.freeze([
 "NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"
]);
export const SB_PARTS=Object.freeze(["SB光","SB AIR","旧未分類"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/(?:単価|売上|収益|利益|報酬|原価|価格|キャッシュバック|cash\s*back|revenue|unit\s*price|commission|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9][0-9,.]*\s*(?:万|千)?円)/i;
const VALID_COUNT=/^(?:0|[1-9][0-9]{0,3})$/;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const sum=x=>Object.values(x).reduce((n,y)=>n+y,0);

export function verifiedCount(value){
 const raw=typeof value==="number"?String(value):value;
 if(typeof raw!=="string"||!VALID_COUNT.test(raw))throw Error("INVALID_COUNT");
 return Number(raw);
}

export function normalizedSplit(combined,raw){
 const n=verifiedCount(combined);
 if(raw==null)return {"SB光":0,"SB AIR":0,"旧未分類":n};
 if(!object(raw)||Object.keys(raw).sort().join("|")!==SB_PARTS.slice().sort().join("|"))
  throw Error("INVALID_SB_SPLIT");
 const parts=Object.fromEntries(SB_PARTS.map(p=>[p,verifiedCount(raw[p])]));
 if(sum(parts)!==n)throw Error("SB_SPLIT_MISMATCH");
 return parts;
}

export function correctionPayload({
 date,partnerCompanyId,previous,draftCounts,draftSb,correctionReason
}){
 if(!DATE.test(date)||!ID.test(partnerCompanyId||"")||
  !previous||!ID.test(previous.staffId||"")||
  !Number.isSafeInteger(previous.version)||previous.version<1||
  !object(draftCounts)||Object.keys(draftCounts).sort().join("|")!==
   COUNT_KEYS.slice().sort().join("|"))
  throw Error("INVALID_CORRECTION_SCOPE");
 const reason=typeof correctionReason==="string"?correctionReason.trim():"";
 if(reason.length<6||reason.length>120||/[\r\n]/.test(reason)||MONEY.test(reason.normalize("NFKC")))
  throw Error("INVALID_CORRECTION_REASON");
 const counts=Object.fromEntries(COUNT_KEYS.map(k=>[k,verifiedCount(draftCounts[k])]));
 const sbBreakdown=normalizedSplit(counts["SB光・AIR"],draftSb);
 const oldCounts=Object.fromEntries(COUNT_KEYS.map(k=>
  [k,verifiedCount(previous.counts?.[k])]));
 const oldSb=normalizedSplit(oldCounts["SB光・AIR"],previous.sbBreakdown);
 const changed=COUNT_KEYS.some(k=>counts[k]!==oldCounts[k])||
   SB_PARTS.some(k=>sbBreakdown[k]!==oldSb[k]);
 if(!changed)throw Error("NO_CHANGES");
 return {date,partnerCompanyId,staffId:previous.staffId,
  expectedVersion:previous.version,counts,sbBreakdown,correctionReason:reason};
}

export function verifyCorrectionReadback(saved,requested,lookup){
 if(saved?.saved!==true||saved?.scope!=="hub-owner-existing-only"||
  saved?.partnerCompanyId!==requested.partnerCompanyId||
  saved?.staffId!==requested.staffId||saved?.date!==requested.date||
  saved?.version!==requested.expectedVersion+1||
  lookup?.role!=="hub"||
  lookup?.scope!=="existing-partner-counts-only"||
  lookup?.partnerCompanyId!==requested.partnerCompanyId||
  lookup?.date!==requested.date||!Array.isArray(lookup.entries))
  return false;
 const row=lookup.entries.find(x=>x.staffId===requested.staffId);
 if(!row||row.version!==saved.version||row.totalCount!==sum(requested.counts))
  return false;
 try{
  for(const k of COUNT_KEYS)if(row.counts?.[k]!==requested.counts[k])return false;
  const split=normalizedSplit(row.counts["SB光・AIR"],row.sbBreakdown);
  for(const k of SB_PARTS)if(split[k]!==requested.sbBreakdown[k])return false;
 }catch{return false;}
 return true;
}

export function mountOwnerCorrection({
 root,companies,api,dateGetter,confirmChange,onVerifiedSave=()=>{},
 preferredCompanyId="",canCorrect=()=>true,dom=document
}){
 if(!root||!dom||!Array.isArray(companies)||!api||
  typeof api.list!=="function"||typeof api.correct!=="function"||
  typeof dateGetter!=="function"||typeof confirmChange!=="function"||
  typeof onVerifiedSave!=="function"||typeof canCorrect!=="function")
  throw Error("MISSING_OWNER_UI_DEPENDENCY");
 const allowed=companies.filter(x=>x.active===true&&ID.test(x.partnerCompanyId||"")&&
  typeof x.name==="string"&&!MONEY.test(x.name.normalize("NFKC")));
 const el=(tag,cls,text)=>{
  const node=dom.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
 };
 const wrap=el("section","nico-owner-count-panel");
 wrap.style.cssText="display:grid;gap:12px;padding:14px;max-width:780px;margin:auto;border:1px solid #dce4ef;border-radius:14px;background:white;color:#223146";
 const heading=el("h2","", "協力店の件数を訂正（自社オーナー専用）");
 heading.style.margin="0";
 const description=el("p","", "自社の金額情報は扱いません。登録済みの件数だけを確認・訂正します。訂正履歴は消えません。");
 const companyLabel=el("label","", "協力店を選択");
 const companySelect=el("select");
 companySelect.setAttribute("aria-label","協力店を選択");
 companySelect.style.cssText="width:100%;min-height:44px";
 const initial=el("option","", "協力店を選択");initial.value="";
 companySelect.append(initial);
 for(const item of allowed){const option=el("option","",item.name);option.value=item.partnerCompanyId;
  companySelect.append(option)}
 const loadButton=el("button","","この会社の登録済み件数を読む");
 const staffLabel=el("label","","担当者を選択");
 const staffSelect=el("select");staffSelect.style.cssText="width:100%;min-height:44px";
 const fields=el("div","");fields.style.cssText="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:9px";
 const sbFields=el("div","");sbFields.style.cssText="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px";
 const reasonLabel=el("label","","訂正理由（6〜120文字）");
 const reason=el("textarea");reason.rows=2;reason.maxLength=120;
 reason.style.cssText="width:100%;min-height:62px";
 const saveButton=el("button","","変更内容を確認して保存");
 const status=el("p","","協力店を選んでください。");
 status.setAttribute("role","status");status.setAttribute("aria-live","polite");
 const editor=el("div");editor.hidden=true;editor.style.cssText="display:grid;gap:10px";
 const gridInputs={},sbInputs={};
 for(const key of COUNT_KEYS){
  const l=el("label","",key),input=el("input");
  input.type="number";input.min="0";input.max="9999";input.step="1";input.inputMode="numeric";
  input.setAttribute("aria-label",key+"の件数");input.style.cssText="width:100%;min-height:44px";
  gridInputs[key]=input;l.append(input);fields.append(l);
 }
 for(const key of SB_PARTS){
  const l=el("label","",key),input=el("input");
  input.type="number";input.min="0";input.max="9999";input.step="1";input.inputMode="numeric";
  input.setAttribute("aria-label",key+"の件数");input.style.cssText="width:100%;min-height:44px";
  sbInputs[key]=input;l.append(input);sbFields.append(l);
 }
 const hint=el("p","", "光とAIRは現在も旧合算で管理しています。内訳の分離は後日の正式承認まで行いません。旧未分類の件数は「SB光・AIR」に一致します。");
 editor.append(staffLabel,staffSelect,fields,hint,sbFields,reasonLabel,reason,saveButton);
 const companyShortcuts=el("div","nico-owner-company-shortcuts");
 companyShortcuts.style.cssText="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px";
 const companyButtons=new Map();
 for(const company of allowed){
  const button=el("button","",company.name+" の件数");
  button.type="button";
  button.style.cssText="min-height:48px;border-radius:11px;padding:10px 12px;border:1px solid #bfd3e8;background:#eef6ff;color:#164678;font-weight:750;text-align:left";
  button.setAttribute("aria-label",company.name+" の件数を開く");
  companyButtons.set(company.partnerCompanyId,button);
  companyShortcuts.append(button);
 }
 const shortcutHint=el("p","", "会社ボタンから直接件数を開けます。毎回協力店アカウントにログインし直す必要はありません。");
 shortcutHint.style.cssText="font-size:12px;color:#586e89;margin:0";
 wrap.append(heading,description,companyLabel,companySelect,loadButton,editor,status,shortcutHint,companyShortcuts);
 root.replaceChildren(wrap);
 let current=null,selected=null,busy=false,epoch=0,destroyed=false;
 const setStatus=t=>{if(!destroyed)status.textContent=t};
 const lock=value=>{
  busy=value;companySelect.disabled=value;loadButton.disabled=value;
  staffSelect.disabled=value;saveButton.disabled=value||canCorrect()!==true;
  saveButton.textContent=canCorrect()===true?"変更内容を確認して保存":"件数訂正は停止中";
  reason.disabled=value||canCorrect()!==true;
  for(const button of companyButtons.values())button.disabled=value;
  for(const input of Object.values(gridInputs))
   input.disabled=value||canCorrect()!==true;
  // Splitting old combined 光/AIR figures is explicitly deferred. These
  // fields are display-only, even after enabling Owner count corrections.
  for(const input of Object.values(sbInputs))input.disabled=true;
 };
 function redraw(){
  selected=current?.entries.find(x=>x.staffId===staffSelect.value)||null;
  editor.hidden=!selected;
  if(!selected)return;
  for(const key of COUNT_KEYS)gridInputs[key].value=String(selected.counts[key]);
  const split=normalizedSplit(selected.counts["SB光・AIR"],selected.sbBreakdown);
  for(const key of SB_PARTS)sbInputs[key].value=String(split[key]);
  reason.value="";
  setStatus(selected.staffName+"｜第"+selected.version+"版。"+
   (canCorrect()===true?"保存すると履歴に訂正が追加されます。":
    "件数確認のみ利用できます。訂正機能は停止中です。"));
 }
 async function load(){
  if(busy||destroyed)return;
  const id=companySelect.value,day=dateGetter(),sequence=++epoch;
  current=null;selected=null;editor.hidden=true;staffSelect.replaceChildren();
  if(!allowed.some(x=>x.partnerCompanyId===id)||!DATE.test(day)){
   setStatus("有効な会社と日付を選んでください。");return;
  }
  lock(true);setStatus("件数を読み込んでいます…");
  try{
   const data=await api.list({date:day,partnerCompanyId:id});
   if(destroyed||sequence!==epoch)return;
   if(data?.role!=="hub"||data?.scope!=="existing-partner-counts-only"||
     data.partnerCompanyId!==id||data.date!==day||!Array.isArray(data.entries))
    throw Error("OWNER_LIST_UNVERIFIED");
   for(const row of data.entries){
    if(!ID.test(row.staffId||"")||!Number.isSafeInteger(row.version)||
     !object(row.counts)||!Number.isSafeInteger(row.totalCount))
      throw Error("OWNER_ROW_UNVERIFIED");
    const calculated=COUNT_KEYS.reduce((n,k)=>n+verifiedCount(row.counts[k]),0);
    if(calculated!==row.totalCount)throw Error("OWNER_ROW_TOTAL_UNVERIFIED");
    normalizedSplit(row.counts["SB光・AIR"],row.sbBreakdown);
   }
   if(dateGetter()!==day||companySelect.value!==id)return;
   current=data;
   for(const row of data.entries){
    const option=el("option","",row.staffName+"｜第"+row.version+"版");
    option.value=row.staffId;staffSelect.append(option);
   }
   if(data.entries.length===0)setStatus("この日に登録済みの担当者はありません。未報告を0件として扱いません。");
   else redraw();
  }catch{
   if(sequence===epoch)setStatus("件数の読み込みと本人権限の検証に失敗しました。訂正はできません。");
  }finally{if(sequence===epoch)lock(false)}
 }
 async function save(){
  if(busy||destroyed||!selected||!current)return;
  if(canCorrect()!==true){
   setStatus("件数確認のみ利用できます。訂正機能は停止中です。");return;
  }
  const id=companySelect.value,day=dateGetter();
  if(id!==current.partnerCompanyId||day!==current.date){
   setStatus("会社または日付が変わりました。最新件数を再取得してください。");return;
  }
  let req;
  try{
   req=correctionPayload({
    date:day,partnerCompanyId:id,previous:selected,
    draftCounts:Object.fromEntries(COUNT_KEYS.map(k=>[k,gridInputs[k].value])),
    draftSb:{"SB光":"0","SB AIR":"0",
     "旧未分類":gridInputs["SB光・AIR"].value},
    correctionReason:reason.value
   });
  }catch(err){
   setStatus(err.message==="NO_CHANGES"?"変更がありません。":"件数・光/AIR内訳・訂正理由を確認してください。");return;
  }
  const summary=selected.staffName+"（第"+selected.version+"版）\n変更後合計："+
   sum(req.counts)+"件\n光："+req.sbBreakdown["SB光"]+"、AIR："+req.sbBreakdown["SB AIR"]+
   "、旧未分類："+req.sbBreakdown["旧未分類"]+"\nこの内容で訂正履歴を残しますか？";
  if(!confirmChange(summary))return;
  lock(true);setStatus("訂正を保存・再照合しています…");
  try{
   const saved=await api.correct(req);
   const latest=await api.list({date:day,partnerCompanyId:id});
   if(destroyed)return;
   if(!verifyCorrectionReadback(saved,req,latest))
    throw Error("READBACK_UNVERIFIED");
   if(companySelect.value!==id||dateGetter()!==day)
    throw Error("STALE_SCOPE");
   // The server write and versioned readback are confirmed. Refresh the
   // ranking cache only now, without retrying an already-committed write.
   let rankingRefreshed=true;
   try{
    await onVerifiedSave(Object.freeze({
     date:day,partnerCompanyId:id,staffId:req.staffId,version:saved.version
    }));
   }catch{rankingRefreshed=false}
   if(destroyed)return;
   if(companySelect.value!==id||dateGetter()!==day)
    throw Error("STALE_SCOPE");
   current=latest;staffSelect.replaceChildren();
   for(const row of latest.entries){
    const option=el("option","",row.staffName+"｜第"+row.version+"版");
    option.value=row.staffId;staffSelect.append(option);
   }
   staffSelect.value=req.staffId;redraw();
   reason.value="";setStatus(rankingRefreshed?
    "保存・再照合完了：第"+saved.version+"版。訂正履歴が追加されました。":
    "保存・再照合完了：第"+saved.version+"版。ランキングは未更新のため、画面を再読み込みしてください。");
  }catch{
   current=null;selected=null;editor.hidden=true;staffSelect.replaceChildren();
   setStatus("保存結果を確定できません。二重登録防止のため再送せず、最新件数を読み直してください。");
  }finally{lock(false)}
 }
 function selectCompany(id){
  if(busy||destroyed)return false;
  if(!allowed.some(x=>x.partnerCompanyId===id))return false;
  companySelect.value=id;
  // Company switching always re-reads server-authorized counts. Neither
  // counts nor security roles are cached across company selection.
  void load();
  return true;
 }
 for(const [id,button] of companyButtons)
  button.addEventListener("click",()=>{selectCompany(id)});
 companySelect.addEventListener("change",()=>{
  epoch++;current=null;selected=null;editor.hidden=true;staffSelect.replaceChildren();
  setStatus("会社を変更しました。最新の件数を読み込んでいます…");
  if(allowed.some(x=>x.partnerCompanyId===companySelect.value))void load();
 });
 if(allowed.some(x=>x.partnerCompanyId===preferredCompanyId))
  companySelect.value=preferredCompanyId;
 staffSelect.addEventListener("change",redraw);
 loadButton.addEventListener("click",()=>{void load()});
 saveButton.addEventListener("click",()=>{void save()});
 return Object.freeze({
  load,save,selectCompany,
  destroy(){
   destroyed=true;epoch++;root.replaceChildren();
   current=null;selected=null;
  }
 });
}
