// index.html is the visual source of truth. Inline output keeps old single-page
// Hosting releases and invitation URLs self-contained; no financial code is copied.
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const index=fs.readFileSync(new URL('index.html',root),'utf8').replace(/\r\n/g,'\n');
const file=new URL('partner-workspace.html',root);
let page=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
function range(start,end){
 const a=index.indexOf(start),b=index.indexOf(end,a+start.length);
 if(a<0||b<0)throw Error('canonical presentation missing: '+start);
 return index.slice(a,b);
}
const css=[
 range(':root {','/* 通知設定'),
 range('.welcome-card,','.welcome-title {'),
 range('.product-input-group {','.product-management-input-row {'),
 range('.ranking-grid, .ranking-product-grid {','.ranking-product-scope {'),
 range('.ranking-grid[data-columns] > .ranking-row--champion {','.ranking-row,\n.summary-row {'),
 range('.ranking-row,\n.summary-row {','.ranking-revenue {'),
 range('.dashboard-app-grid {','.dashboard-app-meta {'),
 // Map the isolated count UI onto the canonical shell without running index's SDK.
 `main{max-width:1200px;margin:0 auto;padding:20px}header{background:var(--header);color:var(--header-text)}
 body{background:var(--bg);color:var(--text)}section{border-radius:var(--radius);padding:22px;box-shadow:var(--shadow);border-color:var(--border)}
 button{background:var(--primary)}.secondary{background:var(--primary-soft);color:var(--primary-text)}
 .count-menu.dashboard-app-grid .dashboard-app-button{background:var(--card);color:var(--text);min-height:104px}
 .count-menu.dashboard-app-grid .dashboard-app-button[aria-pressed="true"]{background:var(--primary-soft);color:var(--primary-text);border-color:var(--primary-border-strong)}
 .count-kpi,.company-stat{background:var(--card-soft);border-color:var(--border)}
 .count-kpi strong,.company-stat strong{color:var(--text)}
 .ranking-grid{display:grid;gap:12px}.ranking-grid[data-columns="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
 .ranking-row{min-width:0;overflow-wrap:anywhere}.ranking-row--champion .ranking-left{justify-content:center}
 .ranking-row--champion .ranking-value{text-align:center}
 @media(max-width:600px){main{padding:12px}section{padding:16px}.dashboard-app-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ranking-grid[data-columns="2"]{grid-template-columns:1fr}}
 `
].join('\n').trimEnd();
const style='<!-- canonical-presentation:start -->\n<style>\n'+css+'\n</style>\n<!-- canonical-presentation:end -->';
if(page.includes('<!-- canonical-presentation:start -->'))page=page.replace(/<!-- canonical-presentation:start -->[\s\S]*?<!-- canonical-presentation:end -->/,style);
else page=page.replace('</head>',style+'\n</head>');
const champion=range('function decorateRankingChampion(row, category) {','function renderIndividualRanking(').trim();
const js='// canonical-champion:start\n'+champion+'\n// canonical-champion:end';
if(page.includes('// canonical-champion:start'))page=page.replace(/\/\/ canonical-champion:start[\s\S]*?\/\/ canonical-champion:end/,js);
else page=page.replace('function countTable(headers,rows){',js+'\nfunction countTable(headers,rows){');
if(process.argv.includes('--check')){
 if(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')!==page)throw Error('partner presentation differs from index; run sync-partner-presentation.mjs');
}else fs.writeFileSync(file,page);
