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
const mount=()=>{
 const map=new Map(),lookup=id=>{if(!map.has(id))map.set(id,new El());return map.get(id)};
 const ctx={document:{createElement:tag=>new El(tag)},$ : lookup,renderTeamCountDetail:()=>{ctx.didRender=true},renderProductRankMode:()=>{},renderCountGoal:()=>{},
  summary:{groups:[
   {id:"t1",name:"1班",count:11},{id:"t2",name:"2班",count:7},
   {id:"__unverified__",name:"所属班未確認",count:3}
  ],teamPeople:[{id:"t1",people:[{name:"A",count:6},{name:"B",count:5}]},
    {id:"t2",people:[{name:"C",count:7}]}]},
  data:{companyName:"協力店A"}
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
