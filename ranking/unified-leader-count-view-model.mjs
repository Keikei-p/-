/**
 * OFFLINE VIEW ADAPTER for the authenticated getPartnerWorkspace response.
 * The same count-only UI layout can serve self and partner leaders, without
 * migrating any prior partnerWorkEntries or old company-level reports.
 *
 * Caller MUST use a server-authenticated Firebase Callable response; this
 * module cannot authenticate a user or grant permissions. Partner saving
 * still uses submitPartnerWorkspaceCounts, never internal financial records.
 */
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DAY=/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONEY=/(?:売上|単価|原価|利益|価格|報酬|収益|キャッシュバック|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|[¥￥$€]|\d+\s*(?:万円|千円|円)|[\r\n\t@])/i;
const stop=()=>{throw Error("NICO_SHARED_LEADER_COUNT_VIEW_UNVERIFIED");};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const safeNum=x=>{if(!Number.isSafeInteger(x)||x<0||x>100000000)stop();return x;};
const add=(a,b)=>safeNum(safeNum(a)+safeNum(b));
const safeName=x=>{if(typeof x!=="string"||!x.trim()||x.length>80||
 MONEY.test(x.normalize("NFKC")))stop();return x.trim();};
const safeId=x=>{if(typeof x!=="string"||!ID.test(x))stop();return x;};
const ensureKeys=(x,required,optional=[])=>{
 if(!object(x)||Object.keys(x).some(k=>!required.includes(k)&&!optional.includes(k)))stop();
 for(const k of required)if(!Object.hasOwn(x,k))stop();
};
const list=(x,max)=>{if(!Array.isArray(x)||x.length>max)stop();return x;};
const date=x=>{
 if(typeof x!=="string"||!DAY.test(x))stop();
 const [year,month,day]=x.split("-").map(Number);
 if(new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==x)stop();
 return x;
};
const validCounts=x=>{
 if(!object(x)||Object.keys(x).sort().join("|")!==[...KEYS].sort().join("|"))stop();
 let total=0;
 for(const key of KEYS)total=add(total,safeNum(x[key]));
 return total;
};
function nameAndId(source){
 return Object.freeze({id:safeId(source.id),name:safeName(source.name)});
}
/**
 * The source is an already verified server response. This function never
 * copies UID, workLocation, monetary keys, or other private data to the UI.
 * Old history is grouped only by immutable teamIdSnapshot. No allocation
 * from today's staff.teamId or from a company-only old report.
 */
