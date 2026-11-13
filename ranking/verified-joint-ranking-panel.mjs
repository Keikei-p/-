/**
 * STAGING ONLY / NO DEPLOY.
 * A read-only count ranking view for the existing owner/partner dashboards.
 * It calls ONLY the authenticated count ranking API; it never opens
 * Firestore collections, changes sales data or trusts a browser role flag.
 *
 * Wire to the real dashboard only after the production route and Rules
 * access tests pass. The default release switch is OFF.
 */
const ORIGIN="https://nico-factory.web.app";
const URL_PATH="/v1/owner-visible-counts";
// The only other trusted ingress is the verified, fixed Firebase Function URL.
// This does NOT make an arbitrary token-bearing API destination configurable.
const DIRECT_FUNCTION_URL="https://asia-northeast1-sales-management-cc116.cloudfunctions.net/getVerifiedJointCountRanking";
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const DATE=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function monthRangeMatches(range,month){
 if(!obj(range)||range.start!==month+"-01"||
    typeof range.end!=="string"||!DATE.test(range.end)||
    range.end.slice(0,7)!==month||
    !Number.isSafeInteger(range.days))return false;
 const [year,mon,day]=range.end.split("-").map(Number);
 const check=new Date(0);
 check.setUTCHours(0,0,0,0);
 check.setUTCFullYear(year,mon-1,day);
 return check.getUTCFullYear()===year&&check.getUTCMonth()+1===mon&&
  check.getUTCDate()===day&&range.days===day;
}
const BAD=/(?:売上|単価|収益|報酬|利益|キャッシュバック|[¥￥$€]|(?:cashback|revenue|unitPrice|amount|price|commission)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:円|万円))/i;
const BLOCK=()=>{throw Error("JOINT_RANKING_RESPONSE_UNVERIFIED");};
const TRUSTED_ENDPOINTS=Object.freeze({
 hosting:ORIGIN+URL_PATH,
 "direct-function":DIRECT_FUNCTION_URL
});
export function jointRankingEndpoint(transport="hosting"){
 if(typeof transport!=="string"||
    !Object.prototype.hasOwnProperty.call(TRUSTED_ENDPOINTS,transport))BLOCK();
 return TRUSTED_ENDPOINTS[transport];
}
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const number=x=>Number.isSafeInteger(x)&&x>=0;
const text=x=>{
 if(typeof x!=="string"||x.trim().length===0||x.length>100||
    BAD.test(x))BLOCK();
 return x.trim();
};
const rankRows=(value,allowedKeys,companyKey=null)=>{
 if(!Array.isArray(value)||value.length>10000)BLOCK();
 const out=[],ids=new Set();
 for(const [index,row] of value.entries()){
  if(!obj(row)||!number(row.count)||!number(row.rank)||row.rank<1||
     !allowedKeys.every(key=>key in row)||
     (companyKey!==null&&!(companyKey in row)))BLOCK();
  // Public partner rankings intentionally omit personal IDs. Tied ranks
  // and identical names across companies are valid; never coalesce people.
  const id=row.id==null?"public-"+index:text(row.id);
  if(ids.has(id))BLOCK();
  ids.add(id);
  // Company names are part of the vetted server ranking projection.
  // Preserve them to distinguish identical names across organizations.
  out.push({id,rank:row.rank,
   name:text(row.name),company:companyKey===null?null:text(row[companyKey]),
   count:row.count});
 }
 // A stale or misjoined result must not show contradictory rankings.
 // Gaps can be legitimate when the server redacts private participants;
 // equal counts must still tie, and larger counts must never rank lower.
 const ranked=out.sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name,"ja"));
 for(let i=1;i<ranked.length;i++){
  const prev=ranked[i-1],next=ranked[i];
  if(prev.count<next.count||
     (prev.count===next.count&&prev.rank!==next.rank)||
     (prev.count>next.count&&prev.rank===next.rank))BLOCK();
 }
 return ranked;
};
/**
 * The hub-only existing company/team breakdowns contain no rank field.
 * Rank only validated name/count labels; IDs stay internal to this view.
 * Ties use competition rank (1, 1, 3), never client-provided totals.
 */
