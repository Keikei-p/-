/**
 * Hub Owner-only shared eight-tab publication settings.
 * Reuses PR #802's existing callable contract, no Firestore client access.
 * Never mounts or calls a disabled server before security review.
 */
import {PARTNER_OPTIONAL_TABS,readVerifiedPartnerTabPolicy,
 prepareOwnerTabPublication} from "./partner-tab-visibility-policy.mjs";

const stop=()=>{throw Error("OWNER_PARTNER_TABS_UNAVAILABLE");};
const LABEL="協力店へのタブ公開設定";
const safeOwner=(auth,canOwner,identity)=>Boolean(
 identity&&auth?.currentUser===identity&&identity.emailVerified===true&&
 typeof canOwner==="function"&&canOwner()===true
);
const serverShape=payload=>{
 if(!payload||typeof payload!=="object"||Array.isArray(payload))stop();
 if(Object.keys(payload).some(x=>!["schema","revision","published","tabs","saved"].includes(x)))
  stop();
 if(Object.hasOwn(payload,"saved")&&typeof payload.saved!=="boolean")stop();
 return readVerifiedPartnerTabPolicy({
  schema:payload.schema,revision:payload.revision,published:payload.published,
  tabs:payload.tabs
 });
};
export function buildOwnerPartnerTabSaveRequest(serverPolicy,selected,open=true){
 const baseline=readVerifiedPartnerTabPolicy(serverPolicy);
 if(typeof open!=="boolean")stop();
 const checked=prepareOwnerTabPublication(open?selected:[],baseline.revision);
 return Object.freeze({
  expectedRevision:checked.expectedRevision,
  published:open,tabs:open?[...checked.tabs]:[]
 });
}
export function mountOwnerPartnerTabSettingsPanel({
 enabled=false,serverGuardVerified=false,root,auth,functions,
 httpsCallable,canOwner
}={}){
 if(!root||typeof root.replaceChildren!=="function"||
    !root.ownerDocument||typeof root.ownerDocument.createElement!=="function"||
    !auth||typeof httpsCallable!=="function"||
    typeof canOwner!=="function")stop();
 const doc=root.ownerDocument;
 const el=(tag,cls,txt)=>{
  const node=doc.createElement(tag);
  if(cls)node.className=cls;
  if(txt!==undefined)node.textContent=txt;
  return node;
 };
 const shell=el("section","p-inline-card");
 const heading=el("h3",null,"📋 "+LABEL);
 const desc=el("p","p-inline-muted",
  "公開対象は協力店全社で共通です。実績入力は常に残ります。金額・単価・CBは公開できません。");
 const status=el("p","p-inline-muted","設定APIの公開審査前です。");
 status.setAttribute("role","status");status.setAttribute("aria-live","polite");
 const grid=el("div","p-inline-grid");
 const options=PARTNER_OPTIONAL_TABS.map(opt=>{
  const label=el("label","p-inline-field");
  const checkbox=el("input");
  checkbox.type="checkbox";checkbox.value=opt.id;checkbox.disabled=true;
  label.append(checkbox,doc.createTextNode(" "+opt.label));
  grid.append(label);
  return {id:opt.id,checkbox};
 });
 const buttons=el("div","p-inline-actions");
 const reload=el("button","team-action-button","最新の公開設定を取得");
 const save=el("button","team-action-button","選択したタブを全社へ公開");
 const close=el("button","team-action-button","8タブをすべて非公開");
 for(const b of [reload,save,close]){b.type="button";b.disabled=true;buttons.append(b);}
 shell.append(heading,desc,status,grid,buttons);root.replaceChildren(shell);
 let state=null,generation=0,busy=false,destroyed=false;
 const active=(identity,seq)=>!destroyed&&seq===generation&&
  safeOwner(auth,canOwner,identity);
 const ready=()=>state!==null&&!busy&&
  safeOwner(auth,canOwner,auth.currentUser);
 const message=txt=>{status.textContent=txt;};
 const enable=()=>{const okay=ready();
  for(const {checkbox} of options)checkbox.disabled=!okay;
  for(const b of [reload,save,close])b.disabled=!okay;
 };
 async function refresh(){
  if(!enabled||!serverGuardVerified){
   message("公開設定APIが未承認のため保存できません。");
   return false;
  }
  const identity=auth.currentUser,seq=++generation;
  state=null;enable();
  if(!active(identity,seq)){message("自社Ownerでログインしてください。");return false;}
  busy=true;enable();message("公開設定を読み込み中…");
  try{
   const reply=await httpsCallable(functions,"getOwnerPartnerTabPublication")({});
   if(!active(identity,seq))return false;
   const verified=serverShape(reply?.data);
   state=verified;
   options.forEach(({id,checkbox})=>checkbox.checked=verified.tabs.includes(id));
   message(verified.published?"公開設定を確認しました（改訂"+verified.revision+"）":
    "現在8タブは非公開です（改訂"+verified.revision+"）。");
   return true;
  }catch{
   if(active(identity,seq))message("設定の取得に失敗。Owner権限・通信を確認してください。");
   return false;
  }finally{
   if(seq===generation){busy=false;enable();}
  }
 }
 async function persist(open){
  if(!ready())return false;
  const identity=auth.currentUser,seq=++generation;
  const source=state;
  const selected=options.filter(x=>x.checkbox.checked).map(x=>x.id);
  let payload;
  try{payload=buildOwnerPartnerTabSaveRequest(source,selected,open);}
  catch{message("保存内容を検証できません。");return false;}
  busy=true;enable();message("公開設定を保存中…");
  try{
   const reply=await httpsCallable(functions,"setOwnerPartnerTabPublication")(payload);
   if(!active(identity,seq))return false;
   const data=reply?.data,verified=serverShape(data);
   if(typeof data.saved!=="boolean"||
      verified.revision!==source.revision+(data.saved?1:0)||
      verified.published!==payload.published||
      verified.tabs.join("|")!==payload.tabs.join("|"))stop();
   state=verified;
   options.forEach(({id,checkbox})=>checkbox.checked=verified.tabs.includes(id));
   message(open?"協力店全社への公開設定を保存しました。":
    "協力店全社の8タブを非公開にしました。");
   return true;
  }catch{
   if(active(identity,seq))message("公開設定の保存に失敗。再取得してから確認してください。");
   state=null;
   return false;
  }finally{
   if(seq===generation){busy=false;enable();}
  }
 }
 reload.onclick=()=>{void refresh();};
 save.onclick=()=>{void persist(true);};
 close.onclick=()=>{void persist(false);};
 const released=enabled===true&&serverGuardVerified===true;
 if(released)message("Ownerの公開設定を読み込んでください。");
 return Object.freeze({
  refresh,persist,
  destroy(){generation++;destroyed=true;state=null;enable();root.replaceChildren();},
  get ready(){return released&&ready();},
  get policy(){return state?Object.freeze({...state,tabs:[...state.tabs]}):null;}
 });
}
