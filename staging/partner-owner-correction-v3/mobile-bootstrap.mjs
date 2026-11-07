/**
 * STAGING ONLY / NO DEPLOY.
 * Combines an already authenticated hub workspace discovery call with the
 * count-only client bridge and the mobile owner correction panel.
 * Do NOT put this into production Hosting until independent real-account
 * finance GET/LIST denial, working count API and billing approvals exist.
 */
import {makeOwnerCorrectionClient} from "./owner-client.mjs";
import {mountOwnerCorrection} from "./owner-ui.mjs";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/(?:単価|売上|収益|利益|報酬|[¥￥$€]|\d[\d,]*円)/;
const invalid=(code="UNVERIFIED")=>{throw Error("OWNER_CORRECTION_BOOT_"+code)};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const validDate=x=>typeof x==="string"&&DATE.test(x)&&
 !Number.isNaN(Date.parse(x+"T00:00:00Z"))&&
 new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
const validId=x=>typeof x==="string"&&ID.test(x);
const exactKeys=(value,list)=>object(value)&&
 Object.keys(value).sort().join("|")===list.slice().sort().join("|");
const safeLabel=x=>typeof x==="string"&&x.length>0&&x.length<=80&&
 x.trim()===x&&!MONEY.test(x);
const ROOT_FIELDS=[
 "role","date","partners","registeredCompanies","categories",
 "sbBreakdownSchema","partnerTeamDetails","teamReports","teamStatusComplete"
];
const COMPANY_FIELDS=["partnerCompanyId","name","active","teams"];

export function countOnlyRegisteredCompanies(raw,date){
 if(!object(raw)||raw.role!=="hub"||raw.date!==date||
    !Array.isArray(raw.registeredCompanies)||
    raw.registeredCompanies.length>100||
    Object.keys(raw).some(k=>!ROOT_FIELDS.includes(k)))
  invalid("WORKSPACE_UNVERIFIED");
 const output=[],seen=new Set();
 for(const c of raw.registeredCompanies){
  if(!exactKeys(c,COMPANY_FIELDS)||!validId(c.partnerCompanyId)||
     !safeLabel(c.name)||typeof c.active!=="boolean"||
     !Array.isArray(c.teams)||c.teams.length>150||
     !c.teams.every(t=>exactKeys(t,["id","name"])&&
      validId(t.id)&&safeLabel(t.name))||
     seen.has(c.partnerCompanyId))
   invalid("COMPANY_UNVERIFIED");
  seen.add(c.partnerCompanyId);
  // Retain only count-scope fields. Team details, financial originals and
  // arbitrary response extensions never reach the editable panel.
  output.push(Object.freeze({
   partnerCompanyId:c.partnerCompanyId,name:c.name,active:c.active
  }));
 }
 return Object.freeze(output);
}

export async function mountVerifiedOwnerCorrection({
 root,auth,workspaceCallable,listCallable,correctCallable,
 dateGetter,confirmChange,subscribeAuth,enabled=()=>false,dom
}={}){
 if(!root||!auth||typeof workspaceCallable!=="function"||
    typeof listCallable!=="function"||typeof correctCallable!=="function"||
    typeof dateGetter!=="function"||typeof confirmChange!=="function"||
    typeof subscribeAuth!=="function"||
    typeof enabled!=="function"||!dom)
  invalid("DEPENDENCIES");
 if(enabled()!==true)invalid("DISABLED");
 const owner=auth.currentUser,day=dateGetter();
 if(!owner||!validId(owner.uid)||owner.emailVerified!==true||
    typeof owner.email!=="string"||!validDate(day))
  invalid("SESSION_UNVERIFIED");
 let result;
 try{result=await workspaceCallable({date:day})}
 catch{invalid("DISCOVERY_UNAVAILABLE")}
 if(enabled()!==true||auth.currentUser!==owner||
    auth.currentUser?.emailVerified!==true||dateGetter()!==day)
  invalid("STALE_SESSION");
 const companies=countOnlyRegisteredCompanies(result?.data,day);
 const client=makeOwnerCorrectionClient({
  auth,listCallable,correctCallable,enabled
 });
 if(enabled()!==true||auth.currentUser!==owner||dateGetter()!==day){
  client.dispose();invalid("STALE_SESSION");
 }
 try{
  const panel=mountOwnerCorrection({
   root,companies,api:client,dateGetter,confirmChange,dom
  });
  let destroyed=false,unsubscribe=()=>{},listenerReady=false;
  const destroy=()=>{
   if(destroyed)return;
   destroyed=true;
   client.dispose();
   panel.destroy();
   if(listenerReady)unsubscribe();
  };
  // Firebase onAuthStateChanged must be injected by the caller. Clearing
  // an already-rendered count panel is essential: rejecting *new* requests
  // alone cannot prevent a later user viewing the previous owner's counts.
  let cancel;
  try{
   cancel=subscribeAuth(user=>{
    if(destroyed)return;
    if(user!==owner||user?.emailVerified!==true||
       enabled()!==true)destroy();
   });
  }catch{destroy();invalid("AUTH_LISTENER_UNVERIFIED")}
  if(typeof cancel!=="function"){
   destroy();invalid("AUTH_LISTENER_UNVERIFIED");
  }
  unsubscribe=cancel;listenerReady=true;
  if(destroyed)unsubscribe();
  return Object.freeze({
   companies,load:panel.load,save:panel.save,destroy
  });
 }catch(error){
  client.dispose();
  root.replaceChildren();
  if(error?.message==="OWNER_CORRECTION_BOOT_AUTH_LISTENER_UNVERIFIED")
   throw error;
  invalid("PANEL_UNVERIFIED");
 }
}
