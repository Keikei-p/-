"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const cp=require("node:child_process");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
test("the actual, full original index module remains valid JavaScript",()=>{
 const script=html.match(/<script\s+type="module"\s*>([\s\S]*?)<\/script>/i);
 assert.ok(script&&script[1].length>250000,"full original module must remain");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nico-ranking-"));
 try{
  const p=path.join(dir,"index-inline.mjs");
  fs.writeFileSync(p,script[1],"utf8");
  const result=cp.spawnSync(process.execPath,["--check",p],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test("existing product management owns publish checkbox; no new separate sales editor",()=>{
 assert.match(html,/id="productManagement"/);
 assert.match(html,/id="productList"/);
 assert.match(html,/協力店に公開/);
 assert.match(html,/catalogPublicationState/);
 assert.match(html,/id="productPricingEditor"/);
 assert.match(html,/id="monthlyRevenue"/);
 assert.match(html,/id="productRankingProductList"/);
 assert.match(html,/id="productRankingMemberList"/);
});
test("partner published catalog displays only sanitized server-returned rows",()=>{
 assert.match(html,/id="pInlineSharedProductList"/);
 assert.match(html,/loadPartnerPublishedProductList\(\)/);
 assert.match(html,/Object\.keys\(product\)\.sort\(\)\.join\("\|"\)!=="id\|name\|sortOrder"/);
 assert.match(html,/partnerMainValidId\(product\.id\)/);
 assert.match(html,/row\.append\(name\);target\.append\(row\)/);
});
test("the redundant Owner ranking inside team details is hidden, while team details stay available",()=>{
 assert.match(html,/id="ownerSharedRankingsSection" style="display:none"/);
 assert.match(html,/id="ownerPartnerDashboardList"/);
 assert.match(html,/id="individualRankingToggle"/);
 assert.match(html,/id="productRankingToggle"/);
 assert.match(html,/renderPartnerSharedGroupCards\(/);
 assert.match(html,/response\.complete===true\?item\.rank\+"位":"暫定"/);
});
