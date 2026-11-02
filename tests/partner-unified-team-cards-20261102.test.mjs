import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const service=fs.readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
const start=html.indexOf("const PARTNER_TEAM_CB_TIERS=");
const end=html.indexOf("async function loadSharedDailyStandings(",start);
assert.ok(start>0&&end>start);
const code=html.slice(start,end);
function element(tag){
 return {tag,className:"",textContent:"",hidden:false,children:[],
  append(...nodes){this.children.push(...nodes);},
  replaceChildren(...nodes){this.children=[...nodes];}};
}
function harness(){
 const context={document:{createElement:element},partnerMainAppendRow(parent,label,value){
  const node=element("row");node.textContent=label+" "+value;parent.append(node);
 }};
 vm.runInNewContext(code+
  "\nthis.render=renderPartnerCountTeamCard;this.partner=renderPartnerFlatTeamDetails;this.owner=renderSharedCountTeamDetails;",context);
 return context;
}
function collect(node){
 return [node.textContent||"",...(node.children||[]).flatMap(collect)].join(" ");
}
test("photo-style CB boxes show five tiers and count-only person/product details",()=>{
 const ctx=harness(),tiers={"0":0,"20000":0,"40000":0,"60000":1,"80000":0,"unclassified":0};
 const card=ctx.render("LinkTh・2班",6,{NURO:1,YMMNP:3,"つばさ・HTB":2},
  {NURO:tiers},[{name:"佐藤",totalCount:6,counts:{NURO:1,YMMNP:3,"つばさ・HTB":2},cbCounts:{NURO:tiers}}],
  ["NURO","YMMNP","つばさ・HTB"]);
 assert.equal(card.tag,"details");
 assert.equal(card.className,"partner-count-team-card");
 const content=collect(card);
 for(const text of ["LinkTh・2班","合計 6件","NURO光｜CB別件数","CB0","CB2万","CB4万","CB6万","CB8万",
  "YMMNP","3件","つばさ・HTB","2件","佐藤｜合計 6件"])assert.ok(content.includes(text),text);
 assert.doesNotMatch(content,/¥|￥|売上|単価|収益|報酬|利益|価格|金額/);
 const tiles=[];
 const walk=n=>{if(n.className==="partner-count-team-cb-cell")tiles.push(n);n.children?.forEach(walk);};
 walk(card);assert.equal(tiles.length,5);
});
test("unclassified NURO is labeled separately and never falsely counted as CB0",()=>{
 const ctx=harness();
 const card=ctx.render("過去の班",2,{NURO:2},{NURO:{"0":0,unclassified:2}},
  [{name:"古い担当者",totalCount:2,counts:{NURO:2}}],["NURO"]);
 assert.match(collect(card),/CB未分類 2件/);
 assert.match(collect(card),/CB0 0件/);
 assert.throws(()=>ctx.render("不正",2,{NURO:2},{NURO:{"0":2,unclassified:2}},[],["NURO"]),/cb_mismatch/);
});
test("partner and HQ both reuse the same count card; original financial dashboard untouched",()=>{
 assert.match(code,/function renderPartnerFlatTeamDetails\(parent,report\)/);
 assert.match(code,/function renderSharedCountTeamDetails\(parent,report\)/);
 assert.equal(code.match(/renderPartnerCountTeamCard\(/g).length>=5,true);
 const owner=html.slice(html.indexOf("async function loadOwnerPartnerDetails()"),
  html.indexOf("async function showPartnerInviteAtMain("));
 assert.match(owner,/holder\.append\(renderPartnerCountTeamCard\(team\.name,team\.totalCount/);
 assert.match(owner,/personTotal!==person\.totalCount/);
 assert.match(owner,/staffTotal!==team\.totalCount/);
 assert.match(owner,/productTotal!==team\.totalCount/);
 for(const privateFinance of ["getDoc(","getDocs(","collection(db,","setDoc(","updateDoc(","deleteDoc(",
  "unitPrice","revenuePerUnit","monthlyRevenue"])assert.ok(!code.includes(privateFinance),privateFinance);
 assert.match(html,/function renderAllTeamsOverview\(/);
 assert.match(html,/monthlyRevenue/);
});
test("backend reads only saved count ledger and exports no financial fields",()=>{
 for(const expected of [
  "const tierCounts=(raw,counts)=>",
  "const cb=tierCounts(e.cbCounts,item.counts)",
  "cbCounts:{NURO:cb}",
  "sumTiers(row.cbCounts.NURO,cb)",
  "sumTiers(bucket.cbCounts.NURO,cb)",
  'out.unclassified=counts.NURO'
 ])assert.ok(service.includes(expected),expected);
 for(const line of service.slice(service.indexOf("if(d.sharedRankings===true){"),
  service.indexOf("const qs=await collection(s.cid,\\"partnerWorkCountDays\\")")).split("\n")){
  assert.doesNotMatch(line,/db\.collection\(["'](?:records|products|revenueGoals)["']\)/);
 }
});
