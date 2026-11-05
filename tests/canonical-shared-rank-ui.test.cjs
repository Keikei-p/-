"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8").replace(/\r\n/g,"\n");
const start=source.indexOf("function makeCanonicalCountRankRow(");
const end=source.indexOf("// Same company -> team -> person -> product tree",start);
const segment=source.slice(start,end);
function dom(){
 const create=tag=>{
  const e={tag,className:"",textContent:"",children:[],dataset:{},
   classes:[],classList:{add(cls){e.classes.push(cls);}},
   append(...nodes){for(const x of nodes){
    if(x.tag==="fragment")e.children.push(...x.children);
    else e.children.push(x);
   }},
   replaceChildren(...nodes){e.children.length=0;e.append(...nodes)}
  };return e;
 };
 const doc={createElement:create,createDocumentFragment:()=>create("fragment")};
 const sandbox={document:doc};vm.runInNewContext(segment+
  "\nthis.make=makeCanonicalCountRankRow;this.render=renderCanonicalCountRankRows;"+
  "\nthis.appendShared=appendSharedRankingRows;",sandbox);
 return {create,...sandbox};
}
function resultRows(el){const hits=[];const walk=e=>{
 if(e.className==="ranking-row")hits.push(e);
 for(const x of e.children||[])walk(x);
 };walk(el);return hits;}
function textOf(node){return [node.textContent,...(node.children||[]).map(textOf)].join(" ");}
test("same HQ/partner markup ranks counts only, correctly handles ties and provisional labels",()=>{
 const {create,render,appendShared}=dom();
 const records=[{name:"🤝 協力店・佐藤",count:3},{name:"🏢 直営・山田",count:5},
  {name:"🤝 協力店・田中",count:5}];
 const owner=create("div"),partner=create("div");
 assert.equal(render(owner,records,true),3);
 appendShared(partner,"🏆 個人ランキング",records,true,true);
 assert.equal(resultRows(partner).length,3);
 assert.deepEqual(resultRows(owner).map(x=>x.className),resultRows(partner).map(x=>x.className));
 const rows=resultRows(partner);
 assert.deepEqual(rows.map(r=>r.children[0].children[0].textContent),["1位","1位","3位"]);
 assert.deepEqual(rows.map(r=>r.children[1].children[0].textContent),["5件","5件","3件"]);
 assert.deepEqual(rows.map(r=>r.children[0].children[0].classes),[["top1"],["top1"],["top3"]]);
 assert.equal(partner.children[0].className,"ranking-grid");
 assert.equal(partner.children.length,1,"original partner tab must not get a duplicate card");
 for(const word of ["totalRevenue","unitPrice","revenuePerUnit","¥","50000"])
  assert(!textOf(partner).includes(word));
 const provisional=create("div");render(provisional,records,false);
 assert.deepEqual(resultRows(provisional).map(r=>r.children[0].children[0].textContent),
  ["暫定1位","暫定1位","暫定3位"]);
 assert(resultRows(provisional).every(r=>!r.children[0].children[0].classes.length));
});
test("unverified quantities or malformed people never render partial rankings",()=>{
 const {create,render}=dom();
 for(const rows of [[{name:"許可",count:1},{name:"不明",count:null}],
  [{name:"許可",count:1},{name:"欠落"}],
  [{name:"許可",count:1},{name:"小数",count:1.5}],
  [{name:"許可",count:1},{name:"負数",count:-1}],
  [{name:"許可",count:1},{name:"文字列",count:"2"}]]){
  const target=create("div");
  assert.throws(()=>render(target,rows,false),/canonical_count_rank_invalid/);
  assert.equal(target.children.length,0,"must fail without displaying partial ranks");
 }
 const empty=create("div");render(empty,[],false);
 assert.match(textOf(empty),/未報告を0件とは扱いません/);
});
test("no HTML parsing of a hostile name, no owner revenue mode changes and no hidden local partner rank",()=>{
 const {create,render}=dom();
 const target=create("div");
 render(target,[{name:'<img src=x onerror=alert(1)>',count:1}],false);
 assert.equal(resultRows(target)[0].children[0].children[1].textContent,
  '<img src=x onerror=alert(1)>');
 assert.equal(target.children[0].tag,"div");
 const owner=source.slice(source.indexOf("function renderOwnerJointIndividualRanking(){"),
  source.indexOf("function renderIndividualRanking("));
 assert.match(owner,/renderCanonicalCountRankRows/);
 const original=source.slice(source.indexOf("function renderIndividualRanking("),
  source.indexOf("function renderIndividualRanking(",source.indexOf("function renderIndividualRanking(")+10)>0?
  source.indexOf("function renderIndividualRanking(",source.indexOf("function renderIndividualRanking(")+10):
  source.indexOf("function renderProductMemberRanking("));
 assert.match(original,/canCurrentUserViewRevenue\(\)/);
 assert.match(source,/appendSharedRankingRows\(content,heading,items,complete,true\)/);
 assert.match(source,/appendSharedRankingRows\(content,headings\[selected\],rows\[selected\],false,true\)/);
 assert.match(source,/renderPartnerSharedGroupCards\(content,response\)/);
 assert.match(source,/className="ranking-product-card"/);
 const originalPartner=source.slice(source.indexOf('<section id="partnerPanelRankings"'),
  source.indexOf('<section id="partnerPanelDetail"'));
 assert.equal((originalPartner.match(/id="partnerSharedRankingContent"/g)||[]).length,1);
 assert(!originalPartner.includes('totalRevenue'));
 assert(!segment.includes("getDocs(")&&!segment.includes("setDoc("));
});
