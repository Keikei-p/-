/**
 * Staging-only mobile views for the VERIFIED dual-count response.
 * No Firestore or network logic. The server MUST authenticate fresh identity,
 * reconcile all originals and enforce hub/partner scopes before returning data.
 * No innerHTML, browser storage, unknown fields or financial values.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const MONEY=/(?:売上|単価|キャッシュバック|報酬|利益|[¥￥$€]|(?:CB|cashback|revenue|unitPrice|commission)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円))/i;
const FORBIDDEN=/^(?:totalRevenue|revenue|revenuePerUnit|unitPrice|price|pricingOptions|cashback|cashbackOptions|amount|beforeRevenue|afterRevenue|bankAccount|phone|email|recordCorrections|audit|correctionHistory)$/i;
const halt=()=>{throw Error("合同件数の権限・結果を確認できません。ログインし直してください。");};
function inspect(value,depth=0){
 if(depth>15)halt();
 if(typeof value==="string"&&MONEY.test(value))halt();
 if(value===null||typeof value!=="object")return;
 if(Array.isArray(value)){
  if(value.length>5000)halt();
  for(const x of value)inspect(x,depth+1);
  return;
 }
 for(const [k,v] of Object.entries(value)){
  if(FORBIDDEN.test(k))halt();
  inspect(v,depth+1);
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
 inspect(result);
 if(result.role==="hub_owner"){
  if(!result.summary||!Number.isSafeInteger(result.summary.total)||
     !Array.isArray(result.companyBreakdown)||
     !Array.isArray(result.teamBreakdown)||
     !Array.isArray(result.memberRanking)||
     !Array.isArray(result.productRanking)||
     !result.filters||Object.keys(result).sort().join("|")!==
       ["schema","period","range","readTime","unit","summary","role",
        "companyBreakdown","teamBreakdown","memberRanking","productRanking","filters"
       ].sort().join("|"))halt();
 }else if(!result.own||!Number.isSafeInteger(result.own.count)||
    !Array.isArray(result.own.people)||!Array.isArray(result.own.products)||
    !result.publicRanking||!Array.isArray(result.publicRanking.members)||
    !Array.isArray(result.publicRanking.products)||
    Object.keys(result).sort().join("|")!==
    ["schema","period","range","readTime","unit","role","own","publicRanking"
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
  add(line,doc,"strong","nico-dual-rank-number",String(row.rank)+"位");
  add(line,doc,"span","nico-dual-rank-name",row.name||"担当者未特定");
  add(line,doc,"strong","nico-dual-rank-score",String(row.count)+"件");
  const details=mode==="person"?
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
const validDate=x=>typeof x==="string"&&/^\d{4}-\d\d-\d\d$/.test(x);
/**
 * Static scoped render. Does not generate menus or produce network requests.
 * Throws and empties the root if malformed/financial data reaches the browser.
 */
export function renderVerifiedDualCountDashboard({document,root,payload}={}){
 if(!document||!root||typeof root.replaceChildren!=="function")halt();
 root.replaceChildren();
 try{
  const data=validate(payload);
  const page=el(document,"section","nico-dual-dashboard");
  add(page,document,"h2","nico-dual-heading",
    data.role==="hub_owner"?"全社獲得件数・合同ランキング":"自社の獲得件数・成長");
  add(page,document,"p","nico-dual-period",
   data.range.start+" 〜 "+data.range.end+"｜全て件数のみ");
  const metrics=el(document,"div","nico-dual-metrics");
  if(data.role==="hub_owner"){
   metrics.appendChild(metric(document,"自社",data.summary.own));
   metrics.appendChild(metric(document,"協力店",data.summary.partner));
   metrics.appendChild(metric(document,"全体",data.summary.total));
   page.appendChild(metrics);
   const companies=el(document,"section","nico-dual-companies");
   add(companies,document,"h3","nico-dual-title","会社別内訳");
   for(const row of data.companyBreakdown){
    const line=el(document,"div","nico-dual-company-row");
    add(line,document,"span","nico-dual-company-name",row.name+"（"+row.kind+"）");
    add(line,document,"strong","nico-dual-company-count",row.count+"件");
    companies.appendChild(line);
   }
   page.appendChild(companies);
   const teams=el(document,"section","nico-dual-teams");
   add(teams,document,"h3","nico-dual-title","班別内訳");
   for(const row of data.teamBreakdown){
    const line=el(document,"div","nico-dual-company-row");
    add(line,document,"span","nico-dual-company-name",row.companyName+"・"+row.name);
    add(line,document,"strong","nico-dual-company-count",row.count+"件");
    teams.appendChild(line);
   }
   page.appendChild(teams);
   page.appendChild(ranked(document,"個人ランキング",data.memberRanking,"person"));
   page.appendChild(ranked(document,"商材ランキング",data.productRanking,"product"));
   if(data.summary.unidentified>0)
    add(page,document,"p","nico-dual-unidentified",
     "担当者未特定 "+data.summary.unidentified+"件（個人順位には加算しません）");
  }else{
   metrics.appendChild(metric(document,data.own.company,data.own.count));
   page.appendChild(metrics);
   page.appendChild(ranked(document,"自分たちの成果・前期比",data.own.people
    .map((p,i)=>({...p,rank:p.rank||i+1})),"person"));
   page.appendChild(ranked(document,"自社の商材別件数",data.own.products
    .map((p,i)=>({...p,rank:p.rank||i+1})),"product"));
   page.appendChild(ranked(document,"公開承認済み・個人ランキング",
    data.publicRanking.members,"person"));
   page.appendChild(ranked(document,"公開承認済み・商材ランキング",
    data.publicRanking.products,"product"));
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
 document,root,auth,load,asOf
}={}){
 if(!document||!root||typeof root.replaceChildren!=="function"||
    !auth||typeof load!=="function"||!validDate(asOf))halt();
 let generation=0,closed=false;
 const current={period:"day",day:asOf,filters:{}};
 const clear=()=>root.replaceChildren();
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
    filters:{...current.filters}
   });
   if(identity!==auth.currentUser||token!==generation||closed)halt();
   renderVerifiedDualCountDashboard({document,root,payload:result});
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
   if(closed||!["day","week","month"].includes(kind)||
      !validDate(day)||day>asOf)halt();
   current.period=kind;current.day=day;
   return refresh();
  },
  setFilter(key,value){
   if(closed||!["companyId","teamId","uid","productId"].includes(key)||
      !(value==null||value===""||typeof value==="string"&&value.length<=200))halt();
   if(value==null||value==="")delete current.filters[key];
   else if(!ID.test(value))halt();
   else current.filters[key]=value;
   return refresh();
  },
  onAuthChange(){generation++;clear();},
  destroy(){closed=true;generation++;clear();}
 });
}
