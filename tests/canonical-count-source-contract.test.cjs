"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,"functions-ranking-approvals","ranking",p),"utf8");
test("hub count reader uses original records and strips financial fields",()=>{
 const s=read("internal-month-count-tx-reader.mjs");
 for(const x of ['collections("records")','collections("products")','collections("teams")','collections("users")','where("companyId","==",hubCompanyId)','count(x.count)','auditNoFinancialKeys(result)'])assert.ok(s.includes(x),x);
 assert.match(s,/\.limit\(LIMIT\.records\+1\)/);
 assert.match(s,/sum!==count\(v\.totalCount\)/);
 assert.match(s,/sum>0\?"submitted":null/);
 assert.doesNotMatch(s,/\b(?:tx|db)\.(?:set|update|delete|create)\s*\(/);
});
test("partner count reader requires bilateral approvals and full month",()=>{
 const s=read("partner-month-readonly-loader.mjs");
 for(const x of ['combinedRankingApprovedByHub','combinedRankingApprovedByPartner','individualNamesApprovedByHub','individualNamesApprovedByPartner','partnerWorkEntries','partnerWorkCountDays','completeMonthEntriesRead:true','completeMonthSummariesRead:true','{readOnly:true}'])assert.ok(s.includes(x),x);
 assert.match(s,/\.limit\(MAX_ENTRIES\+1\)/);
 assert.doesNotMatch(s,/\b(?:tx|db)\.(?:set|update|delete|create)\s*\(/);
});
