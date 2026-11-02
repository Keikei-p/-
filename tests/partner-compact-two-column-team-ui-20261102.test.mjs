import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const a=html.indexOf("const PARTNER_TEAM_CB_TIERS=");
const z=html.indexOf("async function loadSharedDailyStandings(",a);
assert.ok(a>0&&z>a);
const renderer=html.slice(a,z);
function element(tag="div"){
 return {tag,className:"",textContent:"",hidden:false,open:false,attrs:{},events:{},children:[],
  append(...children){this.children.push(...children);},
  replaceChildren(...children){this.children=[...children];},
  addEventListener(name,fn){this.events[name]=fn;},
  setAttribute(name,val){this.attrs[name]=String(val);}};
}
const ctx={document:{createElement:element},
 partnerMainAppendRow(parent,label,value){
  const row=element("row");row.className="p-inline-row";
  row.textContent=label+"｜"+value;parent.append(row);
 }};
vm.runInNewContext(renderer+
 "\nthis.render=renderPartnerCountTeamCard;this.wire=partnerCompactWireTeamSelection;",ctx);
const walk=(node,check,out=[])=>{
 if(check(node))out.push(node);
 for(const child of node.children||[])walk(child,check,out);
 return out;
};
const textOf=node=>[node.textContent||"",...(node.children||[]).map(textOf)].join(" ");
const tiers={"0":0,"20000":0,"40000":0,"60000":1,"80000":0};
test("six staff fit a compact two-column grid; only clicked staff has visible details",()=>{
 const people=Array.from({length:6},(_,i)=>({
  name:"担当者"+(i+1),totalCount:1,counts:{NURO:i===0?1:0,YMMNP:i===0?0:1},
  cbCounts:i===0?{NURO:tiers}:null}));
 const card=ctx.render("1班",6,{NURO:1,YMMNP:5},{NURO:tiers},people,["NURO","YMMNP"]);
 const grid=walk(card,n=>n.className==="partner-count-team-people-grid")[0];
 const buttons=walk(grid,n=>n.className==="partner-count-team-person-button");
 assert.equal(buttons.length,6);
 assert.match(html,/\.partner-count-team-people-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 const detail=walk(card,n=>n.className==="partner-count-team-person-detail")[0];
 assert.equal(detail.hidden,true);
 buttons[0].events.click();
 assert.equal(detail.hidden,false);
 assert.equal(buttons[0].attrs["aria-pressed"],"true");
 assert.match(textOf(detail),/担当者1｜合計 1件/);
 assert.match(textOf(detail),/NURO｜1件/);
 assert.equal(walk(detail,n=>n.className==="partner-count-team-cb-cell").length,5);
 buttons[3].events.click();
 assert.equal(buttons[0].attrs["aria-pressed"],"false");
 assert.equal(buttons[3].attrs["aria-pressed"],"true");
 assert.doesNotMatch(textOf(detail),/担当者1｜合計/);
 assert.match(textOf(detail),/担当者4｜合計 1件/);
 assert.equal(walk(detail,n=>n.className==="partner-count-team-cb-cell").length,0);
 buttons[3].events.click();
 assert.equal(detail.hidden,true);
 assert.doesNotMatch(textOf(detail),/担当者4｜合計/);
});
test("team tiles preserve one expanded team per group",()=>{
 const grid=element("div");const one=ctx.render("1班",1,{NURO:0,YMMNP:1},null,
  [{name:"A",totalCount:1,counts:{YMMNP:1}}],["NURO","YMMNP"]);
 const two=ctx.render("2班",0,{NURO:0,YMMNP:0},null,
  [{name:"B",totalCount:0,counts:{},reported:false}],["NURO","YMMNP"]);
 grid.append(one,two);ctx.wire(grid);
 one.open=true;one.events.toggle();
 assert.equal(one.open,true);
 two.open=true;two.events.toggle();
 assert.equal(one.open,false);
 assert.equal(two.open,true);
 assert.match(textOf(two),/未報告/);
});
test("same team renderer is used in HQ partner section and partner's own roster, not revenue DOM",()=>{
 const hq=html.slice(html.indexOf("async function loadOwnerPartnerDetails()"),
  html.indexOf("async function showPartnerInviteAtMain("));
 assert.match(hq,/holder\.append\(renderPartnerCountTeamCard\(team\.name,team\.totalCount/);
 assert.match(hq,/partnerCompactWireTeamSelection\(holder\)/);
 assert.match(html,/details\.className="p-inline-list partner-count-team-grid"/);
 assert.match(html,/person\.active===true&&person\.teamId===team\.id/);
 assert.match(html,/teamIdSnapshot===team\.id/);
 assert.match(html,/#appScreen\[data-partner-count-only="true"\] #partnerPanelDetail>.p-inline-card:nth-child\(2\)\{display:none!important\}/);
 const saveEndpoint=/const partnerInlineSave = httpsCallable\(partnerCountFunctions,"submitPartnerWorkspaceCounts"\)/;
 assert.match(html,saveEndpoint);
 for(const field of ["revenuePerUnit","monthlyRevenue","unitPrice","commission"]){
  assert.ok(!renderer.includes(field),"finance field in shared compact renderer");
 }
});
test("NURO tier classification remains 5 boxes and no financial display values",()=>{
 const card=ctx.render("1班",2,{NURO:2}, {NURO:{"0":0,"20000":0,"40000":0,"60000":1,"80000":0,unclassified:1}},
  [{name:"A",totalCount:2,counts:{NURO:2},
    cbCounts:{NURO:{"0":0,"20000":0,"40000":0,"60000":1,"80000":0,unclassified:1}}}],
  ["NURO"]);
 const button=walk(card,n=>n.className==="partner-count-team-person-button")[0];
 button.events.click();
 assert.match(textOf(card),/CB未分類｜1件/);
 assert.equal(walk(card,n=>n.className==="partner-count-team-cb-cell").length,10);
 assert.doesNotMatch(textOf(card),/¥|￥|売上|単価|価格|収益|報酬|利益/);
});
