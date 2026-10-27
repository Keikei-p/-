// Pure formatter; contains no tokens, network access or financial values.
function safeLabel(value){
 const raw=String(value??"").replace(/[\r
\t]/g," ").trim().slice(0,60);
 if(/(?:売上|単価|キャッシュバック|CB|[¥￥$€]|[0-9０-９]+\\s*(?:万|千)?円)/i.test(raw))return "名称は管理者確認中";
 return raw||"名称未設定";
}
function nonnegativeInt(value){
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0)return null;
 return n;
}
export function normalizeTeams(input){
 if(!Array.isArray(input))throw Error("Teams must be an array");
 return input.map(team=>{
  const goal=nonnegativeInt(team?.goalCount),current=nonnegativeInt(team?.currentCount);
  if(goal===null||current===null)throw Error("Invalid count");
  return {id:safeLabel(team.id),name:safeLabel(team.name),goalCount:goal,
   currentCount:current,reported:team.reported===true};
 });
}
export function formatCountsReport({date,period,teams}){
 if(period!=="morning"&&period!=="final")throw Error("Unknown report period");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))throw Error("Invalid date");
 const all=normalizeTeams(teams);
 const header=period==="morning"?"🌸本日朝礼報告🌸":"🌸本日最終報告🌸";
 const lines=["@All",header,"📅 "+date,""];
 for(const t of all){
  lines.push("⭐️"+t.name);
  lines.push("🎯目標："+t.goalCount+"件");
  lines.push("✅現在："+t.currentCount+"件");
  lines.push("");
 }
 if(!all.length)lines.push("対象の班がありません。");
 return lines.join("\n").trim();
}
export function formatMissingReminder({date,teams}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))throw Error("Invalid date");
 const missing=normalizeTeams(teams).filter(t=>!t.reported);
 if(!missing.length)return "";
 return ["@All","⚠️ 実績未報告のお知らせ","📅 "+date,"",
  ...missing.map(t=>"⭐️"+t.name+"：未報告"),"",
  "実績入力または「実績なし」を報告してください。"].join("\n");
}
