/**
 * STAGING / NO DEPLOY. Shared count-only dashboard panel used only when the
 * verified OWNER publication HTTP endpoint is released. No Firestore access,
 * data writes, financial source fields or anonymous partner fallbacks.
 */
import {getVerifiedJointCountWindow} from "./verified-joint-month-http-bridge.mjs";

const API="https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking";
const schema="nico-published-partner-count-tab-v1";
const TABS=new Set(["product","team","individual","detail"]);
const RECORD=new Set(["未報告","確定0件","報告済","一部未報告"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const TOKEN=/^[A-Za-z0-9._-]{20,12000}$/;
const MONEY=/(?:売上|単価|収益|原価|価格|報酬|利益|キャッシュバック|revenue|commission|salary|unit[\s_-]*price|cash[\s_-]*back|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const fail=()=>{throw Error("PUBLISHED_PARTNER_TAB_DATA_UNVERIFIED");};
const obj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const exact=(r,keys)=>obj(r)&&Object.keys(r).length===keys.length&&
 keys.every(k=>Object.hasOwn(r,k));
const count=n=>Number.isSafeInteger(n)&&n>=0;
const label=s=>typeof s==="string"&&s.length>0&&s.length<=180&&
 s.trim().length>0&&!MONEY.test(s.normalize("NFKC"));
function validRankRows(rows,tab){
 if(!Array.isArray(rows)||rows.length>10000)return false;
 let before=Infinity,lastRank=0,lastCount=null;
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  const keys=tab==="product"||tab==="company"?["rank","name","count"]:
   tab==="individual"?["rank","name","company","count"]:
   ["rank","name","company","count","own"];
  if(!exact(row,keys)||!label(row.name)||!count(row.count)||
  // The authenticated server may redact earlier participants but preserves
  // their original competition ranks (e.g. 1, 3 or first visible rank 2).
  // Never invent dense ranks locally; still reject reversed order, fake ties,
  // null/negative ranks, unsorted counts and unverified finance fields.
    !Number.isSafeInteger(row.rank)||row.rank<1||
    (row.count!==lastCount&&row.rank<i+1)||
    (["individual","team"].includes(tab)&&!label(row.company))||
    (tab==="team"&&typeof row.own!=="boolean")||
    row.count>before||
    (row.count===lastCount&&row.rank!==lastRank)||
    (row.count!==lastCount&&row.rank<=lastRank))return false;
  before=row.count;lastCount=row.count;lastRank=row.rank;
 }
 return true;
}
function validDetails(rows){
 if(!Array.isArray(rows)||rows.length>400)return false;
 let all=0;
 for(const team of rows){
  if(!exact(team,["name","count","reportStatus","members","products"])||
     !label(team.name)||!count(team.count)||!RECORD.has(team.reportStatus)||
     !Array.isArray(team.members)||team.members.length>150||
     !Array.isArray(team.products)||team.products.length>1000)return false;
  let memberSum=0,productSum=0;
  for(const m of team.members){
   if(!exact(m,["name","count","reportStatus"])||!label(m.name)||
      !count(m.count)||!RECORD.has(m.reportStatus)||
      (m.reportStatus==="未報告"&&m.count!==0))return false;
   memberSum+=m.count;
  }
  for(const p of team.products){
   if(!exact(p,["name","count"])||!label(p.name)||!count(p.count))return false;
   productSum+=p.count;
  }
  if(memberSum!==team.count||productSum!==team.count||
    (team.reportStatus==="未報告"&&team.count!==0))return false;
  all+=team.count;
  if(!Number.isSafeInteger(all))return false;
 }
 return true;
}
function countQuery({tab,day,kind="day",asOf=day,scope="joint"}={}){
 if(!TABS.has(tab)||!["joint","direct","partner"].includes(scope)||
    (tab==="detail"&&scope==="direct"))fail();
 let window;
 try{window=getVerifiedJointCountWindow({kind,day,asOf});}catch{fail();}
 const value=kind==="month"?day.slice(0,7):day;
 const query=new URLSearchParams({[kind]:value,tab});
 if(scope!=="joint")query.set("scope",scope);
 return {query,window};
}
export function verifyPublishedPartnerCountResponse(payload,selection={}){
 const {tab,kind="day"}=selection;
 const {window}=countQuery(selection);
 const responseFields=["schema","role","unit","period","range","readTime","tab","rows"];
 if(tab==="team")responseFields.push("companies");
 if(!exact(payload,responseFields)||payload.schema!==schema||payload.role!=="partner_owner"||
    payload.unit!=="件"||payload.tab!==tab||
    payload.period!==kind||!obj(payload.range)||
    payload.range.start!==window.start||payload.range.end!==window.end||
    typeof payload.readTime!=="string"||
    Number.isNaN(Date.parse(payload.readTime))||
    !(tab==="detail"?validDetails(payload.rows):validRankRows(payload.rows,tab))||
    (tab==="team"&&!validRankRows(payload.companies,"company")))
   fail();
 // Do not allow arbitrary nested developer/debug/finance fields to survive
 // schema validation or leak from labels into a browser DOM.
 return Object.freeze({
  schema,tab,period:kind,rows:Object.freeze(payload.rows.map(row=>structuredClone(row))),
  ...(tab==="team"?{companies:Object.freeze(payload.companies.map(row=>structuredClone(row)))}:{})
 });
}
export function createPublishedPartnerCountBridge({
 featureEnabled=false,auth,fetcher,endpoint=API,getWorkspaceCompanyId
}={}){
 if(featureEnabled!==true||!auth||typeof fetcher!=="function"||
   endpoint!==API||typeof getWorkspaceCompanyId!=="function")fail();
 return Object.freeze({
  async load(selection={}){
   const {query}=countQuery(selection);
   const user=auth.currentUser;
   if(!user||user.emailVerified!==true||typeof user.getIdToken!=="function"||
      typeof user.uid!=="string"||!ID.test(user.uid))fail();
   const company=getWorkspaceCompanyId();
   if(typeof company!=="string"||
      (company!==""&&!ID.test(company)))fail();
   const token=await user.getIdToken();
   if(auth.currentUser!==user||!TOKEN.test(token??""))fail();
   if(company)query.set("workspaceCompanyId",company);
   const url=API+"?"+query.toString();
   let response;
   try{
    response=await fetcher(url,{method:"GET",
     headers:{Authorization:"Bearer "+token,Accept:"application/json"},
     cache:"no-store",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer"
    });
   }catch{fail();}
   if(auth.currentUser!==user||getWorkspaceCompanyId()!==company||
      response?.status!==200||typeof response?.text!=="function"||
      !String(response.headers?.get?.("Content-Type")??"")
       .toLowerCase().includes("application/json"))fail();
   const body=await response.text();
   if(auth.currentUser!==user||getWorkspaceCompanyId()!==company||
      typeof body!=="string"||body.length>400000)fail();
   let json;
   try{json=JSON.parse(body);}catch{fail();}
   return verifyPublishedPartnerCountResponse(json,selection);
  }
 });
}
/**
 * Staged count-only rank GET for EXISTING opaque company-code logins.
 * The canonical server's makeWorkspaceIdentity.readCountViewer already
 * verifies this bearer against partnerCodeSessions, current credentials,
 * membership and approved hub/partner relation in a read-only transaction.
 * Owner tab publication is checked again inside the canonical count tx.
 *
 * Do not put the secret in URL, referrer, logs, DOM, storage or response.
 * No browser-selected company/role override. The old email bridge is unchanged.
 */
export function createPublishedPartnerCodeCountBridge({
 featureEnabled=false,serverGuardVerified=false,
 getCodeSessionToken,fetcher,endpoint=API
}={}){
 if(featureEnabled!==true||serverGuardVerified!==true||
    endpoint!==API||typeof getCodeSessionToken!=="function"||
    typeof fetcher!=="function")fail();
 const code=/^[A-Za-z0-9_-]{43}$/;
 return Object.freeze({
  async load(selection={}){
   const {query}=countQuery(selection);
   const token=getCodeSessionToken();
   if(typeof token!=="string"||!code.test(token))fail();
   const current=()=>getCodeSessionToken()===token;
   const url=API+"?"+query.toString();
   let response;
   try{
    response=await fetcher(url,{
     method:"GET",
     headers:{Authorization:"Bearer "+token,Accept:"application/json"},
     cache:"no-store",credentials:"omit",redirect:"error",
     referrerPolicy:"no-referrer"
    });
   }catch{fail();}
   if(!current()||response?.status!==200||
      typeof response?.text!=="function"||
      !String(response.headers?.get?.("Content-Type")??"")
       .toLowerCase().includes("application/json"))fail();
   const body=await response.text();
   if(!current()||typeof body!=="string"||body.length>400000)fail();
   let json;
   try{json=JSON.parse(body);}catch{fail();}
   if(!current())fail();
   return verifyPublishedPartnerCountResponse(json,selection);
  }
 });
}

export function renderPublishedPartnerCountTab({document,root,status,payload,appendRankRow,companyName}={}){
 if(!document||typeof document.createElement!=="function"||
   !root||typeof root.replaceChildren!=="function"||
   !payload||payload.schema!==schema||!TABS.has(payload.tab)||
   !Array.isArray(payload.rows))fail();
 const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const fragment=document.createDocumentFragment();
 if(payload.tab==="detail"){
  const company=el("details","");company.className="owner-partner-company-card";
  company.open=true;
  company.append(el("summary",label(companyName)?companyName:"所属会社"));
  for(const row of payload.rows){
   const card=el("details","");card.className="partner-count-team-card";
   const heading=el("summary","");heading.className="team-detail-header";
   const title=el("strong",row.name);title.className="team-detail-title";
   const total=el("span",row.reportStatus==="未報告"?"未報告":row.count+"件");
   total.className="team-detail-total";heading.append(title,total);
   const members=el("div","");members.className="partner-count-team-people-grid";
   for(const member of row.members)
    members.append(el("p",member.name+"："+(member.reportStatus==="未報告"?
     "未報告":member.count+"件（"+member.reportStatus+"）")));
   const products=el("div","");products.className="partner-count-team-body";
   for(const product of row.products)
    products.append(el("p",product.name+"："+product.count+"件"));
   card.append(heading,members,products);company.append(card);
  }
  if(payload.rows.length)fragment.append(company);
 }else{
  const ranks=(rows,heading)=>{
   const grid=el("div","");grid.className="ranking-grid";
   if(heading)fragment.append(el("h4",heading));
   for(const row of rows){
    const name=row.company?row.company+"・"+row.name:row.name;
    if(appendRankRow)appendRankRow(grid,{name,count:row.count,rank:row.rank});
    else grid.append(el("p",row.rank+"位｜"+name+"："+row.count+"件"));
   }
   if(rows.length)fragment.append(grid);
   else if(heading)fragment.append(el("p","この期間の公開済み実績はありません。"));
  };
  if(payload.tab==="team"&&payload.companies){
   ranks(payload.companies,"会社別件数");
   ranks(payload.rows,"班別件数");
  }else{
   ranks(payload.rows);
  }
 }
 if(!payload.rows.length&&payload.tab!=="team")fragment.append(el("p","この期間の公開済み実績はありません。"));
 root.replaceChildren(fragment);
 if(status)status.textContent=payload.tab==="detail"?
  "協力店の班詳細（件数のみ）":"公開済みの合同件数ランキング";
}
