/**
 * STAGING ONLY / NO HOSTING RELEASE.
 * Callable bridge for the existing NICO Firebase email-login session.
 * No direct Firestore, localStorage, sessionStorage or unauthenticated GET.
 * A company-code shared account and active secondary user MUST NOT use this.
 * The SERVER repeats revoked token, owner, membership and consent checks.
 */
import {validateOwnerRankingConsentStatus} from "./owner-ranking-consent-panel.mjs";
const BAD=()=>{throw Error("公開設定の認証が確認できません。ログインし直してください。");};
const ID=/^[A-Za-z0-9_-]{1,128}$/;
export function createRankingOwnerFirebaseBridge({
 auth,functions,httpsCallable,sharedCodeSession=()=>false
}={}){
 if(!auth||!functions||typeof httpsCallable!=="function"||
    typeof sharedCodeSession!=="function")BAD();
 const statusCall=httpsCallable(functions,"getRankingOwnerConsentStatus");
 const saveCall=httpsCallable(functions,"setRankingOwnerConsent");
 if(typeof statusCall!=="function"||typeof saveCall!=="function")BAD();
 const verify=async()=>{
  if(sharedCodeSession()===true)BAD();
  const current=auth.currentUser;
  if(!current||!ID.test(current.uid||"")||
     current.emailVerified!==true||
     typeof current.getIdToken!=="function")BAD();
  try{await current.getIdToken();}catch{BAD();}
  if(auth.currentUser!==current||sharedCodeSession()===true)BAD();
  return current;
 };
 const loadStatus=async()=>{
  const user=await verify();
  let response;
  try{response=await statusCall({});}catch{BAD();}
  if(auth.currentUser!==user||sharedCodeSession()===true)BAD();
  return validateOwnerRankingConsentStatus(response?.data);
 };
 const saveConsent=async input=>{
  if(!input||typeof input!=="object"||Array.isArray(input)||
     Object.keys(input).sort().join("|")!==
     ["partnerCompanyId","enable","expectedVersion"].sort().join("|")||
     !ID.test(input.partnerCompanyId||"")||
     typeof input.enable!=="boolean"||
     !Number.isSafeInteger(input.expectedVersion)||
     input.expectedVersion<0||input.expectedVersion>998)BAD();
  const user=await verify();
  let response;
  try{
   response=await saveCall({
    partnerCompanyId:input.partnerCompanyId,
    enable:input.enable,expectedVersion:input.expectedVersion
   });
  }catch{BAD();}
  if(auth.currentUser!==user||sharedCodeSession()===true)BAD();
  const r=response?.data;
  if(!r||typeof r!=="object"||Array.isArray(r)||
     Object.keys(r).sort().join("|")!==
      ["saved","partnerCompanyId","enabled","version"].sort().join("|")||
     typeof r.saved!=="boolean"||
     r.partnerCompanyId!==input.partnerCompanyId||
     r.enabled!==input.enable||
     !Number.isSafeInteger(r.version)||
     r.version!==(r.saved?input.expectedVersion+1:input.expectedVersion))BAD();
  return {
   saved:r.saved,partnerCompanyId:r.partnerCompanyId,
   enabled:r.enabled,version:r.version
  };
 };
 return Object.freeze({loadStatus,saveConsent});
}
