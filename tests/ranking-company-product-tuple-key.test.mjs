import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const paths=[
 "ranking/owner-product-visibility-rankings.mjs",
 "functions-ranking-approvals/ranking/owner-product-visibility-rankings.mjs"
];
test("canonical and Functions ranking use identical collision-free company/product tuple keys",()=>{
 const [canonical,vendor]=paths.map(path=>readFileSync(path,"utf8"));
 assert.equal(vendor,canonical);
 assert.match(canonical,/const key=\(companyId,productId\)=>JSON\.stringify\(\[companyId,productId\]\)/);
 assert.equal((canonical.match(/allowed\.(?:has|add)\(key\(/g)||[]).length,5);
 assert.doesNotMatch(canonical,/allowed\.(?:has|add)\([^\n]*\+":"\+/);
});
test("colon-containing IDs cannot cross-match a different company and product",()=>{
 const key=(companyId,productId)=>JSON.stringify([companyId,productId]);
 assert.notEqual(key("partner:a","b"),key("partner","a:b"));
 assert.notEqual(key("a:b","c"),key("a","b:c"));
 assert.equal(new Set([key("partner:a","b")]).has(key("partner","a:b")),false);
});
