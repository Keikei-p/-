/**
 * PURE report fan-in: no Firebase, LINE, mutation, secrets or network calls.
 * Cross-company sharing requires reciprocal explicit opt-in on BOTH companies.
 * All non-count source data and monetary fields are discarded before formatting.
 */
import {normalizeTeams} from "./format.mjs";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const forbiddenLabel=/(?:売上|単価|キャッシュバック|報酬|利益|¥|￥|[$€]|(?:CB|cashback|revenue|unitPrice|commission)[ :_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
function safeName(value){
  const n=typeof value==="string"?value.replace(/[\r\n\t]/g," ").trim():"";
  if(!n||n.length>60||forbiddenLabel.test(n))return "名称は管理者確認中";
  return n;
}
function config(company){
  if(!company||!ID.test(company.id??"")||company.active===false||
    !company.settings||typeof company.settings!=="object")throw Error("Invalid company settings");
  return company.settings;
}
function validIds(values,max=30){
  if(!Array.isArray(values)||values.length>max||
    values.some(v=>!ID.test(v))||new Set(values).size!==values.length)
    throw Error("Invalid report partner ID allowlist");
  return values;
}
function safeTeams(rows){
  const result=normalizeTeams(rows);
  const ids=result.map(t=>t.id);
  if(new Set(ids).size!==ids.length)throw Error("Duplicate report team");
  return result;
}
/**
 * Each company's settings is the authoritative company-owned setting, read by
 * trusted Firestore server credentials. NEVER allow these as browser params.
 *
 * HUB: linkedCompanyIds:["partnerCo"]; aggregatePartnerReports:true.
 * PARTNER: linkedHubCompanyId:"hubCo"; countsShareApproved:true;
 *          countsShareLineGroupId:"same actual LINE group as hub".
 *
 * Hub can revoke by removing an ID, partner can revoke by disabling sharing.
 * Two-party agreement is mandatory; no inferred company grouping.
 */
export function buildCombinedReportPlan({hub,companies}){
  const settings=config(hub);
  if(settings.enabled!==true||settings.lineEnabled!==true||
    typeof settings.lineGroupId!=="string"||!settings.lineGroupId ||
    settings.lineGroupId.length>160)throw Error("Hub LINE report is not enabled");
  if(!Array.isArray(companies))throw Error("Missing linked company settings");
  const linked=validIds(settings.aggregatePartnerReports===true
    ?settings.linkedCompanyIds??[]:[]);
  const map=new Map();
  for(const company of companies){
    if(!company||!ID.test(company.id??"")||map.has(company.id))
      throw Error("Invalid or duplicated linked company");
    map.set(company.id,company);
  }
  const partnerIds=[];
  for(const partnerId of linked){
    if(partnerId===hub.id)throw Error("Cannot link report hub to itself");
    const child=map.get(partnerId);
    if(!child||child.active===false)throw Error("Missing or inactive linked partner");
    const childSettings=config(child);
    if(childSettings.enabled!==true||childSettings.lineEnabled!==true ||
      childSettings.linkedHubCompanyId!==hub.id ||
      childSettings.countsShareApproved!==true ||
      childSettings.countsShareLineGroupId!==settings.lineGroupId)
      throw Error("Partner report sharing requires reciprocal consent");
    partnerIds.push(partnerId);
  }
  const ownPartnerTeamIds=validIds(settings.partnerTeamIds??[],100);
  return {hubCompanyId:hub.id,lineGroupId:settings.lineGroupId,
    partnerCompanyIds:partnerIds,ownPartnerTeamIds};
}
function classifyRows(rows,partnerTeamIds){
  const all=safeTeams(rows);
  const partnerIds=new Set(partnerTeamIds);
  const present=new Set(all.map(t=>t.id));
  if([...partnerIds].some(id=>!present.has(id)))
    throw Error("Configured partner team not found");
  return {own:all.filter(t=>!partnerIds.has(t.id)),
    partner:all.filter(t=>partnerIds.has(t.id))};
}
export function buildCombinedReportData({plan,hubTeams,partnerSources}){
  if(!plan||!ID.test(plan.hubCompanyId??"")||
     !Array.isArray(plan.partnerCompanyIds)||!Array.isArray(plan.ownPartnerTeamIds) ||
     !Array.isArray(partnerSources))
    throw Error("Invalid combined report input");
  const sections=classifyRows(hubTeams,plan.ownPartnerTeamIds);
  const byId=new Map();
  for(const p of partnerSources){
    if(!p||!ID.test(p.companyId??"")||byId.has(p.companyId))
      throw Error("Duplicate or unexpected partner report");
    byId.set(p.companyId,p);
  }
  if(byId.size!==plan.partnerCompanyIds.length ||
    [...byId.keys()].some(id=>!plan.partnerCompanyIds.includes(id)))
    throw Error("Partner report set is incomplete");
  const partners=[];
  if(sections.partner.length)partners.push({name:"自社登録の協力店",teams:sections.partner});
  for(const id of plan.partnerCompanyIds){
    const source=byId.get(id);
    partners.push({name:safeName(source.companyName),teams:safeTeams(source.teams)});
  }
  const all=[...sections.own,...partners.flatMap(p=>p.teams)];
  if(!all.length)throw Error("No verified teams to report");
  const count=(field)=>all.reduce((sum,t)=>{
    const n=sum+t[field];
    if(!Number.isSafeInteger(n))throw Error("Count overflow");
    return n;
  },0);
  return {ownTeams:sections.own,partners,
    totalGoalCount:count("goalCount"),totalCurrentCount:count("currentCount")};
}
function checkDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("Invalid report date");
}
function linesForTeams(teams){
  const out=[];
  for(const team of teams){
    out.push("⭐️"+safeName(team.name));
    out.push("🎯目標："+team.goalCount+"件");
    out.push("✅現在："+team.currentCount+"件");
    out.push("");
  }
  return out;
}
export function formatCombinedCountsReport({date,period,report}){
  checkDate(date);
  if(!["morning","final"].includes(period)||!report)throw Error("Invalid report mode");
  const lines=["@All",
    period==="morning"?"🌸本日朝礼報告🌸":"🌸本日最終報告🌸",
    "📅 "+date,"","🏢自社",...linesForTeams(report.ownTeams)];
  if(!report.ownTeams.length)lines.push("該当班なし","");
  if(report.partners.length){
    lines.push("🤝協力店");
    for(const partner of report.partners){
      lines.push("【"+safeName(partner.name)+"】",...linesForTeams(partner.teams));
    }
  }
  lines.push("📊合計目標："+report.totalGoalCount+"件");
  lines.push("📊合計実績："+report.totalCurrentCount+"件");
  return lines.join("\n").trim();
}
export function formatCombinedMissingReminder({date,report}){
  checkDate(date);if(!report)throw Error("Missing report data");
  const missing=[];
  for(const t of report.ownTeams)if(!t.reported)missing.push("自社："+safeName(t.name));
  for(const p of report.partners)
    for(const t of p.teams)if(!t.reported)
      missing.push(safeName(p.name)+"："+safeName(t.name));
  if(!missing.length)return "";
  return ["@All","⚠️ 実績未報告のお知らせ","📅 "+date,"",
    ...missing.map(x=>"⭐️"+x+"：未報告"),"",
    "実績入力または「実績なし」を報告してください。"].join("\n");
}
