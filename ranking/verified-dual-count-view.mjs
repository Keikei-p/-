/**
 * Staging-only mobile views for the VERIFIED dual-count response.
 * No Firestore or network logic. The server MUST authenticate fresh identity,
 * reconcile all originals and enforce hub/partner scopes before returning data.
 * No innerHTML, browser storage, unknown fields or financial values.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|キャッシュバック|報酬|利益|[¥￥$€]|(?:CB|cashback|revenue|unitPrice|commission)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const FORBIDDEN=/^(?:totalRevenue|revenue|revenuePerUnit|unitPrice|price|pricingOptions|cashback|cashbackOptions|amount|beforeRevenue|afterRevenue|bankAccount|phone|email|recordCorrections|audit|correctionHistory|privateCounts|privateTotalCount|privateProducts|totalSales|salary)$/i;
const halt=()=>{throw Error("合同件数の権限・結果を確認できません。ログインし直してください。");};
function inspect(value,depth=0){
 if(depth>15)halt();
 if(typeof value==="string"&&MONEY.test(value.normalize("NFKC")))halt();
 if(value===null||typeof value!=="object")return;
 if(Array.isArray(value)){
  if(value.length>5000)halt();
  for(const x of value)inspect(x,depth+1);
  return;
 }
 for(const [k,v] of Object.entries(value)){
  if(FORBIDDEN.test(k.normalize("NFKC")))halt();
  inspect(v,depth+1);
 }
}
function strict(value,fields){
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join("|")!==fields.slice().sort().join("|"))halt();
}
function list(items,fields){
 if(!Array.isArray(items)||items.length>5000)halt();
 for(const item of items)strict(item,fields);
}
function checkedCompetition(items){
 let last=null,rank=0;
 for(const [index,row] of items.entries()){
  if(!Number.isSafeInteger(row.count)||row.count<0||
     !Number.isSafeInteger(row.rank)||row.rank<1||
     typeof row.name!=="string"||!row.name.trim()||
     (last!==null&&row.count>last))halt();
  if(index===0||row.count!==last)rank=index+1;
  if(row.rank!==rank)halt();
  last=row.count;
 }
}
const PERSON=["id","name","companyId","companyName","teamId","teamName",
 "count","reportStatus","reportedDays","previousCount","change","growth",
 "topProduct","remainingToGoal","personalBestStatus","rank"];
const PRODUCT=["id","name","count","ownCount","partnerCount","companies","rank"];
function shape(value){
 strict(value.range,["start","end","previousStart","previousEnd","days"]);
 if(value.role==="hub_owner"){
  strict(value.summary,["own","partner","total","unidentified"]);
  for(const k of ["own","partner","total","unidentified"]){
   if(!Number.isSafeInteger(value.summary[k])||value.summary[k]<0)halt();
  }
  if(value.summary.own+value.summary.partner!==value.summary.total)halt();
  list(value.companyBreakdown,["id","name","kind","count","unidentifiedCount","hasVerifiedSubmission","rank"]);
  if(value.companyBreakdown.some(x=>typeof x.hasVerifiedSubmission!=="boolean"))halt();
  list(value.teamBreakdown,["id","companyId","companyName","name","count","rank"]);
  // Server-certified competition ranks must match the verified submitted
  // company/team counts. A missing report cannot be presented as rank 1 at 0.
  const submitted=value.companyBreakdown.filter(x=>x.hasVerifiedSubmission);
  const companyRanked=competitionFromBreakdown(submitted,x=>({
   id:x.id,name:x.name,count:x.count
  }));
  const companyRankById=new Map(companyRanked.map(x=>[x.id,x.rank]));
  if(companyRankById.size!==submitted.length||
     value.companyBreakdown.some(x=>
      x.rank!==(companyRankById.get(x.id)??null)))halt();
  const teamRanked=competitionFromBreakdown(value.teamBreakdown,x=>({
   id:x.id,companyId:x.companyId,name:x.name,
   company:x.companyName,count:x.count
  }));
  const key=x=>JSON.stringify([x.companyId,x.id]);
  const teamRankById=new Map(teamRanked.map(x=>[key(x),x.rank]));
  if(teamRankById.size!==value.teamBreakdown.length||
     value.teamBreakdown.some(x=>x.rank!==teamRankById.get(key(x))))halt();
  list(value.memberRanking,PERSON);
  list(value.productRanking,PRODUCT);
  for(const product of value.productRanking)
   list(product.companies,["companyId","companyName","count"]);
  if(!value.filters||typeof value.filters!=="object"||
     Object.keys(value.filters).some(k=>!["companyId","teamId","uid","productId"].includes(k)))halt();
 }else{
  strict(value.own,["company","count","unidentifiedCount","people","products"]);
  if(!Number.isSafeInteger(value.own.count)||value.own.count<0||
     !Number.isSafeInteger(value.own.unidentifiedCount)||value.own.unidentifiedCount<0)halt();
  list(value.own.people,PERSON);
  list(value.own.products,["id","name","count"]);
  strict(value.publicRanking,["members","products","companies","teams"]);
  list(value.publicRanking.members,["rank","company","name","count"]);
  list(value.publicRanking.products,["rank","name","count"]);
  list(value.publicRanking.companies,["rank","name","count"]);
  list(value.publicRanking.teams,["rank","name","company","count"]);
  for(const key of ["members","products","companies","teams"])
   checkedCompetition(value.publicRanking[key]);
 }
}
function validate(result){
 if(!result||typeof result!=="object"||Array.isArray(result)||
    result.schema!=="nico-verified-dual-count-v1"||
    !["hub_owner","partner_owner"].includes(result.role)||
    !["day","week","month"].includes(result.period)||
    result.unit!=="件"||
    !result.range||!Number.isSafeInteger(result.range.days)||
    !/^\d{4}-\d\d-\d\dT/.test(result.readTime||""))halt();
 const scopeKeys=Object.hasOwn(result,"scope")?["scope"]:[];
 if(scopeKeys.length&&!["joint","own","partner"].includes(result.scope))halt();
 inspect(result);
 shape(result);
 if(result.role==="hub_owner"){
  if(!result.summary||!Number.isSafeInteger(result.summary.total)||
     !Array.isArray(result.companyBreakdown)||
     !Array.isArray(result.teamBreakdown)||
     !Array.isArray(result.memberRanking)||
     !Array.isArray(result.productRanking)||
     !result.filters||Object.keys(result).sort().join("|")!==
       ["schema","period","range","readTime","unit","summary","role",
        "companyBreakdown","teamBreakdown","memberRanking","productRanking","filters",...scopeKeys
       ].sort().join("|"))halt();
 }else if(!result.own||!Number.isSafeInteger(result.own.count)||
    !Array.isArray(result.own.people)||!Array.isArray(result.own.products)||
    !result.publicRanking||!Array.isArray(result.publicRanking.members)||
    !Array.isArray(result.publicRanking.products)||
    !Array.isArray(result.publicRanking.companies)||
    !Array.isArray(result.publicRanking.teams)||
    Object.keys(result).sort().join("|")!==
    ["schema","period","range","readTime","unit","role","own","publicRanking",...scopeKeys
    ].sort().join("|"))halt();
 return result;
}
const el=(doc,tag,cls,value)=>{
 const e=doc.createElement(tag);e.className=cls;
 if(value!==undefined)e.textContent=String(value);
 return e;
};
const add=(root,doc,tag,cls,value)=>{
 const node=el(doc,tag,cls,value);root.appendChild(node);return node;
};
function metric(doc,title,count){
 const div=el(doc,"div","nico-dual-metric");
 add(div,doc,"small","nico-dual-metric-label",title);
 add(div,doc,"strong","nico-dual-metric-score",String(count)+"件");
 return div;
}
function ranked(doc,heading,items,mode){
 const section=el(doc,"section","nico-dual-ranking");
 add(section,doc,"h3","nico-dual-title",heading);
 if(!items.length){add(section,doc,"p","nico-dual-empty","該当する確定報告はありません");return section;}
 const list=el(doc,"ol","nico-dual-rank-list");
 for(const row of items){
  const line=el(doc,"li","nico-dual-rank-row");
  // A missing report must remain visible as 未報告, never 0件 or a
  // tied numeric rank with a confirmed zero-count submission.
  const unreported=mode==="person"&&row.reportStatus==="未報告";
  add(line,doc,"strong","nico-dual-rank-number",
   unreported?"—":String(row.rank)+"位");
  add(line,doc,"span","nico-dual-rank-name",row.name||"担当者未特定");
  add(line,doc,"strong","nico-dual-rank-score",
   unreported?"未報告":String(row.count)+"件");
  const details=mode==="team"?row.company:mode==="person"?
   [row.companyName||row.company, row.teamName,
    row.reportStatus,row.growth==="比較不可"?"":row.growth,
    row.change!=null?(row.change>0?"+":"")+String(row.change)+"件":"",
    row.topProduct?"得意 "+row.topProduct:""].filter(Boolean).join("｜"):
   [row.ownCount!=null?"自社 "+row.ownCount+"件":"",
    row.partnerCount!=null?"協力店 "+row.partnerCount+"件":""].filter(Boolean).join("｜");
  if(details)add(line,doc,"small","nico-dual-rank-details",details);
  list.appendChild(line);
 }
 section.appendChild(list);return section;
}
// Reuse the same verified count totals for the internal company's visible
// leaderboards. Rank 1,1,3 rather than assigning sequence position.
function competitionFromBreakdown(items,convert){
 const scored=items.map(convert);
 for(const row of scored){
  if(!Number.isSafeInteger(row.count)||row.count<0||
     typeof row.name!=="string"||!row.name.trim())halt();
 }
 scored.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja")||
  (a.company||"").localeCompare(b.company||""));
 let previous=null,rank=0;
 return scored.map((row,i)=>{
  if(i===0||row.count!==previous)rank=i+1;
  previous=row.count;
  return {...row,rank};
 });
}

// The view-only audience switch never reads financial originals or invents
// unsent counts. All rows come from the already verified server payload.
// Company kind is server-owned, not a browser authorization claim.
// Personal and own-company leaderboards use the same tie ranking as the
// public hub board. Unreported people never receive a numeric rank.
function rerankReportedPeople(rows){
 const submitted=competitionFromBreakdown(
  rows.filter(r=>r.reportStatus!=="未報告"),r=>({...r}));
 const unreported=rows.filter(r=>r.reportStatus==="未報告")
  .map(r=>({...r,rank:null}));
 return [...submitted,...unreported];
}
function hubAudienceRows(data,audience){
 if(!["joint","own","partner"].includes(audience))halt();
 if(audience==="joint")return {
  companies:data.companyBreakdown,teams:data.teamBreakdown,
  people:data.memberRanking,products:data.productRanking,total:data.summary.total
 };
 const expectedKind=audience==="own"?"自社":"協力店";
 if(data.companyBreakdown.some(x=>!["自社","協力店"].includes(x.kind)))halt();
 const companies=data.companyBreakdown.filter(x=>x.kind===expectedKind);
 const ids=new Set(companies.map(x=>x.id));
 const total=companies.reduce((sum,x)=>sum+x.count,0);
 if(!Number.isSafeInteger(total)||total!==
    (audience==="own"?data.summary.own:data.summary.partner))halt();
 const teams=data.teamBreakdown.filter(x=>ids.has(x.companyId));
 // Re-rank only verified submissions within the selected company scope.
 const members=rerankReportedPeople(data.memberRanking.filter(x=>ids.has(x.companyId)));
 const products=competitionFromBreakdown(
  data.productRanking.filter(x=>x.companies.some(c=>ids.has(c.companyId))),
  x=>({...x,count:audience==="own"?x.ownCount:x.partnerCount,
   ownCount:audience==="own"?x.ownCount:null,
   partnerCount:audience==="partner"?x.partnerCount:null,
   companies:x.companies.filter(c=>ids.has(c.companyId))
  }));
 const sum=products.reduce((n,x)=>n+x.count,0);
 if(!Number.isSafeInteger(sum)||sum!==total)halt();
 return {companies,teams,people:members,products,total};
}

const validDate=x=>{
 if(typeof x!=="string"||!/^\d{4}-\d\d-\d\d$/.test(x))return false;
 const [y,m,d]=x.split("-").map(Number);
 const t=new Date(0);t.setUTCHours(0,0,0,0);t.setUTCFullYear(y,m-1,d);
 return t.getUTCFullYear()===y&&t.getUTCMonth()+1===m&&t.getUTCDate()===d;
};
/**
 * Static scoped render. Does not generate menus or produce network requests.
 * Throws and empties the root if malformed/financial data reaches the browser.
 */
