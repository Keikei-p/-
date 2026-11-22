/**
 * Pure DOM renderer for the verified canonical joint count response only.
 * No product switch, Firebase SDK calls, finance DOM, count-save mutation,
 * third-party HTML, or synthetic ranks. Existing iOS/Android form remains.
 */
export function renderSameAppJointCountPanel({
 document,root,status,view,partner=false,detail=false,selection="",appendRankRow
}={}){
 if(!document?.createElement||!root?.replaceChildren||
    !status||!view||view.financeIncluded!==false||
    view.role!==(partner?"partner":"hub"))
  throw Error("SAME_APP_JOINT_PANEL_UNVERIFIED");
 const element=(tag,cls,text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
 };
 root.replaceChildren();
 if(detail){
  const companyCards=new Map();
  for(const team of view.teamDetails){
   let parent=root;
   if(team.companyName){
    const key=team.companyId??team.companyName;
    if(!companyCards.has(key)){
     const group=element("details","owner-partner-company-card");
     group.append(element("summary",null,team.companyName));
     companyCards.set(key,group);root.append(group);
    }
    parent=companyCards.get(key);
   }
   const card=element("details","partner-count-team-card");
   const summary=element("summary","team-detail-header");
   summary.append(element("strong","team-detail-title",team.teamName??team.name),
    element("span","team-detail-total",team.reported?
     team.count+"件":"未報告"));
   card.append(summary);
   const body=element("div","p-inline-list");
   for(const member of team.members){
    const row=element("div","p-inline-row");
    row.append(element("strong",null,member.name),
     element("span",null,member.reported?member.count+"件":"未報告"));
    body.append(row);
   }
   for(const product of team.products){
    const row=element("div","p-inline-row");
    row.append(element("strong",null,product.name),
     element("span",null,product.count+"件"));
    body.append(row);
   }
   if(partner&&team.members.length===0&&team.products.length===0)
    body.append(element("p","p-inline-muted","他社の担当者詳細は公開しません"));
   card.append(body);parent.append(card);
  }
  if(!view.teamDetails.length)
   root.append(element("p","p-inline-muted","班別実績は未報告または未照合です"));
 }else{
  const group=(heading,items)=>{
   const card=element("section","p-inline-card");
   const title=element("h4",null,heading);
   const grid=element("div","ranking-grid");
   grid.dataset.columns="1";
   for(const item of items){
    if(typeof item.name!=="string"||
       !Number.isSafeInteger(item.count)||item.count<0||
       (item.rank!==null&&(!Number.isSafeInteger(item.rank)||item.rank<1)))
     throw Error("SAME_APP_JOINT_RANK_ROW_UNVERIFIED");
    if(appendRankRow){
     appendRankRow(grid,item);continue;
    }
    const row=element("div","ranking-row");
    const left=element("div","ranking-left");
    left.append(element("span","ranking-number",item.rank===null?
     "—":String(item.rank)),element("span","ranking-name",item.name));
    const right=element("div","ranking-value");
    right.append(element("strong","ranking-count",item.count+"件"));
    row.append(left,right);grid.append(row);
   }
   if(!items.length)grid.append(element("p","p-inline-muted",
    "報告済みの順位対象がありません（未報告は0件ではありません）"));
   card.append(title,grid);root.append(card);
  };
  const named={
   individual:["🏆 個人ランキング",view.personRows],
   Individual:["🏆 個人ランキング",view.personRows],
   product:["📦 商材別ランキング",view.productRows],
   Product:["📦 商材別ランキング",view.productRows],
   team:["👥 班ランキング",view.teamRows],
   Team:["👥 班ランキング",view.teamRows]
  };
  if(partner||Object.hasOwn(named,selection)){
   if(!Object.hasOwn(named,selection))
    throw Error("SAME_APP_JOINT_RANK_SELECTION_UNVERIFIED");
   group(...named[selection]);
  }else{
   group("🏢 会社別件数",view.companyRows);
   group("🏆 個人ランキング",view.personRows);
   group("👥 班ランキング",view.teamRows);
   group("📦 商材別ランキング",view.productRows);
  }
 }
 status.textContent=partner?
  "合同件数・順位を確認済み（未報告は順位対象外）":
  "直営 "+view.ownCount+"件｜協力店 "+view.partnerCount+
   "件｜合同 "+view.total+"件（サーバー照合済み）";
 return true;
}