function rankBreakdown(value,companyKey=null){
 if(!Array.isArray(value)||value.length>10000)BLOCK();
 const seen=new Set();
 const ordered=value.map((row,index)=>{
  if(!obj(row)||!number(row.count)||typeof row.id!=="string")BLOCK();
  const id=text(row.id);
  const identity=companyKey===null?id:JSON.stringify([row.companyId??row[companyKey],id]);
  if(seen.has(identity))BLOCK();
  seen.add(identity);
  return {id,index,name:text(row.name),count:row.count,
   company:companyKey===null?null:text(row[companyKey])};
 }).sort((a,b)=>b.count-a.count||
   a.name.localeCompare(b.name,"ja")||
   a.id.localeCompare(b.id));
 let previous=null,rank=0;
 return ordered.map((row,index)=>{
  if(previous!==row.count)rank=index+1;
  previous=row.count;
  return {...row,rank};
 });
}
/** Validate and narrow the server response BEFORE rendering any content. */
export function verifiedJointCountView(response,{month,role}={}){
 if(!MONTH.test(month||"")||!obj(response)||
    response.schema!=="nico-verified-dual-count-v1"||
    response.period!=="month"||
    !["hub_owner","partner_owner"].includes(role)||
    response.role!==role||response.unit!=="件"||
    !monthRangeMatches(response.range,month)||
    (typeof response.readTime!=="string"||
     Number.isNaN(Date.parse(response.readTime))))BLOCK();

 // Reject hidden financial fields, including nested extensions, even if
 // the server accidentally changes projection or adds finance to metadata.
 const json=JSON.stringify(response);
 if(/"(?:records|lines|rawProducts|revenue|unitPrice|cashback|price|amount|totalRevenue|unitRevenue|commission)"\s*:/i.test(json)||
    json.length>1000000)BLOCK();
 let people,products,companies,teams;
 if(role==="hub_owner"){
  if(!obj(response.summary)||!number(response.summary.total)||
     !number(response.summary.own)||
     !number(response.summary.partner)||
     response.summary.own+response.summary.partner!==response.summary.total)BLOCK();
  // The verified source retains unreported roster entries with rank:null
  // for Owner's missing-report workflow. They MUST NOT appear in standings.
  const eligible=response.memberRanking.filter(p=>{
   if(p?.rank===null){
    if(p.reportStatus!=="未報告"||p.count!==0)BLOCK();
    return false;
   }
   if(p?.reportStatus==="未報告")BLOCK();
   return true;
  });
  people=rankRows(eligible,["name","count","rank"],"companyName");
  products=rankRows(response.productRanking,["name","count","rank"]);
  // Owner company/team metadata also contains registered but unreported
  // entries. They belong in the management drilldown, never in the ranking.
  // Genuine submitted zero counts remain rankable, including old Quick days.
  for(const row of response.companyBreakdown){
   if(!obj(row)||!number(row.count)||
      !["未報告","確定0件","報告済"].includes(row.reportStatus)||
      (row.reportStatus==="未報告"&&row.count!==0)||
      (row.reportStatus==="確定0件"&&row.count!==0)||
      (row.reportStatus==="報告済"&&row.count===0))BLOCK();
  }
  companies=rankBreakdown(response.companyBreakdown.filter(
   row=>row.reportStatus!=="未報告"));
  teams=rankBreakdown(response.teamBreakdown.filter(row=>
   row.detail?.reportStatus!=="未報告"&&
   (row.detail!==undefined||row.count>0)),"companyName");
  if(companies.reduce((total,x)=>total+x.count,0)!==response.summary.total)BLOCK();
 }else{
  if(!obj(response.publicRanking)||!obj(response.own)||
     !number(response.own.count))BLOCK();
  people=rankRows(response.publicRanking.members,["name","count","rank"],"company");
  products=rankRows(response.publicRanking.products,["name","count","rank"]);
  companies=rankRows(response.publicRanking.companies,["name","count","rank"]);
  teams=rankRows(response.publicRanking.teams,["name","count","rank"],"company");
  if(companies.reduce((total,x)=>total+x.count,0)!==
     products.reduce((total,x)=>total+x.count,0))BLOCK();
 }
 return Object.freeze({role,month,unit:"件",
  total:role==="hub_owner"?response.summary.total:null,
  ownCount:role==="hub_owner"?response.summary.own:response.own.count,
  people:Object.freeze(people),products:Object.freeze(products),
  companies:Object.freeze(companies),teams:Object.freeze(teams)});
}
const el=(document,tag,content)=>{
 const node=document.createElement(tag);
 if(content!==undefined)node.textContent=content;
 return node;
};
function list(document,title,rows){
 const section=el(document,"section");
 section.appendChild(el(document,"h3",title));
 const ol=el(document,"ol");
 if(!rows.length)ol.appendChild(el(document,"li","対象件数がありません"));
 for(const r of rows)ol.appendChild(el(document,"li",
  r.rank+"位  "+r.name+(r.company?"（"+r.company+"）":"")+"  "+r.count+"件"));
 section.appendChild(ol);
 return section;
}
/**
 * No writes. Credentials only in Authorization header; no URL tokens.
 * Client-supplied role is never used for authentication by the API.
 */
