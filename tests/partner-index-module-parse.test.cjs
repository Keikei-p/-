"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
test("actual shared owner/partner HTML inline ES module parses completely",()=>{
 assert.equal(typeof vm.SourceTextModule,"function",
  "run CI with NODE_OPTIONS=--experimental-vm-modules for syntax verification");
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 const match=html.match(/<script\s+type="module"\s*>([\s\S]*?)<\/script>/);
 assert.ok(match&&match[1].length>10000,"missing original inline app module");
 assert.doesNotThrow(()=>new vm.SourceTextModule(match[1],{identifier:"index.html"}));
});
