/**
 * STAGING / NO DEPLOY. Four additional optional partner count panels.
 * The callable separately proves Owner publication+membership+original count
 * fields in the SAME read-only Firestore transaction. The browser never
 * fetches audit history via getPartnerWorkspace or uses cached day totals.
 */
const SCHEMA="nico-published-partner-optional-v1";
const TABS=new Set(["report","daily","history","goal"]);
const DAY=/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const MONEY=/(?:売上|単価|収益|利益|報酬|原価|価格|キャッシュバック|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:円|万円)|revenue|unit[\s_-]*price|cash[\s_-]*back)/i;
const stop=()=>{throw Error("PARTNER_OPTIONAL_TAB_RESPONSE_UNVERIFIED");};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const count=n=>Number.isSafeInteger(n)&&n>=0;
const label=x=>typeof x==="string"&&x.trim().length>0&&x.length<=150&&
 !MONEY.test(x.normalize("NFKC"))&&!/[\r\n\t\u0000-\u001f\u007f]/.test(x);
const validDate=x=>typeof x==="string"&&DAY.test(x)&&
 !Number.isNaN(Date.parse(x+"T00:00:00Z"))&&
 new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
function counts(x){
 return exact(x,KEYS)&&KEYS.every(k=>count(x[k])&&x[k]<=9999);
}
export function verifyPartnerOptionalTabData(data,{tab,date}={}){
 if(!TABS.has(tab)||!validDate(date)||!obj(data)||data.tab!==tab||
    data.date!==date||data.schema!==SCHEMA||
    !label(data.companyName)||!count(data.totalCount)||
    !count(data.reportedStaffCount)||
    !["未報告","確定0件","報告済"].includes(data.reportStatus)||
    (data.reportStatus==="未報告"&&
     (data.reportedStaffCount!==0||data.totalCount!==0))||
    (data.reportStatus==="確定0件"&&
     (data.reportedStaffCount===0||data.totalCount!==0))||
    (data.reportStatus==="報告済"&&data.totalCount===0))stop();
 const base=["schema","tab","date","companyName",
  "reportStatus","totalCount","reportedStaffCount"];
 const extra=tab==="report"?"lines":tab==="daily"?"products":
  tab==="history"?"audits":"actualCount";
 if(!exact(data,[...base,extra]))stop();
 if(tab==="report"){
  if(!Array.isArray(data.lines)||data.lines.length>14||
     data.lines.some(x=>!label(x)&&!(typeof x==="string"&&
      x.includes("件")&&x.length<=180&&!MONEY.test(x.normalize("NFKC")))))stop();
 }else if(tab==="daily"){
  if(!Array.isArray(data.products)||data.products.length!==KEYS.length||
     data.products.some((x,i)=>!exact(x,["name","count"])||
      x.name!==KEYS[i]||!count(x.count))||
     data.products.reduce((n,p)=>n+p.count,0)!==data.totalCount)stop();
 }else if(tab==="history"){
  if(!Array.isArray(data.audits)||data.audits.length>500)stop();
  for(const a of data.audits){
   if(!exact(a,["staffId","staffName","version","previousTotalCount",
     "totalCount","previousCounts","counts"])||
     !ID.test(a.staffId)||!label(a.staffName)||
     !Number.isSafeInteger(a.version)||a.version<1||a.version>999||
     !count(a.previousTotalCount)||!count(a.totalCount)||
     !counts(a.previousCounts)||!counts(a.counts)||
     KEYS.reduce((n,k)=>n+a.previousCounts[k],0)!==a.previousTotalCount||
     KEYS.reduce((n,k)=>n+a.counts[k],0)!==a.totalCount)stop();
  }
 }else if(!count(data.actualCount)||data.actualCount!==data.totalCount)stop();
 return structuredClone(data);
}
export function createPartnerPublishedOptionalTabClient({
 enabled=false,serverGuardVerified=false,auth,functions,httpsCallable,
 getWorkspaceCompanyId
}={}){
 if(enabled!==true||serverGuardVerified!==true||!auth||
    typeof httpsCallable!=="function"||typeof getWorkspaceCompanyId!=="function")stop();
 return Object.freeze({
  async load({tab,date}={}){
   if(!TABS.has(tab)||!validDate(date))stop();
   const user=auth.currentUser,company=getWorkspaceCompanyId();
   if(!user||user.emailVerified!==true||!ID.test(user.uid??"")||
      typeof company!=="string"||
      (company!==""&&!ID.test(company)))stop();
   const payload={tab,date,...(company?{workspaceCompanyId:company}:{})};
   let result;
   try{
    result=await httpsCallable(functions,"getPartnerPublishedOptionalTab")(payload);
   }catch{stop();}
   if(auth.currentUser!==user||getWorkspaceCompanyId()!==company)stop();
   return verifyPartnerOptionalTabData(result?.data,{tab,date});
  }
 });
}
