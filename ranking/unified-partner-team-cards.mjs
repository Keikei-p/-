/**
 * Owner-only partner company > team cards appended to the existing internal
 * 1/2/3/4-team panel. STRICTLY count-only and NO DEPLOY until reviewed.
 * The source is the existing authenticated, verified joint monthly projection.
 * It never reads Firestore or returns/recalculates monetary fields.
 */
import {verifiedJointCountView} from "./verified-joint-ranking-panel.mjs";
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|収益|報酬|利益|キャッシュバック|[¥￥$€]|(?:cashback|revenue|unitPrice|price|commission)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:円|万円))/i;
const stop=()=>{throw Error("PARTNER_TEAM_MONTH_UNVERIFIED");};
const goodName=value=>{
 if(typeof value!=="string"||!value.trim()||value.length>100||MONEY.test(value))stop();
 return value.trim();
};
const count=value=>{
 if(!Number.isSafeInteger(value)||value<0)return stop();
 return value;
};
const el=(document,tag,cls,value)=>{
 const element=document.createElement(tag);
 if(cls)element.className=cls;
 if(value!==undefined)element.textContent=String(value);
 return element;
};
/** Validate trusted fields and keep one companyId+teamId per card. */
export function projectOwnerPartnerTeamCards(response,{month}={}){
 // Thorough input/finance validation is delegated to the existing reviewed
 // projection; accessing a partial/incomplete or unauthenticated payload fails.
 const view=verifiedJointCountView(response,{month,role:"hub_owner"});
 if(view.role!=="hub_owner"||response.role!=="hub_owner"||
    !Array.isArray(response.companyBreakdown)||
    !Array.isArray(response.teamBreakdown)||
    !Array.isArray(response.memberRanking)||
    !Array.isArray(response.productRanking))stop();
 const partnerCompanies=new Map();
 for(const company of response.companyBreakdown){
  const id=company.id;
  if(!ID.test(id||"")||!["自社","協力店"].includes(company.kind)||
     !Number.isSafeInteger(company.unidentifiedCount)||
     company.unidentifiedCount<0||company.unidentifiedCount>company.count)stop();
  if(company.kind!=="協力店")continue;
  if(partnerCompanies.has(id))stop();
  partnerCompanies.set(id,{id,name:goodName(company.name),count:count(company.count),
   teams:[],products:[],unassignedCount:0});
 }
 const seenTeams=new Set();
 for(const team of response.teamBreakdown){
  if(!ID.test(team.companyId||"")||!ID.test(team.id||"")||
     !team.id.startsWith(team.companyId+":")||
     !Number.isSafeInteger(team.count)||team.count<0)stop();
  if(seenTeams.has(team.id))stop();
  seenTeams.add(team.id);
  const company=partnerCompanies.get(team.companyId);
  if(!company)continue; // internal company cards remain intact
  if(goodName(team.companyName)!==company.name)stop();
  company.teams.push({key:team.id,companyId:team.companyId,
   name:goodName(team.name),count:team.count,people:[],peopleVerified:false});
 }
 // Only names and individual counts already approved in the server response.
 // Current teamId and historical team snapshots can differ; if exact person
 // attribution cannot be verified, never pretend that per-team people are complete.
 for(const person of response.memberRanking){
  if(!ID.test(person.companyId||"")||!ID.test(person.teamId||"")||
     !ID.test(person.id||"")||!person.id.startsWith(person.companyId+":"))stop();
  const company=partnerCompanies.get(person.companyId);
  if(!company)continue;
  if(goodName(person.companyName)!==company.name)stop();
  const team=company.teams.find(t=>t.key===person.companyId+":"+person.teamId);
  if(!team)continue;
  if(!["未報告","報告済","一部未報告","確定0件"].includes(person.reportStatus))stop();
  team.people.push({name:goodName(person.name),count:count(person.count),
   reportStatus:person.reportStatus});
 }
 // Product breakdown exists at COMPANY scope only in the v1 verified
 // response; do not attribute company products to individual teams.
 for(const product of response.productRanking){
  if(!Array.isArray(product.companies))stop();
  for(const line of product.companies){
   if(!ID.test(line.companyId||""))stop();
   const company=partnerCompanies.get(line.companyId);
   if(company){
    if(goodName(line.companyName)!==company.name)stop();
    company.products.push({name:goodName(product.name),count:count(line.count)});
   }
  }
 }
 let grandTotal=0;
 const result=[...partnerCompanies.values()].map(company=>{
  const sum=company.teams.reduce((s,t)=>s+count(t.count),0);
  if(sum>company.count)stop();
  company.unassignedCount=company.count-sum;
  const products=company.products.reduce((s,p)=>s+count(p.count),0);
  // Zero products may be possible for unclassified older reports. Never
  // silently attribute unidentified quantities to any SKU or team.
  if(products>company.count)stop();
  for(const team of company.teams){
   const peopleTotal=team.people.reduce((s,p)=>s+p.count,0);
   team.peopleVerified=peopleTotal===team.count &&
    (team.count===0||team.people.some(p=>p.reportStatus!=="未報告"));
   if(!team.peopleVerified)team.people=[]; // refuse a misleading partial list
  }
  company.teams.sort((a,b)=>a.name.localeCompare(b.name,"ja")||a.key.localeCompare(b.key));
  grandTotal+=company.count;
  return company;
 }).sort((a,b)=>a.name.localeCompare(b.name,"ja")||a.id.localeCompare(b.id));
 if(!Number.isSafeInteger(grandTotal)||
    grandTotal!==response.summary.partner)stop();
 return Object.freeze({month,companies:result,total:grandTotal});
}

