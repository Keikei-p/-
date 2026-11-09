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
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const BAD=/(?:売上|単価|収益|報酬|利益|キャッシュバック|[¥￥$€]|(?:cashback|revenue|unitPrice|amount|price|commission)[\s:_=-]*[0-9０-９]|[0-9０-９][0-9０-９.,，]*\s*(?:円|万円))/i;
const BLOCK=()=>{throw Error("JOINT_RANKING_RESPONSE_UNVERIFIED");};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const number=x=>Number.isSafeInteger(x)&&x>=0;
const text=x=>{
 if(typeof x!=="string"||x.trim().length===0||x.length>100||
    BAD.test(x))BLOCK();
 return x.trim();
};
const rankRows=(value,allowedKeys)=>{
 if(!Array.isArray(value)||value.length>10000)BLOCK();
 const out=[],ids=new Set();
 for(const row of value){
  if(!obj(row)||!number(row.count)||!number(row.rank)||row.rank<1||
     !allowedKeys.every(key=>key in row))BLOCK();
  const id=text(row.id??row.name??("rank-"+row.rank));
  if(ids.has(id))BLOCK();
  ids.add(id);
  out.push({id,rank:row.rank,
   name:text(row.name),count:row.count});
 }
 return out.sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name,"ja"));
};
/** Validate and narrow the server response BEFORE rendering any content. */
export function verifiedJointCountView(response,{month,role}={}){
 if(!MONTH.test(month||"")||!obj(response)||
    response.schema!=="nico-verified-dual-count-v1"||
    response.period!=="month"||
    !["hub_owner","partner_owner"].includes(role)||
    response.role!==role||response.unit!=="件"||
    !obj(response.range)||!obj(response.range.from)&&
      !obj(response.range.start)&&
      typeof response.range.start!=="string"||
    (typeof response.readTime!=="string"||
     Number.isNaN(Date.parse(response.readTime))))BLOCK();

 // Reject hidden financial fields, including nested extensions, even if
 // the server accidentally changes projection or adds finance to metadata.
 const json=JSON.stringify(response);
 if(/"(?:records|lines|rawProducts|revenue|unitPrice|cashback|price|amount|totalRevenue|unitRevenue|commission)"\s*:/i.test(json)||
    json.length>1000000)BLOCK();
 let people,products;
 if(role==="hub_owner"){
  if(!obj(response.summary)||!number(response.summary.total)||
     !number(response.summary.own)||
     !number(response.summary.partner)||
     response.summary.own+response.summary.partner!==response.summary.total)BLOCK();
  people=rankRows(response.memberRanking,["name","count","rank"]);
  products=rankRows(response.productRanking,["name","count","rank"]);
 }else{
  if(!obj(response.publicRanking)||!obj(response.own)||
     !number(response.own.count))BLOCK();
  people=rankRows(response.publicRanking.members,["name","count","rank"]);
  products=rankRows(response.publicRanking.products,["name","count","rank"]);
 }
 return Object.freeze({role,month,unit:"件",
  total:role==="hub_owner"?response.summary.total:null,
  ownCount:role==="hub_owner"?response.summary.own:response.own.count,
  people:Object.freeze(people),products:Object.freeze(products)});
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
  r.rank+"位  "+r.name+"  "+r.count+"件"));
 section.appendChild(ol);
 return section;
}
/**
 * No writes. Credentials only in Authorization header; no URL tokens.
 * Client-supplied role is never used for authentication by the API.
 */
export function createVerifiedJointRankingPanel({
 featureEnabled=false,document,root,auth,fetchApi,roleProvider
}={}){
 if(!document?.createElement||!root?.replaceChildren||
    !auth||typeof fetchApi!=="function"||
    typeof roleProvider!=="function")BLOCK();
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
   const url=ORIGIN+URL_PATH+"?month="+encodeURIComponent(month);
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
