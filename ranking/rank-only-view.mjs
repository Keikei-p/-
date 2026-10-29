/**
 * Dependency-free, mobile-friendly rank-only screen. No Firebase/Firestore
 * access, no requests, no innerHTML, no cached private metrics.
 * The caller must provide a server-authorized rank-only publication.
 */
const GROUPS=Object.freeze([
 {key:"teamRanks",title:"🏆 班別ランキング"},
 {key:"progressRanks",title:"🎯 目標進捗ランキング"},
 {key:"memberRanks",title:"🦁 個人ランキング"},
 {key:"productRanks",title:"✨ 商材ランキング"}
]);
const OUTPUT_KEYS=["name","company","rank","champion"];
const REFUSE=()=>{throw Error("順位データを安全に表示できません。再読込してください。");};
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
function entry(row,product=false){
 if(!row||typeof row!=="object"||Array.isArray(row)||
   !Number.isSafeInteger(row.rank)||row.rank<1||
   typeof row.name!=="string"||!row.name||row.name.length>100||
   typeof row.champion!=="boolean")REFUSE();
 const allowed=product?["rank","name","champion","members"]:OUTPUT_KEYS;
 if(Object.keys(row).some(k=>!allowed.includes(k)))REFUSE();
 if(!product&&(typeof row.company!=="string"||!row.company||row.company.length>100))REFUSE();
 if(product){
  if(!Array.isArray(row.members)||row.members.length>10000)REFUSE();
  row.members.forEach(x=>entry(x));
 }
 if(/[¥￥$€]|\d\s*円|売上|単価|キャッシュバック/.test(row.name))REFUSE();
}
export function validateRankOnlyPublication(data){
 if(!data||data.schema!=="nico-combined-rank-only-v1"||
    !MONTH.test(data.period||"")||!TIME.test(data.readTime||"")||
    Object.keys(data).sort().join(",")!==
      ["schema","period","readTime",...GROUPS.map(x=>x.key)].sort().join(","))REFUSE();
 for(const {key} of GROUPS){
  if(!Array.isArray(data[key])||data[key].length>10000)REFUSE();
  data[key].forEach(x=>entry(x,key==="productRanks"));
 }
 return data;
}
const el=(doc,type,className,content)=>{
 const node=doc.createElement(type);
 node.className=className;
 if(content!==undefined)node.textContent=String(content);
 return node;
};
function addRank(doc,parent,row){
 const line=el(doc,"li","rank-only-item"+(row.champion?" champion":""));
 line.appendChild(el(doc,"span","rank-only-place",row.champion?"👑 "+row.rank+"位":row.rank+"位"));
 const label=el(doc,"span","rank-only-name",row.name);
 line.appendChild(label);
 if(row.company)line.appendChild(el(doc,"small","rank-only-company",row.company));
 parent.appendChild(line);
}
export function renderCombinedRankOnlyScreen({document,root,data}={}){
 if(!document||typeof document.createElement!=="function"||
    !root||typeof root.replaceChildren!=="function")REFUSE();
 // Clear a previously visible snapshot BEFORE inspecting the new one.
 root.replaceChildren();
 const validated=validateRankOnlyPublication(data);
 const page=el(document,"section","rank-only-board");
 page.appendChild(el(document,"h2","rank-only-heading","合同ランキング"));
 page.appendChild(el(document,"p","rank-only-meta",validated.period+"　｜　順位のみ表示・金額非公開"));
 for(const spec of GROUPS){
  const section=el(document,"section","rank-only-section");
  section.appendChild(el(document,"h3","rank-only-section-title",spec.title));
  if(!validated[spec.key].length){
   section.appendChild(el(document,"p","rank-only-empty","対象の順位はありません。"));
  }else{
   const items=el(document,"ol","rank-only-list");
   for(const row of validated[spec.key]){
    addRank(document,items,row);
    if(spec.key==="productRanks"&&row.members.length){
     const sub=el(document,"li","rank-only-product-people");
     sub.appendChild(el(document,"span","rank-only-label","商材別の個人順位"));
     const ranked=el(document,"ol","rank-only-list");
     for(const person of row.members)addRank(document,ranked,person);
     sub.appendChild(ranked);items.appendChild(sub);
    }
   }
   section.appendChild(items);
  }
  page.appendChild(section);
 }
 root.replaceChildren(page);
 return page;
}
