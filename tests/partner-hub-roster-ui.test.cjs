"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const fragment=(first,last)=>{
 const a=html.indexOf(first),b=html.indexOf(last,a+first.length);
 assert(a>=0&&b>a,first+" / "+last);
 return html.slice(a,b);
};
const roster=fragment("async function refreshPartnerMemberCompanies(){","partnerMemberSection.addEventListener");
test("existing hub member-management tab is reused rather than creating a second account system",()=>{
 assert.match(html,/id="partnerMemberCompanySection"/);
 assert.match(html,/id="partnerMemberCompanySearch"/);
 assert.match(html,/id="partnerMemberCompanyList"/);
 assert.match(roster,/canLoadPartnerRanking\(\)/);
 assert.match(roster,/registeredCompanies/);
 assert.match(roster,/partnerCompanyId:item\.partnerCompanyId,includeRoster:true/);
 assert.match(roster,/quickInviteButton\.click\(\)/);
 assert.match(roster,/filterPartnerMemberCompanies\(\)/);
});
test("roster read is lazy per explicitly chosen company; not a costly query per company by default",()=>{
 const a=roster.indexOf("for(const item of result.registeredCompanies)");
 const b=roster.indexOf("readPartnerWorkDay({date:getTodayString(),",a);
 assert(a>0&&b>a);
 const subsection=roster.slice(a,b);
 assert.match(subsection,/rosterButton\.onclick=async/);
 assert.doesNotMatch(roster.slice(0,a),/includeRoster:true/);
 assert.match(roster,/info\.financialRulesVerified!==false/);
});
test("account flags never produce a verified-safe finance status or silently touch raw financial database",()=>{
 assert.match(roster,/金額アクセスは未検証/);
 assert.match(roster,/旧自社所属あり・金額遮断の実証が必要/);
 assert.match(roster,/登録・権限フラグに不整合/);
 assert.match(roster,/roster\.replaceChildren\(\)/);
 assert.match(roster,/row\.textContent=person\.name/);
 assert.doesNotMatch(roster,/innerHTML|productsCollection|recordsCollection|setDoc|updateDoc|deleteDoc|runTransaction/);
});
