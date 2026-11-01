import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const section=html.slice(html.indexOf("// Read-only owner roster inside"),
 html.indexOf("function renderMembers()",html.indexOf("// Read-only owner roster inside")));
test("member administration has owner-only company-grouped partner UI",()=>{
 assert.match(html,/id="memberManagementContent"[\s\S]*id="partnerMemberCompanySection"/);
 assert.match(html,/id="partnerMemberCompanyList"/);
 assert.match(html,/id="partnerMemberCompanyRefresh"/);
 assert.match(section,/!canLoadPartnerRanking\(\)/);
 assert.match(html,/partnerMemberSection\.hidden=!canLoadPartnerRanking\(\)/);
 assert.match(section,/showPartnerMemberGroup/);
 assert.match(section,/member\.role==="leader"\?"リーダー":"メンバー"/);
 assert.match(section,/^|協力店｜/);
});
test("owner roster reads only safe existing callable and never financial Firestore",()=>{
 assert.match(section,/await readPartnerWorkDay\(\{date:getTodayString\(\)\}\)/);
 assert.match(section,/result\?\.role!=="hub"/);
 assert.match(section,/Array\.isArray\(result\.registeredCompanies\)/);
 assert.match(section,/currentUser\?\.uid===uid/);
 assert.match(section,/currentUserData\?\.companyId===cid/);
 assert.match(section,/partnerMemberSection\.open/);
 assert.match(section,/別会社の氏名は現在のAPIから取得できません/);
 for(const api of ["getDocs(", "getDoc(", "onSnapshot(", "setDoc(", "updateDoc(", "deleteDoc(", "writeBatch(", "collection(db"])
  assert.ok(!section.includes(api),"No cross-company data writes or raw Firestore reads: "+api);
 for(const value of ["canViewRevenue","revenuePerUnit","unitPrice","currentCatalogRevenuePerUnit","totalRevenue"])
  assert.ok(!section.includes(value),"No finance data in roster: "+value);
});
