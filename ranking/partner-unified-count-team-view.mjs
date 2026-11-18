/**
 * Read-only, count-only projection of an authenticated getPartnerWorkspace DAY
 * response. Same company > team > member > product semantics as the HQ view.
 * Never copy price, revenue, CB, private product data, uid or location.
 *
 * This is NOT authorization. Its caller MUST get a server-scoped, sanitized
 * Firebase Callable result. No Firestore reads/writes, migration, SKU matching,
 * ranking recomputation or economic calculations are performed here.
 *
 * Fail closed unless the backend supplies an explicit enabledCategories
 * whitelist and zero-masks every disabled saved category. Old saved originals
 * are NOT changed. Shared count submission still uses the existing verified
 * submitPartnerWorkspaceCounts function and its versioned readback.
 */
export const PARTNER_DAY_PRODUCT_KEYS=Object.freeze([
  "NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
  "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"
]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONEY=/(?:売上|単価|利益|収益|報酬|価格|原価|キャッシュバック|cashback|unitPrice|revenue|[¥￥$€]|\d\s*(?:万円|千円|円)|[\r\n\t@])/i;
const stop=()=>{throw Error("PARTNER_UNIFIED_TEAM_COUNT_SNAPSHOT_UNVERIFIED");};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const identifier=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
const name=x=>typeof x==="string"&&x.trim().length>0&&x.length<=80&&
 !MONEY.test(x.normalize("NFKC"))?x.trim():stop();
const number=x=>Number.isSafeInteger(x)&&x>=0&&x<=9999?x:stop();
const add=(a,b)=>Number.isSafeInteger(a+b)&&a+b<=2000000?a+b:stop();
const limit=(value,max)=>Array.isArray(value)&&value.length<=max?value:stop();
const frozen=x=>Object.freeze(x);
function day(value){
 if(typeof value!=="string"||!DATE.test(value))stop();
 const [y,m,d]=value.split("-").map(Number);
 const check=new Date(Date.UTC(y,m-1,d));
 if(check.toISOString().slice(0,10)!==value)stop();
 return value;
}
function counters(counts,keys,allowed){
 if(!object(counts)||Object.keys(counts).sort().join("|")!==keys.slice().sort().join("|"))stop();
 const output=Object.create(null);let total=0;
 for(const key of keys){
  const count=number(counts[key]);
  if(!allowed.has(key)&&count!==0)stop(); // Never silently drop an OFF value.
  if(allowed.has(key)){output[key]=count;total=add(total,count);}
 }
 return {counts:output,total};
}
/** All reported team IDs are the immutable saved teamIdSnapshot, never current team. */
export function buildPartnerUnifiedCountTeamView(workspace){
 if(!object(workspace)||!["owner","leader","member"].includes(workspace.role))stop();
 const companyName=name(workspace.companyName),reportDate=day(workspace.date);
 const categories=limit(workspace.categories,PARTNER_DAY_PRODUCT_KEYS.length);
 if(categories.join("|")!==PARTNER_DAY_PRODUCT_KEYS.join("|"))stop();
 // Existing live legacy clients WITHOUT a publication allowlist MUST continue
 // on the legacy renderer until the server's ON/OFF rollout is approved.
 const selected=limit(workspace.enabledCategories,PARTNER_DAY_PRODUCT_KEYS.length);
 if(new Set(selected).size!==selected.length||selected.some(key=>!categories.includes(key)))stop();
 const enabled=new Set(selected);
 const teams=limit(workspace.teams,150),staff=limit(workspace.staff,150);
 const entries=limit(workspace.records,200);
 const teamById=new Map(),staffById=new Map(),teamTotals=new Map();
 for(const item of teams){
  if(!object(item)||!identifier(item.id)||typeof item.active!=="boolean"||
     teamById.has(item.id))stop();
  const row={id:item.id,name:name(item.name),active:item.active};
  teamById.set(item.id,row);
  teamTotals.set(item.id,{total:0,reported:0,byProduct:Object.fromEntries(selected.map(k=>[k,0])),
   members:[]});
 }
 for(const item of staff){
  if(!object(item)||!identifier(item.id)||staffById.has(item.id)||
     typeof item.active!=="boolean"||
     !(item.teamId===null||item.teamId===undefined||identifier(item.teamId)))stop();
  staffById.set(item.id,{id:item.id,name:name(item.name),teamId:item.teamId??null,
   active:item.active});
 }
 const reported=new Set(),unknown=new Map(),verifiedRecords=[];
 let companyTotal=0;
 for(const item of entries){
  if(!object(item)||!identifier(item.staffId)||reported.has(item.staffId)||
     !staffById.has(item.staffId)||!Number.isSafeInteger(item.version)||
     item.version<1||item.version>999||
     !(item.teamIdSnapshot===null||item.teamIdSnapshot===undefined||
       identifier(item.teamIdSnapshot)))stop();
  const normalized=counters(item.counts,categories,enabled);
  if(normalized.total!==item.totalCount)stop();
  reported.add(item.staffId);companyTotal=add(companyTotal,normalized.total);
  const person=staffById.get(item.staffId);
  const values=frozen(Object.fromEntries(Object.entries(normalized.counts)));
  const row=frozen({id:person.id,name:person.name,reported:true,
   count:normalized.total,counts:values,version:item.version});
  verifiedRecords.push(row);
  const team=teamTotals.get(item.teamIdSnapshot);
  if(team){
   team.total=add(team.total,row.count);team.reported++;
   team.members.push(row);
   for(const key of selected)team.byProduct[key]=add(team.byProduct[key],values[key]);
  }else{
   // Unknown old team remains its own unallocated group. NO reassignment to
   // the person's CURRENT team and no made-up "1班" / "2班" allocation.
   const historic=item.teamIdSnapshot??"unknown";
   if(!unknown.has(historic))unknown.set(historic,{
    total:0,byProduct:Object.fromEntries(selected.map(k=>[k,0])),members:[]
   });
   const group=unknown.get(historic);
   group.total=add(group.total,row.count);group.members.push(row);
   for(const key of selected)group.byProduct[key]=add(group.byProduct[key],values[key]);
  }
 }
 const detail=[];
 for(const t of teamById.values()){
  const aggregate=teamTotals.get(t.id);
  const currentMembers=[...staffById.values()].filter(person=>
   person.active&&person.teamId===t.id);
  // Active staff absent from this day's entry are NOT a submitted 0.
  const missing=currentMembers.filter(person=>!reported.has(person.id))
   .map(person=>frozen({id:person.id,name:person.name,reported:false,
    count:null,counts:null,version:null}));
  const members=frozen([...aggregate.members,...missing]);
  detail.push(frozen({id:t.id,name:t.name,active:t.active,unverified:false,
   totalCount:aggregate.total,
   currentMemberCount:currentMembers.length,
   reportedMemberCount:aggregate.reported,
   missingMemberCount:missing.length,
   reportStatus:aggregate.reported?"submitted":
    currentMembers.length?"not_reported":"not_expected",
   counts:frozen({...aggregate.byProduct}),members}));
 }
 const historical=[];
 for(const group of unknown.values()){
  historical.push(frozen({id:null,name:"登録当時の班未確認",active:false,
   unverified:true,totalCount:group.total,
   currentMemberCount:0,reportedMemberCount:group.members.length,
   missingMemberCount:0,reportStatus:"unverified",
   counts:frozen({...group.byProduct}),members:frozen([...group.members])}));
 }
 const teamsTotal=detail.reduce((sum,t)=>add(sum,t.totalCount),0);
 const historicalTotal=historical.reduce((sum,t)=>add(sum,t.totalCount),0);
 if(add(teamsTotal,historicalTotal)!==companyTotal)stop();
 return frozen({schema:"nico-partner-same-app-count-team-v1",
  date:reportDate,companyName,
  activeInputCategories:frozen([...selected]),
  companyTotalCount:companyTotal,
  reportedCount:verifiedRecords.length,
  currentMemberCount:[...staffById.values()].filter(p=>p.active).length,
  teamDetails:frozen(detail),historicalUnassigned:frozen(historical),
  financeIncluded:false,financialReads:0,firestoreWrites:0});
}
