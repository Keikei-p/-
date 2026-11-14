/**
 * STAGING / NO DEPLOY: reuse the SAME server-verified four ranking lists in
 * the existing owner/partner dashboard cards. Never read raw Firestore records,
 * products, prices or compute a parallel company/partner leaderboard.
 */
import {validateVerifiedDualCountDashboard} from "./verified-dual-count-view.mjs";
const FAIL=()=>{throw Error("VERIFIED_INLINE_JOINT_COUNT_BLOCKED");};
const FIELDS=["companies","teams","people","products"];
// Keep view-level label filtering at least as strict as the verified response.
const NAME_BAD=/(?:売上|単価|収益|原価|価格|報酬|利益|キャッシュバック|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|salary|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円)|[\r\n\t@])/i;
function name(value){
 if(typeof value!=="string"||!value.trim()||value.length>100||
    NAME_BAD.test(value.normalize("NFKC")))FAIL();
 return value.trim();
}
function count(value){
 if(!Number.isSafeInteger(value)||value<0)FAIL();
 return value;
}
function competition(rows){
 const ranked=[...rows].sort((a,b)=>b.count-a.count||
  a.name.localeCompare(b.name,"ja")||(a.company||"").localeCompare(b.company||""));
 let last=null,rank=0;
 return ranked.map((row,i)=>{
  if(i===0||row.count!==last)rank=i+1;
  last=row.count;
  return {...row,rank};
 });
}
function normal(row){
 return {name:name(row.name),company:row.companyName==null?
    (row.company==null?null:name(row.company)):name(row.companyName),
  count:count(row.count),rank:count(row.rank)};
}
function verifyRanked(rows,{allowRedactedGaps=false}={}){
 let previous=null,previousRank=0,rank=0;
 return rows.map((row,i)=>{
  const item=normal(row);
  if(item.rank<1||(previous!==null&&item.count>previous))FAIL();
  if(allowRedactedGaps){
   if(previous!==null&&
      (item.count===previous?item.rank!==previousRank:item.rank<=previousRank))FAIL();
  }else{
   if(i===0||item.count!==previous)rank=i+1;
   if(item.rank!==rank)FAIL();
  }
  previous=item.count;
  previousRank=item.rank;
  return item;
 });
}
export function projectVerifiedInlineJointCards(payload,{expectedRole,period,start,end}={}){
 const data=validateVerifiedDualCountDashboard(payload);
 if(data.role!==expectedRole||data.period!==period||
    !["hub_owner","partner_owner"].includes(expectedRole)||
    !["day","week","month"].includes(period)||
    typeof start!=="string"||typeof end!=="string"||
    data.range.start!==start||data.range.end!==end)FAIL();
 const result=data.role==="hub_owner"?{
  companies:competition(data.companyBreakdown.filter(x=>x.reportStatus!=="未報告")
   .map(x=>({name:name(x.name),company:null,count:count(x.count)}))),
  teams:competition(data.teamBreakdown.filter(x=>
    x.detail?.reportStatus!=="未報告"&&(x.detail!==undefined||x.count>0))
   .map(x=>({name:name(x.name),company:name(x.companyName),count:count(x.count)}))),
  people:verifyRanked(data.memberRanking.filter(x=>x.rank!==null)),
  products:verifyRanked(data.productRanking)
 }:{
  companies:verifyRanked(data.publicRanking.companies,{allowRedactedGaps:true}),
  teams:verifyRanked(data.publicRanking.teams,{allowRedactedGaps:true}),
  people:verifyRanked(data.publicRanking.members,{allowRedactedGaps:true}),
  products:verifyRanked(data.publicRanking.products,{allowRedactedGaps:true})
 };
 return Object.freeze({schema:"nico-inline-verified-joint-count-v1",
  role:data.role,period,start,end,
  ...Object.fromEntries(FIELDS.map(k=>[k,Object.freeze(result[k])]))});
}
const element=(document,tag,cls,value)=>{
 const x=document.createElement(tag);
 x.className=cls;
 if(value!==undefined)x.textContent=String(value);
 return x;
};
export function renderVerifiedInlineJointCards({
 document,roots,payload,expectedRole,period,start,end
}={}){
 if(!document?.createElement||!roots||typeof roots!=="object"||
    FIELDS.some(k=>typeof roots[k]?.replaceChildren!=="function"))FAIL();
 const clear=()=>{for(const k of FIELDS)roots[k].replaceChildren();};
 try{
  const projected=projectVerifiedInlineJointCards(payload,{expectedRole,period,start,end});
  const fragments={};
  // Construct all four views BEFORE mutating the currently visible cards.
  for(const k of FIELDS){
   const container=document.createElement("div");
   container.className="nico-joint-inline-count-rows";
   const rows=projected[k];
   if(rows.length===0)
    container.appendChild(element(document,"p","empty-message","確定した報告はありません"));
   for(const item of rows){
    const row=element(document,"div","ranking-row");
    row.appendChild(element(document,"strong","ranking-number",item.rank+"位"));
    const info=element(document,"div","ranking-left");
    info.appendChild(element(document,"span","ranking-name",item.name));
    if(item.company)
     info.appendChild(element(document,"small","ranking-sub",item.company));
    row.appendChild(info);
    row.appendChild(element(document,"strong","ranking-count",item.count+"件"));
    container.appendChild(row);
   }
   fragments[k]=container;
  }
  for(const k of FIELDS)roots[k].replaceChildren(fragments[k]);
  return projected;
 }catch{clear();FAIL();}
}
