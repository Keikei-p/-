import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
const privateHtml=readFileSync(new URL("../preview/private-ranking.html",import.meta.url),"utf8");
const ownerHtml=readFileSync(new URL("../preview/owner.html",import.meta.url),"utf8");
test("Mobile company leaderboard is rank-only and requires server verified grant",()=>{
 assert.match(privateHtml,/PRIVATE_RANKING_GATEWAY_URL=""/);
 assert.match(privateHtml,/\/v1\/individual-ranking/);
 assert.match(privateHtml,/\.emailVerified/);
 assert.match(privateHtml,/getIdToken\(/);
 assert.match(privateHtml,/data\.amountsIncluded!==false/);
 assert.doesNotMatch(privateHtml,/\bgetFirestore\(|\bonSnapshot\(|\brunQuery\(|\bcollection\(/);
 assert.doesNotMatch(privateHtml,/\.innerHTML\s*=/);
 assert.doesNotMatch(privateHtml,/formatYen|revenuePerUnit|totalRevenue|単価：|売上金額：/);
 assert.doesNotMatch(privateHtml,/item\.count|item\.revenue|count\+|件数\s*\</);
 assert.match(privateHtml,/item\.rank===1\?"👑 "/);
});
test("Owner has separate per-person switches and ranking read button, no direct Firestore write",()=>{
 assert.match(ownerHtml,/\/v1\/individual-rank-viewers/);
 assert.match(ownerHtml,/\/v1\/individual-rank-grant/);
 assert.match(ownerHtml,/\/v1\/individual-ranking/);
 assert.match(ownerHtml,/閲覧許可を解除/);
 assert.match(ownerHtml,/amountsIncluded!==false/);
 const individual=ownerHtml.slice(ownerHtml.indexOf("function rankRow("),ownerHtml.indexOf('$("loadIndividualRank")'));
 assert.doesNotMatch(individual,/item\.count|item\.total|formatYen|revenuePerUnit/);
 assert.match(individual,/item\.rank===1\?"👑 "/);
 assert.doesNotMatch(ownerHtml,/getFirestore\(|\bupdateDoc\(|\bwriteBatch\(/);
});
test("Both ranking screens compile as browser module source",()=>{
 for(const [name,html] of [["personal",privateHtml],["owner",ownerHtml]]){
  const start=html.indexOf('<script type="module">'),end=html.indexOf("</script>",start);
  assert.ok(start>=0&&end>start);
  const dir=mkdtempSync(join(tmpdir(),"ranking-private-"));
  try{
   const file=join(dir,name+".mjs");
   writeFileSync(file,html.slice(start+'<script type="module">'.length,end));
   execFileSync(process.execPath,["--check",file]);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
