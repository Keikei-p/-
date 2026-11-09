"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
test("partner count save looks up existing record before hidden OFF category serialization",()=>{
 const start=html.lastIndexOf("const counts=Object.create(null);",html.indexOf("const parsedCb=partnerInlineSelectedCb()"));
 const before=html.lastIndexOf("const before=snap.records.find",start);
 assert.ok(before>0&&before<start,"prior entry must be initialized before count loop");
});
test("count-only team detail includes NURO product counts when CB breakdown is hidden",()=>{
 assert.match(html,/function renderPartnerCountTeamCard\([^]*?showCb=false/);
 assert.match(html,/if\(showCb&&\(nuro>0\|\|tiers\)\)/);
 assert.match(html,/for\(const key of keys\)\{\s*const n=counts\[key\]\?\?0;\s*if\(!n\)continue;/);
});
test("partner input preserves historical OFF values but hides unused categories",()=>{
 assert.match(html,/if\(unavailable&&historicalCount===0\)continue/);
 assert.match(html,/legacyCategoryPublication\?\.some\(x=>x.category===key&&x.acceptsIncrease===false\)/);
});
test("partner and hub team trees use the same count-only card renderer",()=>{
 assert.match(html,/function renderPartnerFlatTeamDetails\(/);
 assert.match(html,/function renderSharedCountTeamDetails\(/);
 assert.ok((html.match(/renderPartnerCountTeamCard\(/g)||[]).length>=4);
});