/** Render alongside existing self cards, not in a second dashboard. */
export function renderOwnerPartnerTeamCards({document,root,response,month}={}){
 if(!document?.createElement||!root?.replaceChildren)stop();
 const model=projectOwnerPartnerTeamCards(response,{month});
 const fragment=document.createDocumentFragment();
 const title=el(document,"h3","team-detail-title","🤝 協力店・会社別の班詳細");
 fragment.appendChild(title);
 if(model.companies.length===0)
  fragment.appendChild(el(document,"p","empty-message","公開承認済みの協力店はありません。"));
 for(const company of model.companies){
  const section=el(document,"section","partner-company-team-section");
  const header=el(document,"div","team-detail-header");
  header.appendChild(el(document,"strong","team-detail-title",company.name));
  header.appendChild(el(document,"strong","team-detail-total",company.count+"件"));
  section.appendChild(header);
  const grid=el(document,"div","team-overview-grid");
  const detail=el(document,"div","team-detail-panel");
  let selected=null;
  const show=()=>{
   detail.replaceChildren();
   for(const button of grid.children)
    button.setAttribute("aria-pressed",String(button.dataset.teamKey===selected));
   if(selected===null){
    detail.appendChild(el(document,"div","empty-message",
     "班を選ぶと担当者・商材の検証済み件数を確認できます。"));
    return;
   }
   const team=company.teams.find(x=>x.key===selected);
   if(!team)stop();
   const heading=el(document,"div","team-detail-header");
   heading.appendChild(el(document,"strong","team-detail-title",company.name+"・"+team.name));
   heading.appendChild(el(document,"strong","team-detail-total",team.count+"件"));
   detail.appendChild(heading);
   detail.appendChild(el(document,"div","team-goal-summary","目標未設定（会社別の件数目標は未接続）"));
   detail.appendChild(el(document,"h4","team-detail-title","担当者別の件数"));
   if(team.peopleVerified){
    for(const person of team.people)
     detail.appendChild(el(document,"div","team-overview-card-result",
      person.name+"　"+person.count+"件"));
    if(!team.people.length)
     detail.appendChild(el(document,"p","empty-message","報告済みの担当者はありません。"));
   }else detail.appendChild(el(document,"p","empty-message",
    "担当者別件数を検証できません。班移動・過去の所属履歴を確認してください。"));
   detail.appendChild(el(document,"h4","team-detail-title","班別の商材内訳"));
   detail.appendChild(el(document,"p","empty-message",
    "商材内訳は班単位の承認済み集計に接続してから表示します。会社合計を班へ推測配分しません。"));
  };
  for(const team of company.teams){
   const button=el(document,"button","team-overview-card");
   button.type="button";button.dataset.teamKey=team.key;
   button.setAttribute("aria-pressed","false");
   button.appendChild(el(document,"div","team-overview-card-name",team.name));
   button.appendChild(el(document,"div","team-overview-card-members",
    team.peopleVerified?team.people.length+"人（報告済み）":"担当人数は未照合"));
   button.appendChild(el(document,"div","team-overview-card-result",team.count+"件"));
   button.appendChild(el(document,"div","team-overview-card-goal","件数目標未設定"));
   button.addEventListener("click",()=>{selected=team.key===selected?null:team.key;show()});
   grid.appendChild(button);
  }
  section.appendChild(grid);section.appendChild(detail);
  if(company.unassignedCount>0)
   section.appendChild(el(document,"p","empty-message",
    "所属班未確認 "+company.unassignedCount+"件（班へ自動割振りしません）"));
  show();
  fragment.appendChild(section);
 }
 root.replaceChildren(fragment);
 return model;
}