export function renderVerifiedDualCountDashboard({document,root,payload,audience="joint"}={}){
 if(!document||!root||typeof root.replaceChildren!=="function")halt();
 root.replaceChildren();
 try{
  const data=validate(payload);
  if(!["joint","own","partner"].includes(audience)||
     (data.scope!==undefined&&data.scope!==audience)||
     (data.role!=="hub_owner"&&audience!=="joint"&&data.scope!==audience))halt();
  const board=data.role==="hub_owner"?hubAudienceRows(data,audience):null;
  const page=el(document,"section","nico-dual-dashboard");
  add(page,document,"h2","nico-dual-heading",
    data.role==="hub_owner"?"全社獲得件数・合同ランキング":"自社の獲得件数・成長");
  if(data.role==="hub_owner")
   add(page,document,"p","nico-dual-audience",
    "ランキング表示："+({joint:"合同",own:"自社のみ",partner:"協力店のみ"}[audience]));
  add(page,document,"p","nico-dual-period",
   data.range.start+" 〜 "+data.range.end+"｜全て件数のみ");
  const metrics=el(document,"div","nico-dual-metrics");
  if(data.role==="hub_owner"){
   if(audience==="joint"){
    metrics.appendChild(metric(document,"自社",data.summary.own));
    metrics.appendChild(metric(document,"協力店",data.summary.partner));
    metrics.appendChild(metric(document,"全体",data.summary.total));
   }else{
    metrics.appendChild(metric(document,
     audience==="own"?"自社":"協力店",board.total));
   }
   page.appendChild(metrics);
   const companies=el(document,"section","nico-dual-companies");
   add(companies,document,"h3","nico-dual-title","会社別内訳");
   for(const row of board.companies){
    const line=el(document,"div","nico-dual-company-row");
    add(line,document,"span","nico-dual-company-name",row.name+"（"+row.kind+"）");
    add(line,document,"strong","nico-dual-company-count",
     row.hasVerifiedSubmission?row.count+"件":"未報告");
    companies.appendChild(line);
   }
   page.appendChild(companies);
   const teams=el(document,"section","nico-dual-teams");
   add(teams,document,"h3","nico-dual-title","班別内訳");
   for(const row of board.teams){
    const line=el(document,"div","nico-dual-company-row");
    add(line,document,"span","nico-dual-company-name",row.companyName+"・"+row.name);
    add(line,document,"strong","nico-dual-company-count",row.count+"件");
    teams.appendChild(line);
   }
   page.appendChild(teams);
   page.appendChild(ranked(document,"会社ランキング",
    competitionFromBreakdown(board.companies.filter(x=>x.hasVerifiedSubmission),x=>({
     name:x.name,count:x.count
    })),"company"));
   page.appendChild(ranked(document,"班ランキング",
    competitionFromBreakdown(board.teams,x=>({
     name:x.name,company:x.companyName,count:x.count
    })),"team"));
   page.appendChild(ranked(document,"個人ランキング",board.people,"person"));
   page.appendChild(ranked(document,"商材ランキング",board.products,"product"));
   if(data.summary.unidentified>0)
    add(page,document,"p","nico-dual-unidentified",
     "担当者未特定 "+data.summary.unidentified+"件（個人順位には加算しません）");
  }else{
   add(page,document,"p","nico-dual-audience",
    "ランキング表示："+({joint:"合同",own:"自社のみ",partner:"協力店のみ"}[audience]));
   add(page,document,"p","nico-dual-period",
    "「自社のみ」はNICO本社の公開件数、「協力店のみ」は公開承認済み協力店の件数です。本人の会社の成績は会社名付きの内訳に表示します。");
   metrics.appendChild(metric(document,data.own.company,data.own.count));
   page.appendChild(metrics);
   // Keep the same four leaderboard positions and order as the hub Owner.
   // Partner public rows contain only server-approved names and count totals;
   // never derive cross-company ranks from unapproved own staff records.
   add(page,document,"h3","nico-dual-title",
    ({joint:"合同",own:"自社のみ",partner:"協力店のみ"}[audience])+"ランキング（公開承認済み・件数のみ）");
   page.appendChild(ranked(document,"公開承認済み・会社ランキング",
    data.publicRanking.companies,"company"));
   page.appendChild(ranked(document,"公開承認済み・班ランキング",
    data.publicRanking.teams,"team"));
   page.appendChild(ranked(document,"公開承認済み・個人ランキング",
    data.publicRanking.members,"person"));
   page.appendChild(ranked(document,"公開承認済み・商材ランキング",
    data.publicRanking.products,"product"));
   add(page,document,"h3","nico-dual-title","自分の会社の件数内訳");
   page.appendChild(ranked(document,"自分たちの成果・前期比",
    rerankReportedPeople(data.own.people),"person"));
   page.appendChild(ranked(document,"自社の商材別件数",
    competitionFromBreakdown(data.own.products,p=>({...p})),"product"));
   if(data.own.unidentifiedCount>0)
    add(page,document,"p","nico-dual-unidentified",
     "担当者未特定 "+data.own.unidentifiedCount+"件");
  }
  root.replaceChildren(page);
  return page;
 }catch(error){root.replaceChildren();halt();}
}
/**
 * Integrate with a trusted, authenticated read-only callable. The callback
 * MUST derive companies/permissions on the server; only period/filter go out.
 * Clears stale name/score immediately on identity change and failed reload.
 */
