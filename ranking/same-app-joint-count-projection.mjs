/**
 * UI-only projection of the EXISTING authenticated canonical joint-count GET.
 * No company-specific product ON/OFF, new SKU mapping or Firestore operations.
 * Never synthesize historical counts, person/team attribution or a reported 0.
 * Never copy monetary details or the original self-company finance DOM.
 */
const BAD_KEY=/(?:revenue|sales|amount|price|unitprice|cashback|commission|salary|profit|margin|payment|fee|売上|単価|金額|報酬|利益|キャッシュバック|原価)/i;
const BAD_TEXT=/(?:[¥￥$€]|(?:[0-9０-９])[0-9０-９.,，]*\s*(?:万円|千円|円)|(?:売上|単価|報酬|cashback|commission|revenue|unitprice)\s*[:=_-]*\s*[0-9０-９])/i;
const fail=()=>{throw Error("SAME_APP_JOINT_COUNT_UNVERIFIED");};
const obj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const count=v=>Number.isSafeInteger(v)&&v>=0?v:fail();
const label=v=>typeof v==="string"&&v.trim()&&v.length<=150&&
 !BAD_TEXT.test(v.normalize("NFKC"))?v.trim():fail();
const rank=v=>v===null?null:Number.isSafeInteger(v)&&v>0?v:fail();
const array=(v,max=10000)=>Array.isArray(v)&&v.length<=max?v:fail();
function audit(value,depth=0){
 if(depth>28)fail();
 if(typeof value==="string"){
  if(value.length>20000||BAD_TEXT.test(value.normalize("NFKC")))fail();
  return;
 }
 if(Array.isArray(value)){if(value.length>10000)fail();for(const v of value)audit(v,depth+1);return;}
 if(obj(value)){
  for(const [key,v]of Object.entries(value)){
   if(BAD_KEY.test(key))fail();
   audit(v,depth+1);
  }
  return;
 }
 if(value!==null&&typeof value!=="boolean"&&
    !(typeof value==="number"&&Number.isFinite(value)))fail();
}
const row=v=>{if(!obj(v))fail();return {name:label(v.name),count:count(v.count),rank:rank(v.rank)};};
const posted=v=>v!=="未報告";
function uniqueRanks(rows){
 const ordered=rows.filter(v=>v.rank!==null).slice().sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja"));
 let last=null,lastRank=0;
 for(let i=0;i<ordered.length;i++){
  const expected=last===ordered[i].count?lastRank:i+1;
  if(ordered[i].rank!==expected)fail();
  last=ordered[i].count;lastRank=expected;
 }
 return rows;
}
function assignRank(rows){
 const list=rows.slice().sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja"));
 let previous=null,lastRank=0;
 return list.map((item,i)=>{
  const current=previous===item.count?lastRank:i+1;
  previous=item.count;lastRank=current;
  return {...item,rank:current};
 });
}
function detail(team){
 if(!obj(team)||!obj(team.detail)||team.detail.schema!=="nico-team-count-detail-v1")fail();
 const t=team.detail;
 const members=array(t.members,150).map(m=>{
  if(!obj(m))fail();
  return {name:label(m.name),count:count(m.count),
   reported:posted(m.reportStatus)};
 });
 const products=array(t.products,1000).map(p=>{
  if(!obj(p))fail();
  return {name:label(p.name),count:count(p.count)};
 });
 const total=count(team.count);
 if(members.reduce((n,m)=>n+m.count,0)!==total||
    products.reduce((n,p)=>n+p.count,0)!==total)fail();
 return {name:label(team.companyName)+"・"+label(team.name),count:total,
  reported:posted(t.reportStatus),members,products};
}
export function buildSameAppJointCountProjection(response,{partner=false}={}){
 if(!obj(response)||response.schema!=="nico-verified-dual-count-v1"||
  response.unit!=="件"||!["day","week","month"].includes(response.period)||
  response.role!==(partner?"partner_owner":"hub_owner")||
  !obj(response.range))fail();
 // The backend's exact role envelope is checked separately by its HTTP
 // adapter; this extra audit rejects monetary keys/values before the DOM.
 audit(response);
 const common={period:response.period,range:response.range,
  financeIncluded:false,source:"canonical_server_only"};
 if(partner){
  const pub=response.publicRanking;
  if(!obj(pub)||!obj(response.own))fail();
  const personRows=uniqueRanks(array(pub.members).map(v=>({
   ...row(v),name:label(v.company)+"・"+label(v.name)
  })));
  const productRows=uniqueRanks(array(pub.products).map(row));
  const teamRows=uniqueRanks(array(pub.teams).map(v=>({
   ...row(v),name:label(v.company)+"・"+label(v.name)
  })));
  const companyRows=uniqueRanks(array(pub.companies).map(row));
  // Another partner's member details are NOT part of this authorized
  // envelope. Do not infer or render them.
  const ownCount=count(response.own.count);
  return Object.freeze({...common,role:"partner",total:null,ownCount,
   personRows,productRows,teamRows,companyRows,
   teamDetails:teamRows.map(x=>({name:x.name,count:x.count,
    reported:true,members:[],products:[]}))});
 }
 if(!obj(response.summary)||!Array.isArray(response.memberRanking)||
    !Array.isArray(response.productRanking))fail();
 const total=count(response.summary.total),self=count(response.summary.own),
  partnerCount=count(response.summary.partner);
 if(self+partnerCount!==total)fail();
 const productRows=uniqueRanks(array(response.productRanking).map(row));
 if(productRows.reduce((n,p)=>n+p.count,0)!==total)fail();
 const personRows=uniqueRanks(array(response.memberRanking).filter(p=>
   obj(p)&&posted(p.reportStatus)).map(p=>({
    ...row(p),name:label(p.companyName)+"・"+label(p.name)
   })));
 const companyRows=assignRank(array(response.companyBreakdown,100).filter(c=>
  obj(c)&&posted(c.reportStatus)).map(c=>({
  name:label(c.name),count:count(c.count)
 })));
 const teamRows=assignRank(array(response.teamBreakdown,400).filter(t=>
   obj(t)&&obj(t.detail)&&posted(t.detail.reportStatus)).map(t=>({
    name:label(t.companyName)+"・"+label(t.name),count:count(t.count)
   })));
 const companyCount=companyRows.reduce((n,c)=>n+c.count,0);
 if(companyCount>total)fail();
 const teamDetails=array(response.teamBreakdown,400).map(detail);
 return Object.freeze({...common,role:"hub",total,ownCount:self,
  partnerCount,personRows,productRows,companyRows,teamRows,teamDetails});
}
