// Fixed-format LINE report, independent of UI templates and money-bearing fields.
// No product prices, customer names, revenue, or free-text descriptions are ever sent.
export function reportTimeDue(configured, current) {
  const valid = x => typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  if (!valid(configured) || !valid(current)) return false;
  const [a,b] = configured.split(":").map(Number);
  const [c,d] = current.split(":").map(Number);
  const target = a*60+b, actual = c*60+d;
  return target%5===0 && actual>=target && actual<target+5;
}
export function previousDay(today){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today))throw Error("invalid_date");
  const parsed=new Date(today+"T00:00:00Z");
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==today)throw Error("invalid_date");
  return new Date(parsed.getTime()-86400000).toISOString().slice(0,10);
}
export function safeReportLabel(raw,fallback){
  const value=String(raw||"").normalize("NFKC").trim();
  if(!value||value.length>55||/[\n\r\t]|[¥￥$]|(?:円|万円|売上|単価|粗利|利益|原価|報酬|価格|収益|手数料|CB\s*[0-9]|キャッシュバック\s*[0-9])/i.test(value))
    return fallback;
  return value;
}
function count(value){
  if(!Number.isSafeInteger(value)||value<0||value>99999)throw Error("invalid_count");
  return value;
}
function linesForRecord(record){
  const raw=record.results;
  if(record.reportStatus==="no_result" && (!raw || !Object.keys(raw).length))return [];
  if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
    return Object.entries(raw).map(([key,v])=>({
      productId:v?.productId || key.split("__cb_")[0], count:count(v?.count)
    }));
  }
  if(record.productId)return [{productId:record.productId,count:count(record.count)}];
  if(record.totalCount===0||record.reportStatus==="no_result")return [];
  throw Error("unreadable_record");
}
const validId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,150}$/.test(x);
export function buildCountOnlyReport({companyId,mode,date,records,teams,products,goals}){
  if(!validId(companyId)||!["morning","evening"].includes(mode)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
    ![records,teams,products,goals].every(Array.isArray))throw Error("invalid_report_input");
  const month=date.slice(0,7),idMap=new Map(),productMap=new Map();
  for(const product of products){
    if(product?.companyId===companyId && validId(product.id))
      productMap.set(product.id,safeReportLabel(product.name,"商材"));
  }
  for(const team of teams){
    if(team?.companyId!==companyId || team.active===false || !validId(team.id))continue;
    idMap.set(team.id,{id:team.id,name:safeReportLabel(team.name,"班"),daily:0,monthly:0,
      target:0,perProduct:new Map()});
  }
  for(const goal of goals){
    if(goal?.companyId!==companyId||goal.month!==month||!idMap.has(goal.teamId))continue;
    let target=0;
    if(!goal.targets || typeof goal.targets!=="object" || Array.isArray(goal.targets))
      throw Error("invalid_goal");
    for(const n of Object.values(goal.targets))target+=count(Number(n));
    idMap.get(goal.teamId).target+=target;
  }
  const dailySeen=new Set();
  for(const record of records){
    if(record?.companyId!==companyId||typeof record.date!=="string"||
       record.date.slice(0,7)!==month || record.date>date)continue;
    if(!validId(record.uid)||!validId(record.teamId))
      throw Error("missing_record_identity");
    const dailyKey=record.uid+"|"+record.date;
    if(dailySeen.has(dailyKey))throw Error("duplicate_day_record");
    dailySeen.add(dailyKey);
    // Do not guess or reassign historical team IDs.
    let team=idMap.get(record.teamId);
    if(!team){
      team={id:record.teamId,name:safeReportLabel(record.teamNameSnapshot,"班"),
        daily:0,monthly:0,target:0,perProduct:new Map()};
      idMap.set(record.teamId,team);
    }
    const pieces=linesForRecord(record);
    const total=pieces.reduce((a,v)=>a+v.count,0);
    if(!Number.isSafeInteger(total))throw Error("count_overflow");
    if(Number.isSafeInteger(record.totalCount)&&record.totalCount!==total)
      throw Error("record_total_mismatch");
    team.monthly+=total;
    if(record.date===date){
      team.daily+=total;
      for(const item of pieces){
        const id=item.productId;
        if(!validId(id))throw Error("unknown_product_id");
        if(!productMap.has(id))throw Error("unknown_catalog_product");
        team.perProduct.set(id,(team.perProduct.get(id)||0)+item.count);
      }
    }
  }
  const sorted=[...idMap.values()].sort((a,b)=>a.name.localeCompare(b.name,"ja")||a.id.localeCompare(b.id));
  const head=mode==="morning"?"🌅朝礼共有🌅":"🌸本日最終報告🌸";
  const dayWord=mode==="morning"?"昨日":"本日";
  const out=[head,"📅"+date.replaceAll("-","/")+"の実績",""];
  let companyDaily=0,companyMonthly=0,companyTarget=0;
  for(const team of sorted){
    companyDaily+=team.daily;companyMonthly+=team.monthly;companyTarget+=team.target;
    out.push("⭐️"+team.name);
    const entries=[...team.perProduct.entries()].sort(([x],[y])=>x.localeCompare(y));
    // Product rows with 0 counts are omitted to keep LINE within 5000 chars.
    for(const [id,n] of entries)if(n>0)out.push(productMap.get(id)+":"+n+"件");
    out.push(dayWord+":"+team.daily+"件");
    out.push("月間:"+team.monthly+"件｜目標:"+team.target+"件｜残り:"+Math.max(0,team.target-team.monthly)+"件");
    out.push("");
  }
  out.push("【会社全体】");
  out.push(dayWord+":"+companyDaily+"件｜月間:"+companyMonthly+"件");
  out.push("月間目標:"+companyTarget+"件｜残り:"+Math.max(0,companyTarget-companyMonthly)+"件");
  const message=out.join("\n").trim();
  if(message.length>4500||/[¥￥]|(?:[0-9][0-9,.]*\s*円)|(?:売上|単価|粗利|利益|原価|報酬|価格|収益|手数料)/i.test(message))
    throw Error("unsafe_report_text");
  return message;
}
