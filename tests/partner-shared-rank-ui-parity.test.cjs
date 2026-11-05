"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const functionSource=name=>{
 const start=source.indexOf("function "+name+"(");
 if(start<0)throw Error("shared ranking UI missing "+name);
 const end=source.indexOf("\n}",start);
 if(end<0)throw Error("function body not closed "+name);
 return source.slice(start,end+2);
};
const functions=[
 "verifiedSharedRankingGroupTotal","appendSharedRankingRows",
 "renderPartnerSharedGroupCards"
].map(functionSource).join("\n");
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};
 this.textContent="";this.className="";this.onclick=null;this.classList={
 values:[],add:v=>this.classList.values.push(v)
 };}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(k,v){this.attributes[k]=v;}
 querySelectorAll(name){const nodes=[];
 const visit=x=>{for(const child of x.children){
  if(child.tag===name)nodes.push(child);visit(child);
 }};
 visit(this);return nodes;}
}
function ui(){
 const crown=[];
 const box={
  document:{createElement:type=>new Element(type)},
  decorateRankingChampion:(node,type)=>{crown.push({node,type});},
  partnerMainAppendRow:(parent,label,value)=>{
   const row=new Element("div");row.textContent=label+" | "+value;parent.append(row);
  }
 };
 vm.createContext(box);
 vm.runInContext("let selectedPartnerSharedGroupId='';\n"+functions,box);
 return {...box,crown};
}
test("HQ and partner product cards use same verified individual counts",()=>{
 const c=ui(),result=c.verifiedSharedRankingGroupTotal({
  complete:true,members:[{count:3},{count:4},{count:0}]
 });
 assert.equal(result,7);
 assert.equal(c.verifiedSharedRankingGroupTotal({complete:false,members:[]}),null);
 assert.equal(c.verifiedSharedRankingGroupTotal({complete:true,members:[]}),0);
 for(const members of [[{count:-1}],[{count:1.5}],[{count:2**53-1},{count:1}],null])
  assert.throws(()=>c.verifiedSharedRankingGroupTotal({complete:true,members}),/unverified|overflow/);
});
test("partner daily ranking draws ORIGINAL ranking rows and correct tied ranks",()=>{
 const c=ui(),target=new Element("main");
 c.appendSharedRankingRows(target,"個人",[
  {name:"協力店B・次郎",count:5},{name:"直営・太郎",count:7},
  {name:"協力店A・花子",count:7}
 ],true);
 const card=target.children[0],list=card.children[1];
 assert.equal(card.className,"p-inline-card");
 assert.equal(list.className,"ranking-grid");
 assert.equal(list.dataset.columns,"1");
 assert.deepEqual(list.children.map(x=>x.children[0].children[0].textContent),
  ["1位","1位","3位"]);
 assert.deepEqual(list.children.map(x=>x.children[1].children[0].textContent),
  ["7件","7件","5件"]);
 assert.equal(c.crown.length,2,"confirmed first-place tie gets two crowns");
 assert(list.children[0].className==="ranking-row");
});
test("unverified month ranks are provisional: never crown an incomplete leaderboard",()=>{
 const c=ui(),target=new Element("main");
 c.appendSharedRankingRows(target,"個人",[{
  name:"協力店・担当",count:8},{name:"直営・担当",count:0}
 ],false);
 const rows=target.children[0].children[1].children;
 assert.deepEqual(rows.map(x=>x.children[0].children[0].textContent),
  ["暫定1位","暫定2位"]);
 assert.equal(c.crown.length,0);
 assert.equal(rows[0].children[0].children[1].textContent,"協力店・担当");
 assert.equal(rows[1].children[1].children[0].textContent,"0件");
});
test("unverified source count is NEVER silently ranked as zero",()=>{
 const c=ui(),target=new Element("main");
 for(const x of [null,{name:"社員",count:null},{name:"社員",count:-1},
  {name:"社員",count:1.1},{name:"社員",count:Infinity}]){
  assert.throws(()=>c.appendSharedRankingRows(target,"個人",[x],false),
   /shared_ranking_entry_invalid/);
 }
});
test("partner original-style product cards show only verified group totals",()=>{
 const c=ui(),target=new Element("main");
 const response={complete:false,groupStandings:[
  {id:"published",name:"新しい公開商材",complete:true,members:[
   {rank:1,count:4,name:"A",companyName:"協力店"},
   {rank:2,count:2,name:"B",companyName:"直営"}]},
  {id:"pending",name:"確認中の商材",complete:false,members:[]}
 ]};
 c.renderPartnerSharedGroupCards(target,response);
 const cards=target.children[1].children;
 assert.equal(cards.length,2);
 assert.equal(cards[0].children[0].textContent,"新しい公開商材");
 assert.equal(cards[0].children[1].textContent,"6件");
 assert.equal(cards[1].children[1].textContent,"件数未照合");
 const rows=target.children[2].children;
 assert.equal(rows.length,2);
 assert.equal(rows[0].children[0].children[0].textContent,"暫定1位");
 assert.equal(c.crown.length,0);
 cards[1].onclick();
 assert.equal(target.children[2].children[0].textContent,
  "この商材グループは商材IDとの対応確認が未完了です。順位を推測して表示しません。");
});
test("both existing HQ original product tab and partner tab use identical count helper",()=>{
 const owner=source.slice(source.indexOf("function renderOwnerJointProductRanking("),
  source.indexOf("function renderProductMemberRanking(",source.indexOf("function renderOwnerJointProductRanking(")));
 const partner=source.slice(source.indexOf("function renderPartnerSharedGroupCards("),
  source.indexOf("function appendSharedRankingRows("));
 assert.match(owner,/verifiedSharedRankingGroupTotal\(group\)/);
 assert.match(partner,/verifiedSharedRankingGroupTotal\(group\)/);
 assert.match(owner,/ranking-product-card-count/);
 assert.match(partner,/ranking-product-card-count/);
 assert.doesNotMatch(owner,/totalRevenue|revenuePerUnit|unitPrice|pricingOptions|formatYen/);
 assert.doesNotMatch(partner,/totalRevenue|revenuePerUnit|unitPrice|pricingOptions|formatYen/);
});