export function createVerifiedJointRankingPanel({
 featureEnabled=false,document,root,auth,fetchApi,roleProvider,
 transport="hosting"
}={}){
 if(!document?.createElement||!root?.replaceChildren||
    !auth||typeof fetchApi!=="function"||
    typeof roleProvider!=="function")BLOCK();
 // Fail closed before acquiring an ID token if an unknown destination is given.
 const endpoint=jointRankingEndpoint(transport);
 let seq=0,destroyed=false,activeIdentity=null;
 const clear=()=>{root.replaceChildren()};
 async function refresh(month){
  const run=++seq;
  if(destroyed)return false;
  clear();
  if(featureEnabled!==true)return false;
  if(!MONTH.test(month||""))BLOCK();
  const user=auth.currentUser;
  if(!user||user.emailVerified!==true||
     typeof user.getIdToken!=="function"||
     typeof user.uid!=="string")return false;
  const originalUid=user.uid;
  try{
   const token=await user.getIdToken();
   if(run!==seq||destroyed||auth.currentUser!==user)return false;
   if(typeof token!=="string"||token.length<20)BLOCK();
   const url=endpoint+"?month="+encodeURIComponent(month);
   const result=await fetchApi(url,{
    method:"GET",headers:{Authorization:"Bearer "+token,
     Accept:"application/json"},cache:"no-store"
   });
   if(run!==seq||destroyed||auth.currentUser!==user||
      user.uid!==originalUid)return false;
   if(!result||result.ok!==true||
      typeof result.json!=="function")BLOCK();
   const raw=await result.json();
   if(run!==seq||destroyed||auth.currentUser!==user)return false;
   const role=roleProvider();
   const view=verifiedJointCountView(raw,{month,role});
   const section=el(document,"section");
   section.appendChild(el(document,"h2","合同件数ランキング"));
   section.appendChild(el(document,"p",
    month+"／対象商材の件数のみ表示"));
   if(view.total!==null)section.appendChild(el(document,"p",
    "合同合計 "+view.total+"件（自社 "+view.ownCount+"件）"));
   else section.appendChild(el(document,"p",
    "自社の対象件数 "+view.ownCount+"件"));
   section.appendChild(list(document,"個人ランキング",view.people));
   section.appendChild(list(document,"会社ランキング",view.companies));
   section.appendChild(list(document,"班ランキング",view.teams));
   section.appendChild(list(document,"商材ランキング",view.products));
   root.replaceChildren(section);
   activeIdentity=originalUid;
   return true;
  }catch{
   if(!destroyed&&seq===run&&auth.currentUser===user){
    clear();
    root.appendChild(el(document,"p",
     "合同ランキングを確認できません。既存の件数データは変更していません。"));
   }
   return false;
  }
 }
 return Object.freeze({
  refresh,
  onAuthChange(){seq++;activeIdentity=null;clear()},
  destroy(){destroyed=true;seq++;activeIdentity=null;clear()},
  getActiveUid:()=>activeIdentity
 });
}