export function createVerifiedDualCountController({
 document,root,auth,load,asOf,availablePeriods=["day","week","month"],
 allowFilters=true
}={}){
 if(!document||!root||typeof root.replaceChildren!=="function"||
    !auth||typeof load!=="function"||!validDate(asOf)||
    !Array.isArray(availablePeriods)||availablePeriods.length<1||
    availablePeriods.length>3||new Set(availablePeriods).size!==availablePeriods.length||
    availablePeriods.some(p=>!["day","week","month"].includes(p))||
    typeof allowFilters!=="boolean")halt();
 const permitted=new Set(availablePeriods);
 let generation=0,closed=false;
 const current={period:availablePeriods[0],day:asOf,filters:{},audience:"joint"};
 const clear=()=>root.replaceChildren();
 const thisSafePeriod=(kind,day=current.day)=>{
  if(!permitted.has(kind)||!validDate(day)||day>asOf)halt();
  current.period=kind;current.day=day;
  return refresh();
 };
 const thisSafeAudience=(value)=>{
  if(!["joint","own","partner"].includes(value))halt();
  current.audience=value;
  current.filters={};
  return refresh(); // Recheck identity and verified server scope.
 };
 const thisSafeFilter=(key,value)=>{
  if(!allowFilters||!["companyId","teamId","uid","productId"].includes(key)||
     typeof value!=="string"||value.length>(key==="productId"?300:200)||
     (value!==""&&!new RegExp("^[A-Za-z0-9_:-]{1,"+(key==="productId"?300:200)+"}$").test(value)))halt();
  // The same teamId / uid may exist in two approved companies. A scoped
  // selection must always carry its company in the server request.
  if((key==="teamId"||key==="uid")&&value!==""&&!current.filters.companyId)halt();
  if(key==="companyId"&&value!==current.filters.companyId){
   delete current.filters.teamId;
   delete current.filters.uid;
  }
  if(key==="teamId"&&value!==current.filters.teamId)
   delete current.filters.uid;
  if(value==="")delete current.filters[key];
  else current.filters[key]=value;
  return refresh();
 };
 async function refresh(){
  if(closed)return false;
  const token=++generation,identity=auth.currentUser;
  clear();
  if(!identity||identity.emailVerified!==true||
     typeof identity.getIdToken!=="function"){return false;}
  try{
   await identity.getIdToken();
   if(identity!==auth.currentUser||token!==generation||closed)halt();
   const result=await load({
    period:{kind:current.period,day:current.day,asOf},
    filters:{...current.filters},scope:current.audience
   });
   if(identity!==auth.currentUser||token!==generation||closed)halt();
   const data=validate(result);
   renderVerifiedDualCountDashboard({document,root,payload:data,audience:current.audience});
   const toolbar=el(document,"section","nico-dual-controls");
   function option(select,value,title,disabled=false){
    const o=el(document,"option","",title);o.value=value;select.appendChild(o);
    o.disabled=disabled;
   }
   function selectControl(title,currentValue,options,handler){
    const wrap=el(document,"label","nico-dual-control");
    add(wrap,document,"span","",title);
    const select=el(document,"select","");
    for(const [value,name,disabled] of options)option(select,value,name,disabled);
    select.value=currentValue??"";
    select.addEventListener("change",()=>{
      if(token!==generation||identity!==auth.currentUser||closed)return;
      return handler(select.value);
    });
    wrap.appendChild(select);toolbar.appendChild(wrap);
   }
   selectControl("集計期間",current.period,[
    ["day","日"],["week","週"],["month","月"]
   ].filter(([value])=>permitted.has(value)),value=>thisSafePeriod(value));
   const scopesVerified=data.role==="hub_owner"||data.scope!==undefined;
   selectControl("ランキング範囲",current.audience,[
     ["joint","合同"],["own","自社のみ",!scopesVerified],["partner","協力店のみ",!scopesVerified]
    ],value=>thisSafeAudience(value));
   const dayWrap=el(document,"label","nico-dual-control");
   const monthOnly=permitted.size===1&&permitted.has("month");
   add(dayWrap,document,"span","",monthOnly?"対象月":"基準日");
   const dayInput=el(document,"input","");
   dayInput.type=monthOnly?"month":"date";
   dayInput.value=monthOnly?current.day.slice(0,7):current.day;
   dayInput.max=monthOnly?asOf.slice(0,7):asOf;
   dayInput.addEventListener("change",()=>{
    if(token!==generation||identity!==auth.currentUser||closed)return;
    void thisSafePeriod(current.period,monthOnly?dayInput.value+"-01":dayInput.value);
   });
   dayWrap.appendChild(dayInput);toolbar.appendChild(dayWrap);
   if(data.role==="hub_owner"&&allowFilters){
    const companyRows=data.companyBreakdown.map(x=>[x.id,x.name]);
    selectControl("会社",current.filters.companyId??"",[
     ["","全社"],...companyRows
    ],v=>thisSafeFilter("companyId",v));
    const teamIds=new Map(),staffIds=new Map(),products=new Map();
    // Never de-duplicate teams/staff across companies by local IDs.
    // A company must be selected before a local team/staff selector is
    // enabled; company switches above clear any stale subordinate filters.
    const selectedCompany=current.filters.companyId??"";
    for(const row of data.teamBreakdown){
     if(!selectedCompany||row.companyId!==selectedCompany||
        !String(row.id).startsWith(selectedCompany+":"))continue;
     const name=String(row.id).slice(selectedCompany.length+1);
     if(ID.test(name))teamIds.set(name,row.name);
    }
    for(const row of data.memberRanking){
     if(!selectedCompany||row.companyId!==selectedCompany||
        !String(row.id).startsWith(selectedCompany+":"))continue;
     const uid=String(row.id).slice(selectedCompany.length+1);
     if(ID.test(uid))staffIds.set(uid,row.name+"（"+row.companyName+"）");
    }
    for(const row of data.productRanking){
     if(typeof row.id==="string"&&row.id.length<=300)
      products.set(row.id,row.name);
    }
    selectControl("班",current.filters.teamId??"",[
     ["",selectedCompany?"全班":"会社を選択"],
     ...[...teamIds].map(([id,name])=>[id,name])
    ],v=>thisSafeFilter("teamId",v));
    selectControl("担当者",current.filters.uid??"",[
     ["",selectedCompany?"全員":"会社を選択"],
     ...[...staffIds].map(([id,name])=>[id,name])
    ],v=>thisSafeFilter("uid",v));
    selectControl("商材",current.filters.productId??"",[
     ["","全商材"],...[...products].map(([id,name])=>[id,name])
    ],v=>thisSafeFilter("productId",v));
   }
   const page=root.children[0];
   root.replaceChildren(toolbar,page);
   return true;
  }catch{
   clear();
   if(token===generation&&!closed)
    add(root,document,"p","nico-dual-error",
     "件数を確認できません。再読み込みしてください。");
   return false;
  }
 }
 return Object.freeze({
  refresh,
  setPeriod(kind,day){
   return thisSafePeriod(kind,day);
  },
  setFilter(key,value){
   if(closed)halt();
   return thisSafeFilter(key,value??"");
  },
  setAudience(value){
   if(closed)halt();
   return thisSafeAudience(value);
  },
  onAuthChange(){generation++;clear();current.audience="joint";current.filters={};},
  destroy(){closed=true;generation++;clear();}
 });
}
