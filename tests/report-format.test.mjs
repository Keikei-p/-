import test from "node:test";
import assert from "node:assert/strict";
import {formatCountsReport,formatMissingReminder} from "../reports/format.mjs";
const teams=[{id:"t1",name:"1班",goalCount:10,currentCount:3,reported:true},
 {id:"t2",name:"2班",goalCount:8,currentCount:0,reported:false}];
test("morning report contains goals and counts only",()=>{
 const text=formatCountsReport({date:"2026-10-28",period:"morning",teams});
 assert.match(text,/本日朝礼報告/);
 assert.match(text,/目標：10件/);
 assert.match(text,/現在：3件/);
 assert.doesNotMatch(text,/売上|単価|円/);
});
test("final report same safe template",()=>{
 const text=formatCountsReport({date:"2026-10-28",period:"final",teams});
 assert.match(text,/本日最終報告/);
 assert.doesNotMatch(text,/売上|単価|円/);
});
test("missing only reports actual unreported teams",()=>{
 const text=formatMissingReminder({date:"2026-10-28",teams});
 assert.match(text,/2班：未報告/);
 assert.doesNotMatch(text,/1班：未報告/);
});
test("no unreported team means no reminder",()=>{
 assert.equal(formatMissingReminder({date:"2026-10-28",teams:[teams[0]]}),"");
});
test("invalid numbers cannot silently become zero",()=>{
 assert.throws(()=>formatCountsReport({date:"2026-10-28",period:"final",teams:[{id:"t",name:"t",goalCount:5,currentCount:-2}]}));
});

test("team labels containing disguised prices are redacted",()=>{
 const text=formatCountsReport({date:"2026-10-28",period:"morning",
  teams:[{id:"x",name:"1班 CB20000円",goalCount:4,currentCount:2,reported:true}]});
 assert.match(text,/名称は管理者確認中/);
 assert.doesNotMatch(text,/20000|CB|円/);
});
