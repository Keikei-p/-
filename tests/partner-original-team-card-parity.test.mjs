import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const sourceIndex=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const css=sourceIndex.slice(sourceIndex.indexOf(".team-overview-grid {"),
 sourceIndex.indexOf(".team-goal-summary {"));
class El{
 constructor(tag="div"){this.tagName=tag;this.className="";this.children=[];this.dataset={};this.value="";this.textContent="";this.attrs={};this.onclick=null}
 append(...nodes){this.children.push(...nodes)}
 appendChild(node){this.children.push(node);return node}
 replaceChildren(...nodes){this.children=[...nodes]}
 setAttribute(name,value){this.attrs[name]=value}
 querySelectorAll(selector){return this.children.filter(e=>selector==="[data-team-key]"&&e.dataset.teamKey)}
}
const mount=(dataOverrides={})=>{
 const map=new Map(),lookup=id=>{if(!map.has(id))map.set(id,new El());return map.get(id)};
 const ctx={document:{createElement:tag=>new El(tag)},$ : lookup,renderTeamCountDetail:()=>{ctx.didRender=true},renderProductRankMode:()=>{},renderCountGoal:()=>{},
  summary:{groups:[
   {id:"t1",name:"1班",count:11},{id:"t2",name:"2班",count:7},
   {id:"__unverified__",name:"所属班未確認",count:3}
  ],teamPeople:[{id:"t1",people:[{name:"A",count:6},{name:"B",count:5}]},
    {id:"t2",people:[{name:"C",count:7}]}]},
  data:{companyName:"協力店A",...dataOverrides}
 };
 const begin=" const teamSelect=$(\"countTeamSelect\"),previous=teamSelect.value;teamSelect.replaceChildren();";
 const end=" renderProductRankMode();renderCountGoal();";
 const start=source.indexOf(begin),finish=source.indexOf(end,start);
 assert.ok(start>0&&finish>start,"verified team card builder missing");
 vm.runInNewContext(source.slice(start,finish+end.length),ctx);
 return {ctx,map,lookup};
};
test("original partner detail is cards from the SAME monthly verified summary",()=>{
 const {ctx,lookup}=mount();
 assert.equal(lookup("partnerTeamCompanyHeading").textContent,"協力店A → 班別の月間件数");
 const buttons=lookup("partnerTeamCardGrid").children;
 assert.equal(buttons.length,3);
 assert.deepEqual(Array.from(buttons,b=>[b.dataset.teamKey,b.className,
  b.children[2].textContent]),[
   ["t1","team-overview-card","11件"],
   ["t2","team-overview-card","7件"],
   ["__unverified__","team-overview-card","3件"]
  ]);
 assert.equal(buttons[0].children[1].textContent,"実績登録 2人");
 assert.equal(buttons[2].children[1].textContent,"所属班未確認");
 buttons[1].onclick();
 assert.equal(lookup("countTeamSelect").value,"t2");
 assert.equal(ctx.didRender,true);
 assert.doesNotMatch(buttons.flatMap(b=>b.children.map(x=>x.textContent)).join(" "),/売上|単価|¥|CB/);
});
test("partner owner sees current active roster count, restricted members see report count",()=>{
 const {lookup:owner}=mount({role:"owner",staff:[
  {teamId:"t1",active:true},{teamId:"t1",active:true},
  {teamId:"t1",active:false},{teamId:"t2",active:true}
 ]});
 const ownCards=owner("partnerTeamCardGrid").children;
 assert.equal(ownCards[0].children[1].textContent,"2人");
 assert.equal(ownCards[1].children[1].textContent,"1人");
 const {lookup:member}=mount({role:"member",staff:[{teamId:"t1",active:true}]});
 assert.equal(member("partnerTeamCardGrid").children[0].children[1].textContent,"実績登録 2人");
});
test("original self 4 cards remain intact, partner has same class names and layout",()=>{
 for(const cls of ["team-overview-grid","team-overview-card","team-overview-card-name",
 "team-overview-card-members","team-overview-card-result","team-overview-card-goal"])
  assert.ok(css.includes("."+cls+" {"),"self class "+cls);
 assert.match(source,/#partnerPanel-teamDetail \.team-overview-grid/);
 assert.match(source,/#partnerPanel-teamDetail \.team-overview-card\[aria-pressed="true"\]/);
 assert.match(source,/<div id="partnerTeamCardGrid" class="team-overview-grid"/);
 assert.match(source,/<div id="partnerTeamCountDetail" class="team-detail-panel" hidden>/);
 assert.match(source,/id="countTeamPeople"/);
 assert.match(source,/id="countTeamProducts"/);
});
test("company-month change clears the view without touching unsaved count inputs",()=>{
 const clean=source.slice(source.indexOf("function clearCountOnlyDashboard()"),
  source.indexOf("function currentCountIdentity()",source.indexOf("function clearCountOnlyDashboard()")));
 assert.match(clean,/countExportRows=null/);
 assert.match(clean,/\$\("partnerTeamCardGrid"\)\.replaceChildren\(\)/);
 assert.match(clean,/\$\("partnerTeamCountDetail"\)\.hidden=true/);
 assert.doesNotMatch(clean,/localStorage\.clear\(|setDoc\(|deleteDoc\(|save\(|resetForm\(/);
 const saver=source.slice(source.indexOf('$("save").onclick='),source.indexOf('$("selectCodeLogin").onclick='));
 assert.match(saver,/expectedVersion:/);
 assert.match(saver,/submitPartnerWorkspaceCounts|await save\(/);
});

test("same company-team hierarchy in the embedded partner dashboard as the self app",()=>{
 const from=sourceIndex.indexOf("  if(detail){",sourceIndex.indexOf("async function loadSharedDailyStandings("));
 const to=sourceIndex.indexOf("  // Partners and HQ",from);
 assert.ok(from>0&&to>from);
 const detail=sourceIndex.slice(from,to);
 assert.match(detail,/renderSharedCountTeamDetails\(content,response\)/);
 assert.doesNotMatch(detail,/if\(partner\)renderPartnerFlatTeamDetails/);
 const start=sourceIndex.indexOf('const details=pInline("pInlineTeamDetails");details.replaceChildren();');
 const end=sourceIndex.indexOf('const daily=pInline("pInlineDailySummary")',start);
 assert.ok(start>0&&end>start);
 const local=sourceIndex.slice(start,end);
 assert.match(local,/companySection\.className="p-inline-company-teams partner-count-team-grid"/);
 assert.match(local,/companyHeading\.textContent="🤝 "\+snap\.companyName/);
 assert.match(local,/companySection\.append\(card\)/);
 assert.match(local,/partnerCompactWireTeamSelection\(companySection\)/);
 assert.doesNotMatch(local,/getFirestore\(|getDocs\(|\bformatYen\(/);
});

test("saved partner counts produce verified person-product totals without touching financial records",()=>{
 const begin=source.indexOf("function summarizeCountOnlyResponses(");
 const end=source.indexOf("\nfunction countTable(",begin);
 assert.ok(begin>0&&end>begin);
 const fn=vm.runInNewContext(source.slice(begin,end)+"\nsummarizeCountOnlyResponses;");
 const keys=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
  "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
 const counts=Object.fromEntries(keys.map(k=>[k,k==="NURO"?3:0]));
 const response={date:"2026-11-15",categories:keys,staff:[{id:"s1",name:"田中"}],
  privateProducts:[],records:[{staffId:"s1",teamIdSnapshot:"t1",
   totalCount:3,counts,privateCounts:{},privateTotalCount:0}]};
 const original=JSON.stringify(response);
 const summary=fn([response],[{id:"t1",name:"1班"}],keys);
 const byMember=summary.teamPersonProducts.find(x=>x.id==="t1").people[0];
 assert.equal(byMember.id,"s1");
 assert.equal(byMember.products.NURO,3);
 assert.equal(Object.values(byMember.products).reduce((a,b)=>a+b,0),3);
 assert.equal(summary.groups[0].count,3);
 assert.equal(JSON.stringify(response),original);
 assert.doesNotMatch(JSON.stringify(byMember),/totalRevenue|unitPrice|cashback|pricingOptions/);
});

test("partner team detail shows the same member product cards and unreported distinction",()=>{
 const begin=source.indexOf("function renderTeamCountDetail(){");
 const end=source.indexOf("\nfunction renderProductRankMode(){",begin);
 assert.ok(begin>0&&end>begin);
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id)};
 const summary={groups:[{id:"t1",name:"1班",count:3}],
  teamProducts:[{id:"t1",products:{NURO:3}}],
  teamPeople:[{id:"t1",people:[{id:"s1",name:"田中",count:3}]}],
  teamPersonProducts:[{id:"t1",people:[{id:"s1",products:{NURO:3}}]}]};
 get("countTeamSelect").value="t1";get("countProductMode").value="single";
 const ctx={document:{createElement:tag=>new El(tag)},$:get,
  countExportRows:{summary},data:{companyName:"協力店A",role:"owner",
    staff:[{id:"s2",name:"佐藤",teamId:"t1",active:true}]},
  groupedProductCounts:x=>Object.entries(x),
  countTable:(headers,rows)=>({headers,rows}),
  competitionRanks:(rows,countOf,render)=>rows.map((r,i)=>render(r,i+1))};
 const fn=vm.runInNewContext(source.slice(begin,end)+"\nrenderTeamCountDetail;",ctx);
 fn();
 assert.equal(get("partnerTeamCountDetail").hidden,false);
 const header=get("partnerTeamDetailHeader");
 assert.match(header.children[0].children[1].textContent,/協力店A → 1班/);
 const cards=get("partnerTeamMemberGrid").children;
 assert.equal(cards.length,2);
 assert.equal(cards[0].children[0].textContent,"田中");
 assert.equal(cards[0].children[1].textContent,"3件");
 assert.equal(cards[0].children[2].children[0].children[0].textContent,"NURO");
 assert.equal(cards[0].children[2].children[0].children[1].textContent,"3件");
 assert.equal(cards[1].children[1].textContent,"この班では未報告");
 assert.doesNotMatch(JSON.stringify(cards.map(c=>c.children.map(x=>x.textContent))),/売上|単価|revenue|cashback/);
 summary.teamPersonProducts[0].people[0].products.NURO=2;
 assert.throws(()=>fn(),/count does not match/);
});

test("verified shared rankings reuse the self count-only row look, ties, and incomplete rank suppression",()=>{
 const start=sourceIndex.indexOf("function appendVerifiedCountRankRow(");
 const end=sourceIndex.indexOf("// Same company -> team -> person -> product tree",start);
 assert.ok(start>0&&end>start);
 const code=sourceIndex.slice(start,end);
 const ctx={document:{createElement:tag=>new El(tag)},
  partnerMainAppendRow:(parent,label,value)=>parent.append(Object.assign(new El(),{textContent:label+" "+value}))};
 const {appendSharedRankingRows}=vm.runInNewContext(code+
  "\n({appendSharedRankingRows});",ctx);
 const root=new El();
 const input=[{name:"協力店B",count:2},{name:"自社",count:4},{name:"協力店A",count:4}];
 appendSharedRankingRows(root,"個人ランキング",input,true);
 assert.deepEqual(input.map(x=>x.count),[2,4,4],"source must not be sorted in place");
 const grid=root.children[0].children[1];
 assert.equal(grid.className,"ranking-grid");
 const rankingRows=Array.from(grid.children,c=>[
  c.className,c.children[0].children[0].textContent,
  c.children[0].children[1].textContent,c.children[1].children[0].textContent
 ]);
 assert.deepEqual(rankingRows.map(row=>row[0]),["ranking-row","ranking-row","ranking-row"]);
 assert.deepEqual(rankingRows.map(row=>row[1]),["1","1","3"]);
 assert.deepEqual(rankingRows.map(row=>row[3]),["4件","4件","2件"]);
 assert.deepEqual(new Set(rankingRows.slice(0,2).map(row=>row[2])),new Set(["自社","協力店A"]));
 assert.equal(rankingRows[2][2],"協力店B");
 const incomplete=new El();
 appendSharedRankingRows(incomplete,"班ランキング",input,false);
 assert.ok(incomplete.children[0].children[1].children.every(c=>
  c.children[0].children[0].textContent==="—"));
 assert.doesNotMatch(code,/formatYen|revenuePerUnit|totalRevenue|unitPrice|cashback|getFirestore\(/);
 assert.throws(()=>appendSharedRankingRows(new El(),"異常",[{name:"A",count:-1}],true),
  /shared_ranking_entry_invalid/);
});

test("separate partner workspace uses self-app ranking cards without prices",()=>{
 const begin=source.indexOf("function countRankingCards(");
 const end=source.indexOf("function groupedProductCounts(",begin);
 assert.ok(begin>0&&end>begin);
 const countRankingCards=vm.runInNewContext(source.slice(begin,end)+
  "\ncountRankingCards;",{document:{createElement:tag=>new El(tag)}});
 const grid=countRankingCards([
  {name:"NURO",count:6,rank:1},{name:"SBMNP",count:6,rank:1},
  {name:"所属班未確認",count:3,rank:null}
 ]);
 assert.equal(grid.className,"partner-ranking-grid");
 assert.deepEqual(Array.from(grid.children,card=>[
  card.className,card.children[0].children[0].textContent,
  card.children[0].children[1].textContent,card.children[1].children[0].textContent
 ]),[
  ["ranking-row","1","NURO","6件"],
  ["ranking-row","1","SBMNP","6件"],
  ["ranking-row","—","所属班未確認","3件"]
 ]);
 assert.throws(()=>countRankingCards([{name:"悪い件数",count:-1,rank:1}]),
  /invalid count ranking card/);
 assert.doesNotMatch(source.slice(begin,end),/getFirestore\(|formatYen\(|revenuePerUnit|unitPrice|totalRevenue|cashback/i);
});