export function buildPartnerSharedLeaderCountView(workspace){
 ensureKeys(workspace,["role","date","companyName","teamId",
  "teams","staff","records","categories","privateProducts"],
  ["enabledCategories","sbSeparateInputEnabled"]);
 if(!["owner","leader","member"].includes(workspace.role))stop();
 if(workspace.teamId!==null&&workspace.teamId!==undefined)safeId(workspace.teamId);
 const day=date(workspace.date),companyName=safeName(workspace.companyName);
 if(!Array.isArray(workspace.categories)||
   workspace.categories.join("|")!==KEYS.join("|"))stop();
 // Without a published server allowlist, do not guess that all old products
 // may be reported from the new shared UI. Keep legacy page until verified.
 const enabled=list(workspace.enabledCategories,KEYS.length);
 if(enabled.some(k=>!KEYS.includes(k))||
   new Set(enabled).size!==enabled.length||
   (workspace.sbSeparateInputEnabled!==undefined&&
    typeof workspace.sbSeparateInputEnabled!=="boolean"))stop();
 const teamMap=new Map();
 for(const t of list(workspace.teams,150)){
  ensureKeys(t,["id","name","active"]);
  if(typeof t.active!=="boolean")stop();
  const row=nameAndId(t);
  if(teamMap.has(row.id))stop();
  teamMap.set(row.id,{...row,active:t.active,
   totalCount:0,submittedStaffCount:0,expectedStaffCount:0});
 }
 const staffMap=new Map();
 for(const p of list(workspace.staff,150)){
  ensureKeys(p,["id","name","teamId","kind","role","uid","active"]);
  const row=nameAndId(p);
  if(staffMap.has(row.id)||typeof p.active!=="boolean"||
     (p.teamId!==null&&p.teamId!==undefined&&
      (typeof p.teamId!=="string"||!ID.test(p.teamId))))stop();
  staffMap.set(row.id,{...row,teamId:p.teamId,active:p.active});
  if(p.active&&teamMap.has(p.teamId))
   teamMap.get(p.teamId).expectedStaffCount++;
 }
 const privateMap=new Map();
 for(const p of list(workspace.privateProducts,100)){
  ensureKeys(p,["id","name","active"]);
  if(typeof p.active!=="boolean")stop();
  const safe=nameAndId(p);
  if(privateMap.has(safe.id))stop();
  privateMap.set(safe.id,{...safe,active:p.active,count:0});
 }
 const records=[],seen=new Set();let reportedTotal=0,unknownTeamCount=0;
 let oldPrivateCount=0;
 for(const record of list(workspace.records,200)){
  ensureKeys(record,["staffId","counts","totalCount","version",
   "teamIdSnapshot","workLocation","privateCounts","privateTotalCount"],
   ["sbBreakdown"]);
  const id=safeId(record.staffId);
  if(seen.has(id)||!staffMap.has(id)||!Number.isSafeInteger(record.version)||
    record.version<1||record.version>999)stop();
  seen.add(id);
  const total=validCounts(record.counts);
  if(total!==record.totalCount)stop();
  reportedTotal=add(reportedTotal,total);
  if(record.teamIdSnapshot!==null&&record.teamIdSnapshot!==undefined)
   safeId(record.teamIdSnapshot);
  const team=teamMap.get(record.teamIdSnapshot);
  if(team){
   team.totalCount=add(team.totalCount,total);
   team.submittedStaffCount++;
  }else unknownTeamCount=add(unknownTeamCount,total);
  if(record.sbBreakdown!==undefined){
   const b=record.sbBreakdown;
   if(!object(b)||Object.keys(b).sort().join("|")!==
      ["SB光","SB AIR","旧未分類"].sort().join("|"))stop();
   const n=add(add(safeNum(b["SB光"]),safeNum(b["SB AIR"])),safeNum(b["旧未分類"]));
   if(n!==record.counts["SB光・AIR"])stop();
  }
  if(!object(record.privateCounts))stop();
  const listed=Object.entries(record.privateCounts);
  if(listed.some(([id,v])=>!privateMap.has(id)||!Number.isSafeInteger(v)||v<0))stop();
  const sum=listed.reduce((n,[,v])=>add(n,v),0);
  if(sum!==safeNum(record.privateTotalCount))stop();
  oldPrivateCount=add(oldPrivateCount,sum);
  for(const [pid,v] of listed)
   privateMap.get(pid).count=add(privateMap.get(pid).count,v);
  const staff=staffMap.get(id);
  records.push(Object.freeze({staffId:id,name:staff.name,date:day,
   teamId:team?team.id:null,teamName:team?team.name:"当時の班未確認",
   totalCount:total,counts:Object.freeze({...record.counts}),
   reportStatus:"submitted",version:record.version,
   ...(record.sbBreakdown?{sbBreakdown:Object.freeze({...record.sbBreakdown})}:{})
  }));
 }
 const teams=Object.freeze([...teamMap.values()].map(t=>Object.freeze({
  id:t.id,name:t.name,active:t.active,totalCount:t.totalCount,
  submittedStaffCount:t.submittedStaffCount,
  // Staff who changed teams must not make an unreported CURRENT member
  // appear reported. Compare roster IDs, not counts from saved team snapshots.
  missingStaffCount:[...staffMap.values()].filter(s=>s.active&&
   s.teamId===t.id&&!seen.has(s.id)).length,
  reportStatus:t.submittedStaffCount>0?"submitted":
   t.expectedStaffCount>0?"not_reported":"not_expected"
 })));
 const members=Object.freeze([...staffMap.values()].map(s=>Object.freeze({
  id:s.id,name:s.name,teamId:s.teamId,active:s.active,
  reported:seen.has(s.id)
 })));
 const oldProducts=Object.freeze([...privateMap.values()].map(p=>Object.freeze({...p})));
 return Object.freeze({
  schema:"nico-unified-leader-count-ui-v1",scope:"authenticated-partner-count-view",
  date:day,companyName,role:workspace.role,
  publicInputs:Object.freeze(enabled.map(name=>Object.freeze({name,unit:"件"}))),
  publishedCategories:Object.freeze([...enabled]),
  lightAirSeparateInputEnabled:workspace.sbSeparateInputEnabled===true,
  teams,members,dayRecords:Object.freeze(records),
  dayCount:reportedTotal,
  unknownHistoricalTeamCount:unknownTeamCount,
  oldPrivateProducts:oldProducts,
  oldPrivateCount,
  rankedResult:"REQUIRES_SEPARATE_SERVER_VERIFIED_RANKING",
  historicCompanyOnlyCount:"REQUIRES_APPROVED_RANKING_READ",
  moneyFieldsIncluded:false,financialSourceReads:0,firestoreWrites:0
 });
}
export const SUPPORTED_PUBLISHED_PRODUCT_KEYS=KEYS;
