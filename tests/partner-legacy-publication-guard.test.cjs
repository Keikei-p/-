"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {enforceLegacyPublication}=require("../functions-partner-workspace/legacy-publication-guard.cjs");
const categories=["NURO","AIR"];
const linksDoc={revision:1,links:[{productId:"p1",category:"NURO",effectiveFrom:"2026-11-10"}]};
const run=(date,previous,next,productIds=[])=>enforceLegacyPublication({
 linksDoc,publicationDoc:{revision:1,productIds},categories,date,previous,next
});
test("unmapped legacy category remains available",()=>assert.equal(run("2026-11-10",{NURO:0,AIR:0},{NURO:0,AIR:2}),true));
test("mapped unpublished category rejects increase",()=>assert.throws(()=>run("2026-11-10",{NURO:1,AIR:0},{NURO:2,AIR:0}),/UNPUBLISHED/));
test("historical entries before effective date remain editable",()=>assert.equal(run("2026-11-09",{NURO:1,AIR:0},{NURO:2,AIR:0}),true));
test("published product permits increase",()=>assert.equal(run("2026-11-10",{NURO:1,AIR:0},{NURO:2,AIR:0},["p1"]),true));
test("unpublished existing count may be reduced",()=>assert.equal(run("2026-11-10",{NURO:2,AIR:0},{NURO:1,AIR:0}),true));
