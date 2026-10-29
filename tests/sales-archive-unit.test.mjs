import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const js=readFileSync(new URL("../sales-archive.js",import.meta.url),"utf8");
function loadFns(start,end,names){
 const a=js.indexOf(start),b=js.indexOf(end,a);
 assert.ok(a>=0&&b>a,"Cannot locate isolated helper source");
 return new Function(js.slice(a,b)+"\nreturn {"+names.join(",")+"};")();
}
const {group,decodeRecord,approvedCurrentUnit,appendRevaluation}=loadFns("function group(","async function sha(",["group","decodeRecord","approvedCurrentUnit","appendRevaluation"]);
const {csvCell}=loadFns("function csvCell(","function makeCsv(",["csvCell"]);
test("historical revenue stays based on saved deal prices",()=>{
 const warnings=[];
 const rows=decodeRecord({id:"r",date:"2026-10-27",results:{p:{productId:"p",count:5,revenuePerUnit:0}},totalCount:5,totalRevenue:0},warnings);
 assert.equal(rows[0].amount,0);
 assert.equal(warnings.length,0);
});
test("current price comparison shows corrected 5x10000 without overwriting old",()=>{
 const saved=[{productId:"p",count:5,cashback:0,amount:0}];
 const current=[{id:"p",pricingOptions:[{cashback:0,revenuePerUnit:10000}]}];
 const rows=appendRevaluation(saved,current);
 assert.equal(rows[0].amount,0);
 assert.equal(rows[0].currentApprovedAmount,50000);
 assert.equal(rows[0].difference,50000);
});
test("unknown price plans remain unresolved",()=>{
 const n=approvedCurrentUnit({productId:"p",cashback:5000},[{id:"p",pricingOptions:[{cashback:0,revenuePerUnit:10000}]}]);
 assert.equal(n,null);
});
test("revenue mismatch is reported rather than silently hidden",()=>{
 const warnings=[];
 decodeRecord({id:"r",results:{p:{productId:"p",count:5,revenuePerUnit:10000}},totalCount:5,totalRevenue:10000},warnings);
 assert.ok(warnings.some(x=>x.includes("不一致")));
});
test("count-only no-result report is not treated as invalid history",()=>{
 const warnings=[];
 assert.deepEqual(decodeRecord({id:"r",totalCount:0,totalRevenue:0,results:{}},warnings),[]);
 assert.equal(warnings.length,0);
});
test("CSV injection and quoted text remain escaped",()=>{
 assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
 assert.equal(csvCell('a"b'),'"a""b"');
});
test("group subtotals add amount and count",()=>{
 const items=group([{productId:"p",productName:"電気",count:2,amount:20000},{productId:"p",productName:"電気",count:3,amount:30000}],"productId","productName");
 assert.deepEqual(items,[{name:"電気",count:5,revenue:50000}]);
});
